mod broker;
mod config;
mod import_claim;
mod legacy;
mod oidc;
mod revocations;
mod vault;
pub(crate) mod window;

use broker::CredentialBroker;
use config::{profile_key, AccountConfig, Provider};
use legacy::LegacySummary;
use oidc::{Oidc, RefreshFailure, StoredRefresh, VerifiedSession};
use openidconnect::CsrfToken;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use vault::Vault;

#[derive(Clone, Serialize)]
pub(crate) struct AccountUser {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) avatar: Option<String>,
}
#[derive(Clone, Serialize)]
pub(crate) struct LocalSession {
    id: String,
    sidecar_url: String,
    agent_host_url: String,
    token: String,
}
#[derive(Clone, Serialize)]
pub(crate) struct AccountState {
    revision: u64,
    status: String,
    configured: bool,
    providers: Vec<Provider>,
    user: Option<AccountUser>,
    session: Option<LocalSession>,
    error: Option<String>,
    legacy: Option<LegacySummary>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RefreshReceipt {
    issuer: String,
    subject: String,
    refresh: StoredRefresh,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ProfileReceipt {
    issuer: String,
    subject: String,
    profile: String,
}
struct Current {
    verified: VerifiedSession,
    config: AccountConfig,
    broker: Option<CredentialBroker>,
    stop: CancellationToken,
}
struct Inner {
    view: AccountState,
    current: Option<Current>,
    login_cancel: CancellationToken,
}

pub(crate) struct AccountManager {
    data: PathBuf,
    inner: Mutex<Inner>,
    operation: Mutex<()>,
    shutting_down: AtomicBool,
}

pub(crate) fn random_token() -> String {
    CsrfToken::new_random().secret().clone()
}

fn available_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|_| "无法分配本机服务端口。".into())
}

fn plain_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "无法访问本机资料目录。")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("账号资料目录不能是符号链接。".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("账号资料目录不能是目录联接。".into());
        }
    }
    Ok(())
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(value).map_err(|_| "账号资料标识无效。")?,
    )
    .map_err(|_| "无法保存账号资料标识。")?;
    fs::rename(temporary, path).map_err(|_| "无法完成账号资料标识保存。".into())
}

fn legacy_entries(root: &Path) -> Vec<String> {
    ["typedance.sqlite", "files", "agent-host"]
        .into_iter()
        .filter(|name| root.join(name).exists())
        .map(str::to_string)
        .collect()
}

fn legacy_credentials(root: &Path) -> Result<Vec<PathBuf>, String> {
    let directory = root.join("agent-host");
    if !directory.exists() {
        return Ok(vec![]);
    }
    plain_directory(&directory)?;
    let mut paths = Vec::new();
    for item in fs::read_dir(directory).map_err(|_| "无法检查旧模型凭据副本。")? {
        let path = item.map_err(|_| "无法检查旧模型凭据副本。")?.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if name == "auth.json" || name.starts_with("auth.json.") && name.ends_with(".tmp") {
            let metadata = fs::symlink_metadata(&path).map_err(|_| "无法检查旧模型凭据副本。")?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err("旧模型凭据不能是符号链接。".into());
            }
            paths.push(path);
        }
    }
    Ok(paths)
}

fn file_count(root: &Path) -> usize {
    let Ok(metadata) = fs::symlink_metadata(root) else {
        return 0;
    };
    if metadata.file_type().is_symlink() {
        return 0;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return 0;
        }
    }
    if metadata.is_file() {
        return 1;
    }
    fs::read_dir(root)
        .map(|items| items.flatten().map(|item| file_count(&item.path())).sum())
        .unwrap_or(0)
}

