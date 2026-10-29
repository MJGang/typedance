use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::path::{Component, Path};
use std::process::{Command as StdCommand, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ReleasePaths {
    pub(crate) data_dir: PathBuf,
    pub(crate) browser_path: PathBuf,
    pub(crate) plugin_root: PathBuf,
    pub(crate) markdown_converter_path: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChromiumManifest {
    chromium_executable: String,
}

#[derive(Deserialize)]
struct HealthPayload {
    status: String,
}

pub(crate) fn resolve_release_paths(
    resource_dir: &Path,
    data_dir: &Path,
    chromium_manifest: &str,
) -> Result<ReleasePaths, String> {
    let manifest: ChromiumManifest = serde_json::from_str(chromium_manifest)
        .map_err(|error| format!("Invalid Chromium manifest: {error}"))?;
    let relative_browser_path = Path::new(&manifest.chromium_executable);
    let is_unsafe = relative_browser_path.is_absolute()
        || relative_browser_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        });
    if is_unsafe {
        return Err("Chromium manifest contains an unsafe executable path".to_string());
    }

    Ok(ReleasePaths {
        data_dir: data_dir.to_path_buf(),
        browser_path: resource_dir
            .join("ms-playwright")
            .join(relative_browser_path),
        plugin_root: resource_dir.join("plugins"),
        markdown_converter_path: resource_dir.join("typedance-markdown-converter.exe"),
    })
}

pub(crate) fn health_response_is_ok(response: &str) -> bool {
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    let status_is_ok = headers
        .lines()
        .next()
        .is_some_and(|line| line.starts_with("HTTP/1.1 200 ") || line.starts_with("HTTP/1.0 200 "));
    status_is_ok
        && body.lines().any(|line| {
            serde_json::from_str::<HealthPayload>(line.trim())
                .is_ok_and(|payload| payload.status == "ok")
        })
}

pub(crate) fn filter_environment<I>(environment: I) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    const ALLOWED_KEYS: &[&str] = &[
        "APPDATA",
        "COMSPEC",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "LOCALAPPDATA",
        "NO_PROXY",
        "NUMBER_OF_PROCESSORS",
        "PATH",
        "PATHEXT",
        "PROCESSOR_ARCHITECTURE",
        "PROGRAMDATA",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "WINDIR",
    ];

    environment
        .into_iter()
        .filter(|(key, _)| {
            let normalized = key.to_string_lossy().to_ascii_uppercase();
            ALLOWED_KEYS.contains(&normalized.as_str())
        })
        .collect()
}

fn langfuse_environment<I>(environment: I) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    const KEYS: &[&str] = &[
        "LANGFUSE_ENABLED",
        "LANGFUSE_BASE_URL",
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_SECRET_KEY",
        "LANGFUSE_CAPTURE_CONTENT",
        "LANGFUSE_TRACING_ENVIRONMENT",
        "LANGFUSE_RELEASE",
    ];
    environment
        .into_iter()
        .filter(|(key, _)| KEYS.contains(&key.to_string_lossy().to_ascii_uppercase().as_str()))
        .collect()
}

#[derive(Default)]
pub(crate) struct ManagedProcesses {
    children: Mutex<Vec<CommandChild>>,
    shutdown_started: AtomicBool,
    shutdown_log: PathBuf,
}

impl ManagedProcesses {
    fn push(&self, child: CommandChild) {
        self.children
            .lock()
            .expect("managed process lock poisoned")
            .push(child);
    }

    pub(crate) fn begin_shutdown(&self) -> bool {
        let started = self
            .shutdown_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok();
        self.record(if started {
            "shutdown requested"
        } else {
            "duplicate shutdown request ignored"
        });
        started
    }

    pub(crate) fn shutdown(&self) {
        let mut children = self.children.lock().expect("managed process lock poisoned");
        for child in children.drain(..).rev() {
            terminate_process_tree(child);
        }
    }

