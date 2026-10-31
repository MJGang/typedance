use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::future::{AbortHandle, Abortable};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const UPDATE_EVENT: &str = "client-update-state";

fn valid_repository(value: &str) -> bool {
    let parts = value.split('/').collect::<Vec<_>>();
    parts.len() == 2
        && parts.iter().all(|part| {
            part.as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        })
}

pub(crate) fn update_releases_url() -> Option<String> {
    option_env!("TYPEDANCE_UPDATE_REPOSITORY")
        .filter(|repository| valid_repository(repository))
        .map(|repository| format!("https://github.com/{repository}/releases"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Phase {
    Idle,
    Checking,
    Latest,
    Available,
    Downloading,
    Ready,
    Installing,
    Error,
}

impl Phase {
    fn is_busy(self) -> bool {
        matches!(self, Self::Checking | Self::Downloading | Self::Installing)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo {
    version: String,
    notes: String,
    published_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    revision: u64,
    phase: Phase,
    current_version: String,
    releases_url: Option<String>,
    update: Option<UpdateInfo>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    last_checked_at: Option<u64>,
    error: Option<&'static str>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            phase: Phase::Idle,
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            releases_url: update_releases_url(),
            update: None,
            downloaded_bytes: 0,
            total_bytes: None,
            last_checked_at: None,
            error: None,
        }
    }
}

#[derive(Default)]
struct Session {
    snapshot: Snapshot,
    pending: Option<Update>,
    bytes: Option<Vec<u8>>,
    abort: Option<AbortHandle>,
}

impl Session {
    fn publish(&mut self, app: &AppHandle) -> Snapshot {
        self.snapshot.revision += 1;
        let snapshot = self.snapshot.clone();
        let _ = app.emit(UPDATE_EVENT, &snapshot);
        snapshot
    }

    fn fail(&mut self, error: &'static str) {
        self.snapshot.phase = Phase::Error;
        self.snapshot.error = Some(error);
    }
}

#[derive(Default)]
pub(crate) struct ClientUpdater(Mutex<Session>);

#[tauri::command]
pub(crate) fn get_client_update_state(state: State<'_, ClientUpdater>) -> Result<Snapshot, String> {
    Ok(state.0.lock().map_err(lock_error)?.snapshot.clone())
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "客户端更新状态不可用，请重启客户端后重试。".to_string()
}

#[tauri::command]
pub(crate) async fn check_client_update(
    app: AppHandle,
    state: State<'_, ClientUpdater>,
) -> Result<Snapshot, String> {
    {
        let mut session = state.0.lock().map_err(lock_error)?;
        if session.snapshot.phase.is_busy() || session.bytes.is_some() {
            return Ok(session.snapshot.clone());
        }
        if session.snapshot.releases_url.is_none() {
            session.fail("unconfigured");
            return Ok(session.publish(&app));
        }
        session.snapshot.phase = Phase::Checking;
        session.snapshot.error = None;
        session.publish(&app);
    }

    let exit_app = app.clone();
    let endpoint = format!(
        "{}/latest/download/latest.json",
        update_releases_url().expect("validated release repository")
    )
    .parse()
    .expect("validated repository produces an HTTPS URL");
    let result = async {
        app.updater_builder()
            .endpoints(vec![endpoint])?
            .timeout(Duration::from_secs(30))
            .restart_after_install(true)
            .on_before_exit(move || {
                if let Some(processes) = exit_app.try_state::<crate::runtime::ManagedProcesses>() {
                    processes.shutdown();
                }
            })
            .build()?
            .check()
            .await
    }
    .await;

    let mut session = state.0.lock().map_err(lock_error)?;
    session.snapshot.last_checked_at = Some(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    );
    match result {
        Ok(update) => {
            session.snapshot.update = update.as_ref().map(|update| UpdateInfo {
                version: update.version.clone(),
                notes: update.body.clone().unwrap_or_default(),
                published_at: update
                    .raw_json
                    .get("pub_date")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned),
            });
            session.snapshot.phase = if update.is_some() {
                Phase::Available
            } else {
                Phase::Latest
            };
            session.snapshot.downloaded_bytes = 0;
            session.snapshot.total_bytes = None;
            session.pending = update;
        }
        Err(error) => {
            eprintln!("Client update check failed: {error}");
            session.fail("check");
        }
    }
    Ok(session.publish(&app))
}

#[tauri::command]
pub(crate) async fn download_client_update(
    app: AppHandle,
    state: State<'_, ClientUpdater>,
) -> Result<Snapshot, String> {
    let (update, registration) = {
        let mut session = state.0.lock().map_err(lock_error)?;
        if session.snapshot.phase.is_busy() || session.bytes.is_some() {
            return Ok(session.snapshot.clone());
        }
        let mut update = session.pending.clone().ok_or("请先检查新版本。")?;
        update.timeout = Some(Duration::from_secs(15 * 60));
        let (abort, registration) = AbortHandle::new_pair();
        session.abort = Some(abort);
        session.snapshot.phase = Phase::Downloading;
        session.snapshot.error = None;
        session.snapshot.downloaded_bytes = 0;
        session.snapshot.total_bytes = None;
        session.publish(&app);
        (update, registration)
    };

    let mut received = 0_u64;
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    let download = update.download(
        |chunk, total| {
            received = received.saturating_add(chunk as u64);
            if let Ok(mut session) = state.0.lock() {
                session.snapshot.downloaded_bytes = received;
                session.snapshot.total_bytes = total.filter(|value| *value > 0);
                if last_progress.elapsed() >= Duration::from_millis(100) {
                    session.publish(&app);
                    last_progress = Instant::now();
                }
            }
        },
        || {},
    );
    let result = Abortable::new(download, registration).await;
    let mut session = state.0.lock().map_err(lock_error)?;
    session.abort = None;
    match result {
        Ok(Ok(bytes)) => {
            session.snapshot.downloaded_bytes = bytes.len() as u64;
            session.snapshot.total_bytes = Some(bytes.len() as u64);
            session.bytes = Some(bytes);
            session.snapshot.phase = Phase::Ready;
        }
        Ok(Err(error)) => {
            eprintln!("Client update download failed: {error}");
            session.fail("download");
        }
        Err(_) => {
            session.snapshot.phase = Phase::Available;
            session.snapshot.downloaded_bytes = 0;
            session.snapshot.total_bytes = None;
        }
    }
    Ok(session.publish(&app))
}

#[tauri::command]
pub(crate) fn cancel_client_update(state: State<'_, ClientUpdater>) -> Result<(), String> {
    if let Some(abort) = &state.0.lock().map_err(lock_error)?.abort {
        abort.abort();
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn install_client_update(
    app: AppHandle,
    state: State<'_, ClientUpdater>,
) -> Result<Snapshot, String> {
    let (update, bytes) = {
        let mut session = state.0.lock().map_err(lock_error)?;
        if session.snapshot.phase.is_busy() {
            return Ok(session.snapshot.clone());
        }
        let update = session.pending.clone().ok_or("请先检查新版本。")?;
        let bytes = session.bytes.take().ok_or("请先下载更新。")?;
        session.snapshot.phase = Phase::Installing;
        session.snapshot.error = None;
        session.publish(&app);
        (update, bytes)
    };
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let result = update.install(&bytes);
        (result, bytes)
    })
    .await;
    #[cfg(not(debug_assertions))]
    if !matches!(&outcome, Ok((Ok(()), _))) {
        if let Err(error) = crate::runtime::restore_release_services(&app).await {
            eprintln!("Unable to restore services after failed update installation: {error}");
        }
    }
    let mut session = state.0.lock().map_err(lock_error)?;
    let result = match outcome {
        Ok(result) => result,
        Err(error) => {
            eprintln!("Client update installation worker failed: {error}");
            session.fail("download");
            return Ok(session.publish(&app));
        }
    };
    // Windows 安装成功后会由 updater 自动退出；这里只处理返回的安装错误。
    session.bytes = Some(result.1);
    if let Err(error) = result.0 {
        eprintln!("Client update installation failed: {error}");
        session.fail("install");
    } else {
        session.snapshot.phase = Phase::Ready;
    }
    Ok(session.publish(&app))
}

#[cfg(test)]
mod tests {
    use super::{valid_repository, Phase, Snapshot};

    #[test]
    fn repository_configuration_rejects_urls_and_path_traversal() {
        assert!(valid_repository("example/typedance-releases"));
        for repository in [
            "",
            "https://github.com/example/repo",
            "../repo",
            "owner/../repo",
            "owner/",
            "/repo",
        ] {
            assert!(!valid_repository(repository));
        }
    }

    #[test]
    fn busy_phases_guard_concurrent_mutations() {
        for phase in [Phase::Checking, Phase::Downloading, Phase::Installing] {
            assert!(phase.is_busy());
        }
        for phase in [
            Phase::Idle,
            Phase::Latest,
            Phase::Available,
            Phase::Ready,
            Phase::Error,
        ] {
            assert!(!phase.is_busy());
        }
    }

    #[test]
    fn initial_state_uses_the_compiled_version_and_has_no_fabricated_release() {
        let snapshot = Snapshot::default();
        assert_eq!(snapshot.current_version, env!("CARGO_PKG_VERSION"));
        assert!(snapshot.update.is_none());
        assert!(snapshot.last_checked_at.is_none());
        assert_eq!(snapshot.phase, Phase::Idle);
    }
}