impl AccountManager {
    pub(crate) fn new(app: &AppHandle) -> Result<Arc<Self>, String> {
        let data = if let Some(path) = std::env::var_os("TYPEDANCE_ACCOUNT_DATA_DIR") {
            let path = PathBuf::from(path);
            if !path.is_absolute() {
                return Err("账号资料目录必须使用绝对路径。".into());
            }
            path
        } else {
            app.path()
                .app_data_dir()
                .map_err(|_| "无法定位账号资料目录。")?
        };
        fs::create_dir_all(&data).map_err(|_| "无法创建账号资料目录。")?;
        plain_directory(&data)?;
        let config = AccountConfig::load(&data);
        let (configured, providers, error) = match config {
            Ok(Some(config)) => (true, config.connectors.keys().copied().collect(), None),
            Ok(None) => (false, vec![], None),
            Err(error) => (false, vec![], Some(error)),
        };
        eprintln!(
            "Account startup gate: {}",
            if configured {
                "restoring"
            } else {
                "unconfigured"
            }
        );
        Ok(Arc::new(Self {
            data,
            inner: Mutex::new(Inner {
                view: AccountState {
                    revision: 0,
                    status: if configured {
                        "restoring"
                    } else {
                        "unconfigured"
                    }
                    .into(),
                    configured,
                    providers,
                    user: None,
                    session: None,
                    error,
                    legacy: None,
                },
                current: None,
                login_cancel: CancellationToken::new(),
            }),
            operation: Mutex::new(()),
            shutting_down: AtomicBool::new(false),
        }))
    }

    async fn snapshot(&self) -> AccountState {
        self.inner.lock().await.view.clone()
    }
    fn publish(app: &AppHandle, state: &mut AccountState) {
        state.revision += 1;
        // 失效锁定的草稿尚在保存，先保留工作台几何，避免编辑器在保存中重新布局。
        window::AccountWindow::apply(app, matches!(state.status.as_str(), "ready" | "locking"));
        let _ = app.emit("typedance-account-changed", state.clone());
    }

    fn config(&self) -> Result<AccountConfig, String> {
        AccountConfig::load(&self.data)?
            .ok_or_else(|| "账号服务尚未配置，请配置 Logto Endpoint 和 Native 应用 ID。".into())
    }

    fn profile_dir(&self, verified: &VerifiedSession) -> Result<PathBuf, String> {
        let profiles = self.data.join("profiles");
        fs::create_dir_all(&profiles).map_err(|_| "无法创建账号资料空间。")?;
        plain_directory(&profiles)?;
        Ok(profiles.join(&verified.profile))
    }

    fn legacy_sources(&self, profile: &str) -> Result<Vec<legacy::LegacyCandidate>, String> {
        if let Some(explicit) = std::env::var_os("TYPEDANCE_LEGACY_DATA_DIR") {
            return legacy::discover(vec![PathBuf::from(explicit)], profile);
        }
        let mut roots = vec![self.data.clone()];
        if let Some(home) = std::env::var_os("USERPROFILE") {
            let root = PathBuf::from(home).join(".typedance");
            if root != self.data {
                roots.push(root);
            }
        }
        legacy::discover(roots, profile)
    }