    pub(crate) fn stop_agent_host(&self) {
        let mut children = self.children.lock().expect("managed process lock poisoned");
        // ready 会话按 Sidecar、Host 顺序拥有两个进程，保留 Sidecar 以便保存画布。
        if children.len() == 2 {
            if let Some(child) = children.pop() {
                terminate_process_tree(child);
            }
        }
    }

    pub(crate) fn adopt(&self, incoming: ManagedProcesses) {
        self.shutdown();
        *self.children.lock().expect("managed process lock poisoned") = std::mem::take(
            &mut *incoming
                .children
                .lock()
                .expect("managed process lock poisoned"),
        );
        self.shutdown_started.store(false, Ordering::SeqCst);
    }

    pub(crate) fn request_termination(&self) {
        self.record("collecting managed process IDs");
        let process_ids = self
            .children
            .lock()
            .expect("managed process lock poisoned")
            .iter()
            .map(CommandChild::pid)
            .collect::<Vec<_>>();
        self.record(&format!(
            "requesting termination for {} process trees",
            process_ids.len()
        ));
        for process_id in process_ids.into_iter().rev() {
            request_process_tree_termination(process_id);
        }
        self.record("termination requests dispatched");
    }

    pub(crate) fn record(&self, message: &str) {
        if self.shutdown_log.as_os_str().is_empty() {
            return;
        }
        if let Some(parent) = self.shutdown_log.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.shutdown_log)
        {
            let _ = writeln!(file, "{:?} {message}", std::time::SystemTime::now());
        }
    }
}

impl Drop for ManagedProcesses {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub(crate) struct AccountServices {
    pub(crate) data_dir: PathBuf,
    pub(crate) sidecar_port: u16,
    pub(crate) host_port: u16,
    pub(crate) token: String,
    pub(crate) credential_url: String,
    pub(crate) credential_token: String,
}

fn source_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."))
}

fn python_binary() -> OsString {
    std::env::var_os("TYPEDANCE_PYTHON_BINARY").unwrap_or_else(|| {
        let local = source_root().join(".venv/Scripts/python.exe");
        if local.is_file() {
            local.into_os_string()
        } else {
            OsString::from("python")
        }
    })
}

fn sidecar_command(
    app: &AppHandle,
    name: &str,
) -> Result<tauri_plugin_shell::process::Command, String> {
    if cfg!(debug_assertions) {
        if name == "typedance-sidecar" {
            Ok(app
                .shell()
                .command(python_binary())
                .args(["-m", "typedance_sidecar.cli"]))
        } else {
            let node =
                std::env::var_os("TYPEDANCE_NODE_BINARY").unwrap_or_else(|| OsString::from("node"));
            Ok(app.shell().command(node).args([
                source_root()
                    .join("packages/agent-host/node_modules/tsx/dist/cli.mjs")
                    .into_os_string(),
                source_root()
                    .join("packages/agent-host/src/cli.ts")
                    .into_os_string(),
            ]))
        }
    } else {
        app.shell()
            .sidecar(name)
            .map_err(|_| "无法定位随客户端安装的业务服务。".to_string())
    }
}

fn account_runtime_paths(
    resource: &Path,
    data: &Path,
    manifest: &Path,
) -> Result<ReleasePaths, String> {
    if manifest.is_file() {
        return resolve_release_paths(
            resource,
            data,
            &fs::read_to_string(manifest).map_err(|_| "无法读取浏览器资源清单。")?,
        );
    }
    if !cfg!(debug_assertions) {
        return Err("客户端浏览器资源清单缺失，请重新安装。".into());
    }
    let browser = if let Some(path) = std::env::var_os("TYPEDANCE_CHROMIUM_PATH") {
        PathBuf::from(path)
    } else {
        let output = StdCommand::new(python_binary()).args(["-c", "from playwright.sync_api import sync_playwright; p=sync_playwright().start(); print(p.chromium.executable_path); p.stop()"])
            .output().map_err(|_| "无法定位开发环境的 Chromium。")?;
        if !output.status.success() {
            return Err("请先为开发环境安装 Playwright Chromium。".into());
        }
        PathBuf::from(
            String::from_utf8(output.stdout)
                .map_err(|_| "Chromium 路径编码无效。")?
                .trim(),
        )
    };
    Ok(ReleasePaths {
        data_dir: data.into(),
        browser_path: browser,
        plugin_root: source_root().join("plugins"),
        markdown_converter_path: resource.join("typedance-markdown-converter.exe"),
    })
}

