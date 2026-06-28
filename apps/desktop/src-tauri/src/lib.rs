#![deny(warnings)]

mod runtime;

use tauri::Manager;
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
fn shutdown_application(app: tauri::AppHandle) {
    if !runtime::request_managed_shutdown(&app) {
        std::process::exit(0);
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_exported_pdf,
            shutdown_application
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if runtime::request_managed_shutdown(window.app_handle()) {
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            #[cfg(debug_assertions)]
            let _ = app;
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
