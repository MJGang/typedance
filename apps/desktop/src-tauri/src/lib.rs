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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![check_sidecar_health])
        .run(tauri::generate_context!())
        .expect("error while running TypeDance");
}