pub(crate) async fn run_offline(
    app: &AppHandle,
    name: &str,
    args: Vec<OsString>,
) -> Result<(), String> {
    let output = sidecar_command(app, name)?
        .env_clear()
        .envs(filter_environment(std::env::vars_os()))
        .env("PYTHONPATH", source_root().join("services/sidecar/src"))
        .args(args)
        .output()
        .await
        .map_err(|_| "资料迁移进程未能启动，原资料已保留。")?;
    if !output.status.success() {
        return Err("资料迁移未完成，原资料已保留。请关闭旧客户端后重试。".into());
    }
    Ok(())
}

pub(crate) fn start_account_services(
    app: &AppHandle,
    spec: &AccountServices,
) -> Result<ManagedProcesses, String> {
    #[cfg(not(debug_assertions))]
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| "无法定位应用资源。")?;
    #[cfg(debug_assertions)]
    let resource_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    let data_dir = spec.data_dir.clone();
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Unable to create application data directory: {error}"))?;

    let manifest_path = resource_dir
        .join("ms-playwright")
        .join("chromium-manifest.json");
    let paths = account_runtime_paths(&resource_dir, &data_dir, &manifest_path)?;
    if !paths.browser_path.is_file() {
        return Err(format!(
            "Bundled Chromium executable is missing: {}",
            paths.browser_path.display()
        ));
    }
    let plugin_manifest = paths.plugin_root.join("resume").join("plugin.json");
    if !plugin_manifest.is_file() {
        return Err(format!(
            "Bundled resume plugin is missing: {}",
            plugin_manifest.display()
        ));
    }
    if !cfg!(debug_assertions) && !paths.markdown_converter_path.is_file() {
        return Err(format!(
            "Bundled Markdown converter is missing: {}",
            paths.markdown_converter_path.display()
        ));
    }

    let mut processes = ManagedProcesses::default();
    processes.shutdown_log = paths.data_dir.join("logs").join("shutdown.log");
    processes.record("release services starting");
    let child_environment = filter_environment(std::env::vars_os());
    let mut sidecar_args = vec![
        OsString::from("--host"),
        OsString::from("127.0.0.1"),
        OsString::from("--port"),
        OsString::from(spec.sidecar_port.to_string()),
        OsString::from("--data-dir"),
        paths.data_dir.clone().into_os_string(),
        OsString::from("--browser-path"),
        paths.browser_path.clone().into_os_string(),
    ];
    if paths.markdown_converter_path.is_file() {
        sidecar_args.extend([
            OsString::from("--markdown-converter-path"),
            paths.markdown_converter_path.clone().into_os_string(),
        ]);
    }
    let (sidecar_events, sidecar) = sidecar_command(app, "typedance-sidecar")?
        .env_clear()
        .envs(child_environment.clone())
        .env("TYPEDANCE_LOCAL_TOKEN", &spec.token)
        .env("PYTHONPATH", source_root().join("services/sidecar/src"))
        .args(sidecar_args)
        .spawn()
        .map_err(|error| format!("Unable to start Python Sidecar: {error}"))?;
    drain_process_events(
        sidecar_events,
        paths.data_dir.join("logs").join("sidecar-process.log"),
    );
    processes.push(sidecar);
    if let Err(error) = wait_for_health(
        "Python Sidecar",
        &format!("127.0.0.1:{}", spec.sidecar_port),
        &spec.token,
        Duration::from_secs(60),
    ) {
        processes.shutdown();
        return Err(error);
    }

    let agent_host = sidecar_command(app, "typedance-agent-host")?
        .env_clear()
        .envs(child_environment)
        .envs(langfuse_environment(std::env::vars_os()))
        .env("AGENT_HOST_HOST", "127.0.0.1")
        .env("AGENT_HOST_PORT", spec.host_port.to_string())
        .env("TYPEDANCE_DATA_DIR", &paths.data_dir)
        .env("TYPEDANCE_PLUGIN_ROOT", &paths.plugin_root)
        .env(
            "TYPEDANCE_SIDECAR_URL",
            format!("http://127.0.0.1:{}", spec.sidecar_port),
        )
        .env("TYPEDANCE_LOCAL_TOKEN", &spec.token)
        .env("TYPEDANCE_CREDENTIAL_URL", &spec.credential_url)
        .env("TYPEDANCE_CREDENTIAL_TOKEN", &spec.credential_token)
        .spawn();
    let (agent_host_events, agent_host) = match agent_host {
        Ok(result) => result,
        Err(error) => {
            processes.shutdown();
            return Err(format!("Unable to start Agent Host: {error}"));
        }
    };
    drain_process_events(
        agent_host_events,
        paths.data_dir.join("logs").join("agent-host.log"),
    );
    processes.push(agent_host);
    if let Err(error) = wait_for_health(
        "Agent Host",
        &format!("127.0.0.1:{}", spec.host_port),
        &spec.token,
        Duration::from_secs(30),
    ) {
        processes.shutdown();
        return Err(error);
    }

    processes.record("release services healthy");
    Ok(processes)
}

