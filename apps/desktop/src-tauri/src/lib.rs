#![deny(warnings)]

mod account;
mod runtime;
mod updater;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
async fn open_exported_pdf(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&file_path);
    let is_pdf = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));

    if !path.is_file() || !is_pdf {
        return Err("Only existing PDF files can be opened".to_string());
    }

    app.opener()
        .open_path(file_path, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_client_update_logs(app: tauri::AppHandle) -> Result<(), String> {
    let url = updater::update_releases_url().ok_or("更新服务尚未配置。")?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(tauri::include_image!("icons/icon.ico"))
        .tooltip("TypeDance")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                show_main_window(app);
                if !runtime::request_managed_shutdown(app) {
                    app.exit(0);
                }
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::ClientUpdater::default())
        .manage(account::window::AccountWindow::default())
        .invoke_handler(tauri::generate_handler![
            open_exported_pdf,
            open_client_update_logs,
            updater::get_client_update_state,
            updater::check_client_update,
            updater::download_client_update,
            updater::cancel_client_update,
            updater::install_client_update,
            account::get_account_state,
            account::sign_in_account,
            account::cancel_account_sign_in,
            account::sign_out_account,
            account::import_local_account_data,
            account::skip_local_account_data,
            account::finish_account_lock,
            account::open_account_center,
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if matches!(
                    event,
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)
                ) {
                    account::window::AccountWindow::remember_workspace(window);
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("Failed to hide desktop window: {error}");
                    }
                }
            }
        })
        .setup(|app| {
            setup_tray(app)?;
            account::window::AccountWindow::fit_initial(app.handle())?;
            app.manage(runtime::ManagedProcesses::default());
            let accounts =
                account::AccountManager::new(app.handle()).map_err(std::io::Error::other)?;
            app.manage(accounts.clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                accounts.restore(&handle).await;
            });
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            if let Some(delay) = std::env::var("TYPEDANCE_RELEASE_SMOKE_EXIT_AFTER_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(delay));
                    runtime::request_managed_shutdown(&handle);
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building TypeDance");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { code, .. } => {
            if let Some(processes) = app_handle.try_state::<runtime::ManagedProcesses>() {
                processes.request_termination();
            }
            std::process::exit(code.unwrap_or(0));
        }
        tauri::RunEvent::Exit => {
            if let Some(processes) = app_handle.try_state::<runtime::ManagedProcesses>() {
                processes.shutdown();
            }
        }
        _ => {}
    });
}
