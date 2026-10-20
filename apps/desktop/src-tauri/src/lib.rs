#![deny(warnings)]

mod runtime;
mod updater;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
#[cfg(not(debug_assertions))]
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
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
                app.remove_tray_by_id("main");
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
        .invoke_handler(tauri::generate_handler![
            open_exported_pdf,
            open_client_update_logs,
            updater::get_client_update_state,
            updater::check_client_update,
            updater::download_client_update,
            updater::cancel_client_update,
            updater::install_client_update,
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
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
            #[cfg(not(debug_assertions))]
            {
                match runtime::start_release_services(app.handle()) {
                    Ok(processes) => {
                        app.manage(processes);
                        let main_window = app
                            .get_webview_window("main")
                            .ok_or_else(|| std::io::Error::other("Main window is missing"))?;
                        main_window.show()?;
                        if let Some(delay) = std::env::var("TYPEDANCE_RELEASE_SMOKE_EXIT_AFTER_MS")
                            .ok()
                            .and_then(|value| value.parse::<u64>().ok())
                        {
                            if let Some(processes) = app.try_state::<runtime::ManagedProcesses>() {
                                processes
                                    .record(&format!("smoke shutdown scheduled after {delay} ms"));
                            }
                            let app_handle = app.handle().clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_millis(delay));
                                runtime::request_managed_shutdown(&app_handle);
                            });
                        }
                    }
                    Err(error) => {
                        app.dialog()
                            .message(format!("TypeDance 启动失败：\n\n{error}"))
                            .title("TypeDance")
                            .kind(MessageDialogKind::Error)
                            .blocking_show();
                        return Err(std::io::Error::other(error).into());
                    }
                }
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