#[cfg(not(debug_assertions))]
pub(crate) async fn restore_release_services(app: &AppHandle) -> Result<(), String> {
    app.state::<std::sync::Arc<crate::account::AccountManager>>()
        .restart_services(app)
        .await
}

pub(crate) fn request_managed_shutdown(app: &AppHandle) -> bool {
    let Some(processes) = app.try_state::<ManagedProcesses>() else {
        return false;
    };
    if !processes.begin_shutdown() {
        return true;
    }
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        app_handle
            .state::<std::sync::Arc<crate::account::AccountManager>>()
            .request_shutdown(&app_handle)
            .await;
    });
    true
}

fn wait_for_health(
    name: &str,
    address: &str,
    token: &str,
    timeout: Duration,
) -> Result<(), String> {
    let address: SocketAddr = address
        .parse()
        .map_err(|error| format!("Invalid {name} health address: {error}"))?;
    let started = Instant::now();
    while started.elapsed() < timeout {
        if request_health(address, token).is_ok_and(|response| health_response_is_ok(&response)) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!(
        "{name} did not become healthy within {} seconds",
        timeout.as_secs()
    ))
}

fn request_health(address: SocketAddr, token: &str) -> std::io::Result<String> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(500))?;
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    stream.write_all(format!("GET /health HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n").as_bytes())?;
    let mut response = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                response.extend_from_slice(&chunk[..read]);
                if std::str::from_utf8(&response).is_ok_and(|value| health_response_is_ok(value)) {
                    break;
                }
            }
            Err(error)
                if !response.is_empty()
                    && matches!(
                        error.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ) =>
            {
                break;
            }
            Err(error) => return Err(error),
        }
    }
    Ok(String::from_utf8_lossy(&response).into_owned())
}

fn drain_process_events(
    mut events: tauri::async_runtime::Receiver<CommandEvent>,
    log_path: PathBuf,
) {
    tauri::async_runtime::spawn(async move {
        if let Some(parent) = log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        while let Some(event) = events.recv().await {
            let message = match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    String::from_utf8_lossy(&bytes).into_owned()
                }
                other => format!("{other:?}"),
            };
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
                let _ = writeln!(file, "{message}");
            }
        }
    });
}

fn terminate_process_tree(child: CommandChild) {
    let pid = child.pid();
    if request_process_tree_termination(pid) {
        return;
    }
    let _ = child.kill();
}

