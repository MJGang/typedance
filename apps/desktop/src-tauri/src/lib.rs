use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn check_sidecar_health(app: tauri::AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar("typedance-sidecar")
        .map_err(|error| error.to_string())?
        .arg("--health")
        .output()
        .await
        .map_err(|error| error.to_string())?;

    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![check_sidecar_health, open_exported_pdf])
        .run(tauri::generate_context!())
        .expect("error while running TypeDance");
}