    async fn stop_local(&self, app: &AppHandle) {
        let session = self.inner.lock().await.view.session.clone();
        if let Some(session) = session {
            if let Ok(client) = reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(20))
                .build()
            {
                let _ = client
                    .post(format!("{}/account/prepare-close", session.agent_host_url))
                    .bearer_auth(&session.token)
                    .send()
                    .await;
            }
        }
        app.state::<crate::runtime::ManagedProcesses>().shutdown();
        let mut state = self.inner.lock().await;
        if let Some(current) = &mut state.current {
            current.stop.cancel();
            if let Some(broker) = current.broker.take() {
                broker.revoke();
            }
        }
        state.view.session = None;
    }

    fn persist_refresh(
        &self,
        config: &AccountConfig,
        verified: &VerifiedSession,
    ) -> Result<(), String> {
        let vault = Vault::new(config.vault_namespace())?;
        let value = serde_json::to_string(&RefreshReceipt {
            issuer: verified.issuer.clone(),
            subject: verified.subject.clone(),
            refresh: verified.refresh.clone(),
        })
        .map_err(|_| "登录凭据序列化失败。")?;
        vault.write(&verified.profile, "refresh", &value)?;
        write_json(&self.data.join("last-account.json"), &verified.profile)
    }

    pub(crate) async fn restore(self: &Arc<Self>, app: &AppHandle) {
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                {
                    let _operation = manager.operation.lock().await;
                    let _ = revocations::retry(&manager.data).await;
                }
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        });
        let _operation = self.operation.lock().await;
        let attempt = async {
            let config = self.config()?;
            let pointer = self.data.join("last-account.json");
            if !pointer.is_file() {
                return Ok::<_, String>(None);
            }
            let profile: String =
                serde_json::from_slice(&fs::read(pointer).map_err(|_| "无法读取上次登录标识。")?)
                    .map_err(|_| "上次登录标识无效。")?;
            let vault = Vault::new(config.vault_namespace())?;
            let Some(saved) = vault.read(&profile, "refresh")? else {
                return Ok(None);
            };
            let receipt: RefreshReceipt =
                serde_json::from_str(&saved).map_err(|_| "保存的登录凭据无效，请重新登录。")?;
            if receipt.issuer != config.issuer()
                || profile_key(&receipt.issuer, &receipt.subject) != profile
            {
                return Err("保存的身份与当前账号服务不匹配。".into());
            }
            let verified = match Oidc::discover(config.clone())
                .await?
                .refresh(&receipt.subject, receipt.refresh)
                .await
            {
                Ok(verified) => verified,
                Err(error) => {
                    if let Some(rotated) = error.rotated {
                        vault.write(
                            &profile,
                            "refresh",
                            &serde_json::to_string(&RefreshReceipt {
                                issuer: receipt.issuer,
                                subject: receipt.subject,
                                refresh: rotated,
                            })
                            .map_err(|_| "登录凭据序列化失败。")?,
                        )?;
                    }
                    return Err(error.message);
                }
            };
            self.accept(app, &config, verified).await?;
            Ok(Some(()))
        }
        .await;
        if !matches!(attempt, Ok(Some(()))) {
            if self.inner.lock().await.current.is_some() {
                self.logout_local(app, false).await;
            }
            let mut state = self.inner.lock().await;
            state.view.status = if state.view.configured {
                "signed_out"
            } else {
                "unconfigured"
            }
            .into();
            if let Err(error) = attempt {
                state.view.error = Some(match state.view.error.take() {
                    Some(cleanup) => format!("{error} {cleanup}"),
                    None => error,
                });
            }
            Self::publish(app, &mut state.view);
        }
    }

    async fn accept(
        self: &Arc<Self>,
        app: &AppHandle,
        config: &AccountConfig,
        verified: VerifiedSession,
    ) -> Result<(), String> {
        let identity = verified.profile.clone();
        let profile = {
            let mut state = self.inner.lock().await;
            state.view.user = Some(verified.user.clone());
            state.current = Some(Current {
                verified,
                config: config.clone(),
                broker: None,
                stop: CancellationToken::new(),
            });
            self.profile_dir(&state.current.as_ref().ok_or("账号会话已结束。")?.verified)?
        };
        let sources = if !profile.join(".account-profile.json").is_file() {
            self.legacy_sources(&identity)?
        } else {
            vec![]
        };
        let summary = legacy::summarize(sources);
        {
            let mut state = self.inner.lock().await;
            state.view.error = None;
            state.view.legacy = summary;
            self.persist_refresh(
                config,
                &state.current.as_ref().ok_or("账号会话已结束。")?.verified,
            )?;
            if state.view.legacy.is_some() {
                state.view.status = "needs_import".into();
                Self::publish(app, &mut state.view);
                return Ok(());
            }
        }
        self.activate(app, config).await
    }

    async fn activate(
        self: &Arc<Self>,
        app: &AppHandle,
        config: &AccountConfig,
    ) -> Result<(), String> {
        let (profile, receipt) = {
            let state = self.inner.lock().await;
            let current = state.current.as_ref().ok_or("当前账号尚未验证。")?;
            if current.verified.expires_at <= std::time::Instant::now() {
                return Err("登录验证已过期，请重新登录后打开资料。".into());
            }
            (
                self.profile_dir(&current.verified)?,
                ProfileReceipt {
                    issuer: current.verified.issuer.clone(),
                    subject: current.verified.subject.clone(),
                    profile: current.verified.profile.clone(),
                },
            )
        };
        fs::create_dir_all(&profile).map_err(|_| "无法创建账号资料空间。")?;
        plain_directory(&profile)?;
        let marker = profile.join(".account-profile.json");
        if marker.is_file() {
            let saved: ProfileReceipt =
                serde_json::from_slice(&fs::read(&marker).map_err(|_| "无法读取账号资料标识。")?)
                    .map_err(|_| "账号资料标识无效。")?;
            if saved != receipt {
                return Err("资料空间与已验证账号不匹配，已阻止访问。".into());
            }
        }
        write_json(&profile.join(".account-profile.json"), &receipt)?;
        let broker =
            CredentialBroker::start(Vault::new(config.vault_namespace())?, receipt.profile).await?;
        let sidecar_port = available_port()?;
        let mut host_port = available_port()?;
        while host_port == sidecar_port {
            host_port = available_port()?;
        }
        let token = random_token();
        let spec = crate::runtime::AccountServices {
            data_dir: profile,
            sidecar_port,
            host_port,
            token: token.clone(),
            credential_url: broker.url.clone(),
            credential_token: broker.token.clone(),
        };
        let handle = app.clone();
        let processes = tokio::task::spawn_blocking(move || {
            crate::runtime::start_account_services(&handle, &spec)
        })
        .await
        .map_err(|_| "账号业务服务启动任务失败。")??;
        if self.inner.lock().await.login_cancel.is_cancelled()
            || self.shutting_down.load(Ordering::SeqCst)
        {
            drop(processes);
            return Err("账号服务启动已取消。".into());
        }
        if self
            .inner
            .lock()
            .await
            .current
            .as_ref()
            .is_none_or(|current| current.verified.expires_at <= std::time::Instant::now())
        {
            drop(processes);
            return Err("登录验证已过期，请重新登录后打开资料。".into());
        }
        app.state::<crate::runtime::ManagedProcesses>()
            .adopt(processes);
        {
            let mut state = self.inner.lock().await;
            if state.login_cancel.is_cancelled()
                || self.shutting_down.load(Ordering::SeqCst)
                || state
                    .current
                    .as_ref()
                    .is_none_or(|current| current.verified.expires_at <= std::time::Instant::now())
            {
                drop(state);
                app.state::<crate::runtime::ManagedProcesses>().shutdown();
                return Err("账号会话已取消或过期，服务已停止。".into());
            }
            state.current.as_mut().ok_or("账号会话已结束。")?.broker = Some(broker);
            state.view.session = Some(LocalSession {
                id: random_token(),
                sidecar_url: format!("http://127.0.0.1:{sidecar_port}"),
                agent_host_url: format!("http://127.0.0.1:{host_port}"),
                token,
            });
            state.view.status = "ready".into();
            state.view.error = None;
            state.view.legacy = None;
            Self::publish(app, &mut state.view);
        }
        self.schedule_refresh(app.clone());
        Ok(())
    }

    fn schedule_refresh(self: &Arc<Self>, app: AppHandle) {
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let (delay, stop, expected) = {
                    let state = manager.inner.lock().await;
                    let Some(current) = &state.current else {
                        break;
                    };
                    if state.view.status != "ready" {
                        break;
                    }
                    (
                        current.verified.refresh_after,
                        current.stop.clone(),
                        current.verified.profile.clone(),
                    )
                };
                tokio::select! { _ = stop.cancelled() => break, _ = tokio::time::sleep(delay) => {} }
                let _operation = manager.operation.lock().await;
                let receipt = {
                    let state = manager.inner.lock().await;
                    let Some(current) = &state.current else {
                        break;
                    };
                    if current.verified.profile != expected
                        || state.view.status != "ready"
                        || stop.is_cancelled()
                    {
                        break;
                    }
                    (
                        current.verified.subject.clone(),
                        current.verified.refresh.clone(),
                        current.config.clone(),
                    )
                };
                let refreshed = async {
                    let config = receipt.2;
                    let verified = Oidc::discover(config.clone())
                        .await
                        .map_err(RefreshFailure::unavailable)?
                        .refresh(&receipt.0, receipt.1)
                        .await?;
                    if verified.profile != expected {
                        return Err("登录续期返回的账号发生变化。".into());
                    }
                    manager.persist_refresh(&config, &verified)?;
                    Ok::<_, RefreshFailure>(verified)
                }
                .await;
                match refreshed {
                    Ok(verified) => {
                        if let Some(current) = &mut manager.inner.lock().await.current {
                            current.verified = verified;
                        }
                    }
                    Err(error) => {
                        let mut retry = false;
                        {
                            let mut state = manager.inner.lock().await;
                            if let Some(current) = &mut state.current {
                                if let Some(rotated) = error.rotated {
                                    current.verified.refresh = rotated;
                                    if manager
                                        .persist_refresh(&current.config, &current.verified)
                                        .is_err()
                                    {
                                        drop(state);
                                        manager
                                            .begin_lock(
                                                &app,
                                                "续期凭据无法安全保存，请重新登录。".into(),
                                            )
                                            .await;
                                        break;
                                    }
                                }
                                if error.retryable {
                                    let remaining = current
                                        .verified
                                        .expires_at
                                        .saturating_duration_since(std::time::Instant::now());
                                    if !remaining.is_zero() {
                                        current.verified.refresh_after =
                                            remaining.min(Duration::from_secs(15));
                                        retry = true;
                                    }
                                }
                            }
                        }
                        if !retry {
                            manager.begin_lock(&app, error.message).await;
                            break;
                        }
                    }
                }
            }
        });
    }

    async fn begin_lock(&self, app: &AppHandle, reason: String) {
        let session = self.inner.lock().await.view.session.clone();
        if let Some(session) = &session {
            let closed = if let Ok(client) = reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(20))
                .build()
            {
                client
                    .post(format!("{}/account/prepare-close", session.agent_host_url))
                    .bearer_auth(&session.token)
                    .send()
                    .await
                    .is_ok_and(|response| response.status().is_success())
            } else {
                false
            };
            if !closed {
                app.state::<crate::runtime::ManagedProcesses>()
                    .stop_agent_host();
                if let Some(broker) = self
                    .inner
                    .lock()
                    .await
                    .current
                    .as_mut()
                    .and_then(|current| current.broker.as_mut())
                {
                    broker.revoke();
                }
            }
        }
        let mut state = self.inner.lock().await;
        state.view.status = if session.is_some() {
            "locking"
        } else {
            "locked"
        }
        .into();
        state.view.error = Some(reason);
        Self::publish(app, &mut state.view);
    }

    async fn sign_in(
        self: &Arc<Self>,
        app: &AppHandle,
        provider: Option<Provider>,
    ) -> Result<AccountState, String> {
        let _operation = self.operation.lock().await;
        if self.inner.lock().await.view.status == "locking" {
            return Err("请先完成当前资料保存。".into());
        }
        let config = self.config()?;
        self.logout_local(app, false).await;
        let cancelled = CancellationToken::new();
        {
            let mut state = self.inner.lock().await;
            state.login_cancel = cancelled.clone();
            state.view.status = "signing_in".into();
            state.view.configured = true;
            state.view.providers = config.connectors.keys().copied().collect();
            state.view.error = None;
            Self::publish(app, &mut state.view);
        }
        let result = async {
            let oidc = Oidc::discover(config.clone()).await?;
            let verified = oidc
                .sign_in(provider, cancelled.clone(), |url| {
                    app.opener()
                        .open_url(url, None::<&str>)
                        .map_err(|_| "无法打开系统浏览器。".into())
                })
                .await?;
            if cancelled.is_cancelled() {
                let queued = revocations::enqueue(&self.data, &config, &verified.refresh.token);
                if oidc.revoke(&verified.refresh.token).await.is_err() {
                    return Err(if queued.is_ok() { "登录已取消，远端会话将在联网后自动撤销。".into() } else { "登录已取消，但远端会话撤销未确认且无法保存重试凭据，请通过账号服务撤销会话。".into() });
                }
                if queued.is_ok() { let _ = revocations::retry(&self.data).await; }
                return Err("登录已取消。".to_string());
            }
            self.accept(app, &config, verified).await
        }
        .await;
        if let Err(error) = result {
            self.logout_local(app, false).await;
            let mut state = self.inner.lock().await;
            state.current = None;
            state.view.status = "signed_out".into();
            state.view.user = None;
            state.view.error = Some(match state.view.error.take() {
                Some(cleanup) => format!("{error} {cleanup}"),
                None => error,
            });
            Self::publish(app, &mut state.view);
        }
        Ok(self.snapshot().await)
    }

    async fn logout_local(&self, app: &AppHandle, browser: bool) {
        self.stop_local(app).await;
        let current = self.inner.lock().await.current.take();
        let mut error = None;
        if let Some(current) = current {
            {
                let config = current.config.clone();
                let queued =
                    revocations::enqueue(&self.data, &config, &current.verified.refresh.token);
                if let Err(failure) = &queued {
                    error = Some(failure.clone());
                }
                if let Ok(vault) = Vault::new(config.vault_namespace()) {
                    if let Err(failure) = vault.delete(&current.verified.profile, "refresh") {
                        error = Some(failure);
                    }
                }
                match Oidc::discover(config).await {
                    Ok(oidc) => {
                        if let Err(failure) = oidc.revoke(&current.verified.refresh.token).await {
                            error = Some(if queued.is_ok() {
                                "本机已退出，远端会话将在联网后自动撤销。".into()
                            } else {
                                failure
                            });
                        } else {
                            let _ = revocations::retry(&self.data).await;
                        }
                        if browser
                            && app
                                .opener()
                                .open_url(
                                    oidc.logout_url(current.verified.id_token_hint.as_deref())
                                        .as_str(),
                                    None::<&str>,
                                )
                                .is_err()
                        {
                            error = Some("本机已退出，浏览器会话未能结束，请重试。".into());
                        }
                    }
                    Err(_) => {
                        error = Some(if queued.is_ok() {
                            "本机已退出，远端会话将在联网后自动撤销。".into()
                        } else {
                            "本机已退出，远端撤销未完成且无法保存重试凭据，请通过账号中心撤销会话。"
                                .into()
                        });
                    }
                }
            }
        }
        let _ = fs::remove_file(self.data.join("last-account.json"));
        let mut state = self.inner.lock().await;
        state.view.user = None;
        state.view.session = None;
        state.view.legacy = None;
        state.view.status = "signed_out".into();
        state.view.error = error;
        Self::publish(app, &mut state.view);
    }

    async fn finish_setup(
        self: &Arc<Self>,
        app: &AppHandle,
        source: Option<String>,
    ) -> Result<AccountState, String> {
        let _operation = self.operation.lock().await;
        if self.inner.lock().await.view.status != "needs_import" {
            return Err("当前账号没有待确认的本机资料归属。".into());
        }
        if source.is_none() {
            if let Some(summary) = &self.inner.lock().await.view.legacy {
                summary.ensure_skip_allowed()?;
            }
        }
        let config = self
            .inner
            .lock()
            .await
            .current
            .as_ref()
            .ok_or("账号会话已结束。")?
            .config
            .clone();
        if let Some(source_id) = source {
            let (target, profile) = {
                let state = self.inner.lock().await;
                let current = state.current.as_ref().ok_or("账号会话已结束。")?;
                (
                    self.profile_dir(&current.verified)?,
                    current.verified.profile.clone(),
                )
            };
            let selected = legacy::select(self.legacy_sources(&profile)?, &source_id)?;
            let source = selected.root;
            import_claim::reserve(&source, &profile)?;
            {
                let mut state = self.inner.lock().await;
                state.view.legacy = Some(LegacySummary {
                    sources: vec![selected.info],
                    import_started: true,
                });
                Self::publish(app, &mut state.view);
            }
            if !target.join(".local-data-import.json").is_file() {
                let exclusions = legacy_credentials(&source)?
                    .iter()
                    .map(|path| {
                        format!(
                            "agent-host/{}",
                            path.file_name().unwrap_or_default().to_string_lossy()
                        )
                    })
                    .collect::<Vec<_>>();
                crate::runtime::run_offline(
                    app,
                    "typedance-sidecar",
                    vec![
                        "--migrate-local-data".into(),
                        "--source-data-dir".into(),
                        source.clone().into_os_string(),
                        "--data-dir".into(),
                        target.clone().into_os_string(),
                        "--entries-json".into(),
                        serde_json::to_string(&legacy_entries(&source))
                            .map_err(|_| "迁移条目无效。")?
                            .into(),
                        "--exclude-json".into(),
                        serde_json::to_string(&exclusions)
                            .map_err(|_| "迁移排除项无效。")?
                            .into(),
                    ],
                )
                .await?;
            }
            if target.join("agent-host/store.json").is_file()
                && !target.join("agent-host/store.sqlite").is_file()
            {
                crate::runtime::run_offline(
                    app,
                    "typedance-agent-host",
                    vec![
                        "--migrate-store".into(),
                        "--data-dir".into(),
                        target.clone().into_os_string(),
                    ],
                )
                .await?;
            }
            let credentials = legacy_credentials(&source)?;
            let legacy_key = source.join("agent-host/auth.json");
            if !credentials.is_empty() {
                if !legacy_key.is_file() {
                    return Err("检测到未完成写入的旧模型凭据。请先手动清除历史 auth.json.*.tmp 副本后重试归属，稍后在设置中重新填写 Key。".into());
                }
                let value: serde_json::Value = serde_json::from_slice(
                    &fs::read(&legacy_key).map_err(|_| "无法读取旧模型凭据。")?,
                )
                .map_err(|_| "旧模型凭据格式无效。")?;
                if let Some(key) = value
                    .get("api_key")
                    .and_then(serde_json::Value::as_str)
                    .filter(|key| !key.trim().is_empty())
                {
                    Vault::new(config.vault_namespace())?.write(&profile, "model-api-key", key)?;
                    for path in credentials {
                        fs::remove_file(path)
                            .map_err(|_| "模型凭据已安全保存，但旧明文副本未能清理，请重试。")?;
                    }
                } else {
                    return Err("旧模型凭据格式无效，请先修复或清除旧凭据文件后重试。".into());
                }
            }
        }
        if let Err(error) = self.activate(app, &config).await {
            self.begin_lock(app, error).await;
        }
        Ok(self.snapshot().await)
    }

    #[cfg(not(debug_assertions))]
    pub(crate) async fn restart_services(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        let _operation = self.operation.lock().await;
        if self.inner.lock().await.view.status != "ready" {
            return Ok(());
        }
        self.stop_local(app).await;
        if let Some(current) = &mut self.inner.lock().await.current {
            current.stop = CancellationToken::new();
        }
        let config = self
            .inner
            .lock()
            .await
            .current
            .as_ref()
            .ok_or("账号会话已结束。")?
            .config
            .clone();
        let result = self.activate(app, &config).await;
        if let Err(error) = &result {
            self.begin_lock(app, error.clone()).await;
        }
        result
    }

    pub(crate) async fn request_shutdown(&self, app: &AppHandle) {
        self.shutting_down.store(true, Ordering::SeqCst);
        self.inner.lock().await.login_cancel.cancel();
        let _operation = self.operation.lock().await;
        let status = self.inner.lock().await.view.status.clone();
        if status == "ready" {
            self.begin_lock(app, "正在保存资料并退出。".into()).await;
        } else if status == "locking" {
            let mut inner = self.inner.lock().await;
            Self::publish(app, &mut inner.view);
        } else {
            self.stop_local(app).await;
            app.exit(0);
        }
    }
}