fn request_process_tree_termination(pid: u32) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let termination_requested = StdCommand::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success());
        if termination_requested {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{
        filter_environment, health_response_is_ok, langfuse_environment, resolve_release_paths,
        ManagedProcesses,
    };

    #[test]
    fn resolves_browser_and_plugin_paths_from_packaged_resources() {
        let paths = resolve_release_paths(
            Path::new(r"C:\Program Files\TypeDance\resources"),
            Path::new(r"C:\Users\tester\AppData\Roaming\TypeDance"),
            r#"{
                "playwrightVersion": "1.60.0",
                "browserVersion": "148.0.7778.96",
                "revision": "1223",
                "chromiumExecutable": "chromium-1223/chrome-win64/chrome.exe"
            }"#,
        )
        .expect("release paths should resolve");

        assert_eq!(
            paths.browser_path,
            Path::new(
                r"C:\Program Files\TypeDance\resources\ms-playwright\chromium-1223\chrome-win64\chrome.exe"
            )
        );
        assert_eq!(
            paths.plugin_root,
            Path::new(r"C:\Program Files\TypeDance\resources\plugins")
        );
        assert_eq!(
            paths.markdown_converter_path,
            Path::new(r"C:\Program Files\TypeDance\resources\typedance-markdown-converter.exe")
        );
        assert_eq!(
            paths.data_dir,
            Path::new(r"C:\Users\tester\AppData\Roaming\TypeDance")
        );
    }

    #[test]
    fn accepts_only_successful_health_responses() {
        assert!(health_response_is_ok(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\"}"
        ));
        assert!(!health_response_is_ok(
            "HTTP/1.1 503 Service Unavailable\r\n\r\n{\"status\":\"starting\"}"
        ));
        assert!(health_response_is_ok(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nf\r\n{\"status\":\"ok\"}\r\n0\r\n\r\n"
        ));
    }

    #[test]
    fn child_environment_keeps_windows_runtime_values_but_drops_secrets() {
        let filtered = filter_environment([
            ("SystemRoot".into(), r"C:\Windows".into()),
            ("TEMP".into(), r"C:\Temp".into()),
            ("PATH".into(), r"C:\Windows\System32".into()),
            ("DEEPSEEK_API_KEY".into(), "secret".into()),
            ("TYPEDANCE_ENV_FILE".into(), r"C:\repo\.env".into()),
        ]);

        assert!(filtered.iter().any(|(key, _)| key == "SystemRoot"));
        assert!(filtered.iter().any(|(key, _)| key == "TEMP"));
        assert!(filtered.iter().any(|(key, _)| key == "PATH"));
        assert!(!filtered.iter().any(|(key, _)| key == "DEEPSEEK_API_KEY"));
        assert!(!filtered.iter().any(|(key, _)| key == "TYPEDANCE_ENV_FILE"));
    }

    #[test]
    fn langfuse_settings_are_only_forwarded_to_agent_host() {
        let environment = [
            ("LANGFUSE_ENABLED".into(), "true".into()),
            ("LANGFUSE_BASE_URL".into(), "http://localhost:3000".into()),
            ("LANGFUSE_PUBLIC_KEY".into(), "pk-test".into()),
            ("LANGFUSE_SECRET_KEY".into(), "sk-test".into()),
            ("LANGFUSE_CAPTURE_CONTENT".into(), "true".into()),
            ("LANGFUSE_TRACING_ENVIRONMENT".into(), "test".into()),
            ("LANGFUSE_RELEASE".into(), "v1".into()),
            ("LANGFUSE_UNKNOWN".into(), "unused".into()),
            ("DEEPSEEK_API_KEY".into(), "secret".into()),
            ("TYPEDANCE_ENV_FILE".into(), "private.env".into()),
        ];
        assert!(filter_environment(environment.clone()).is_empty());
        let host_environment = langfuse_environment(environment);
        assert_eq!(host_environment.len(), 7);
        assert!(host_environment
            .iter()
            .any(|(key, _)| key == "LANGFUSE_SECRET_KEY"));
    }

    #[test]
    fn shutdown_can_only_be_started_once() {
        let processes = ManagedProcesses::default();

        assert!(processes.begin_shutdown());
        assert!(!processes.begin_shutdown());
    }
}