#[tauri::command]
pub(crate) async fn get_account_state(
    state: State<'_, Arc<AccountManager>>,
) -> Result<AccountState, String> {
    if let Ok(_operation) = state.operation.try_lock() {
        let mut inner = state.inner.lock().await;
        if inner.current.is_none()
            && matches!(inner.view.status.as_str(), "unconfigured" | "signed_out")
        {
            match AccountConfig::load(&state.data) {
                Ok(Some(config)) => {
                    inner.view.configured = true;
                    inner.view.providers = config.connectors.keys().copied().collect();
                    if inner.view.status == "unconfigured" {
                        inner.view.status = "signed_out".into();
                        inner.view.error = None;
                    }
                }
                Ok(None) => {
                    inner.view.configured = false;
                    inner.view.providers.clear();
                    inner.view.status = "unconfigured".into();
                }
                Err(error) => {
                    inner.view.configured = false;
                    inner.view.status = "unconfigured".into();
                    inner.view.error = Some(error);
                }
            }
            inner.view.revision += 1;
        }
    }
    Ok(state.snapshot().await)
}
#[tauri::command]
pub(crate) async fn sign_in_account(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
    provider: Option<Provider>,
) -> Result<AccountState, String> {
    state.inner.lock().await.login_cancel.cancel();
    state.sign_in(&app, provider).await
}
#[tauri::command]
pub(crate) async fn cancel_account_sign_in(
    state: State<'_, Arc<AccountManager>>,
) -> Result<AccountState, String> {
    state.inner.lock().await.login_cancel.cancel();
    Ok(state.snapshot().await)
}
#[tauri::command]
pub(crate) async fn sign_out_account(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
) -> Result<AccountState, String> {
    let _operation = state.operation.lock().await;
    if state.inner.lock().await.view.status == "locking" {
        return Err("请先保存当前资料。".into());
    }
    state.logout_local(&app, true).await;
    Ok(state.snapshot().await)
}
#[tauri::command]
pub(crate) async fn import_local_account_data(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
    source: String,
) -> Result<AccountState, String> {
    state.finish_setup(&app, Some(source)).await
}
#[tauri::command]
pub(crate) async fn skip_local_account_data(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
) -> Result<AccountState, String> {
    state.finish_setup(&app, None).await
}
#[tauri::command]
pub(crate) async fn finish_account_lock(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
) -> Result<AccountState, String> {
    let _operation = state.operation.lock().await;
    if state.inner.lock().await.view.status != "locking" {
        return Err("账号没有待完成的锁定操作。".into());
    }
    state.stop_local(&app).await;
    {
        let mut inner = state.inner.lock().await;
        inner.view.status = "locked".into();
        AccountManager::publish(&app, &mut inner.view);
    }
    if state.shutting_down.load(Ordering::SeqCst) {
        app.exit(0);
    }
    Ok(state.snapshot().await)
}
#[tauri::command]
pub(crate) async fn open_account_center(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
) -> Result<(), String> {
    if state.inner.lock().await.view.status != "ready" {
        return Err("请先登录。".into());
    }
    let config = state
        .inner
        .lock()
        .await
        .current
        .as_ref()
        .ok_or("账号会话已结束。")?
        .config
        .clone();
    app.opener()
        .open_url(config.account_center()?.as_str(), None::<&str>)
        .map_err(|_| "无法打开账号管理页面。".into())
}
