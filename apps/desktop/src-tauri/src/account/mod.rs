mod broker;
mod config;
mod github;
mod import_claim;
mod legacy;
mod local;
mod migration;
mod token;
mod vault;
pub(crate) mod window;

use broker::CredentialBroker;
use config::Provider;
use legacy::LegacySummary;
use local::{Account, Accounts};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    net::TcpListener,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;
pub(crate) use token::random_token;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use vault::Vault;
use zeroize::Zeroizing;

#[derive(Clone, Deserialize, Serialize)]
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
    github_code: Option<String>,
    github_bound: bool,
    can_login: bool,
    login_target: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct LoginAccount {
    id: String,
    name: String,
    email: Option<String>,
    password_login: bool,
    password_saved: bool,
    github_bound: bool,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum LocalLogin {
    Password { email: String, password: String },
    Saved { account_id: String },
}

fn require_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("请在 TypeDance 主窗口操作账号。".into());
    }
    Ok(())
}
struct Current {
    account: Account,
    broker: Option<CredentialBroker>,
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
    let temporary = path.with_extension(format!("json.{}.tmp", random_token()));
    let data = serde_json::to_vec(value).map_err(|_| "账号资料标识无效。")?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "无法保存账号资料标识。")?;
    let saved = file.write_all(&data).and_then(|_| file.sync_all());
    drop(file);
    if saved.and_then(|_| fs::rename(&temporary, path)).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err("无法完成账号资料标识保存。".into());
    }
    Ok(())
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
        let providers: Vec<_> = config::github_client_id()
            .map(|_| Provider::Github)
            .into_iter()
            .collect();
        eprintln!("Account startup gate: restoring");
        eprintln!("Account startup providers: {providers:?}");
        Ok(Arc::new(Self {
            data,
            inner: Mutex::new(Inner {
                view: AccountState {
                    revision: 0,
                    status: "restoring".into(),
                    configured: true,
                    providers,
                    user: None,
                    session: None,
                    error: None,
                    legacy: None,
                    github_code: None,
                    github_bound: false,
                    can_login: false,
                    login_target: None,
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
        eprintln!("Account state: {}", state.status);
        // 失效锁定的草稿尚在保存，先保留工作台几何，避免编辑器在保存中重新布局。
        window::AccountWindow::apply(app, matches!(state.status.as_str(), "ready" | "locking"));
        let _ = app.emit("typedance-account-changed", state.clone());
    }

    fn profile_dir(&self, id: &str) -> Result<PathBuf, String> {
        if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("本机工作区标识无效。".into());
        }
        let profiles = self.data.join("profiles");
        fs::create_dir_all(&profiles).map_err(|_| "无法创建账号资料空间。")?;
        plain_directory(&profiles)?;
        Ok(profiles.join(id))
    }

    fn has_login_history(&self, account: &Account) -> bool {
        // 注册时只创建账号，首次登录进入工作区时才写入归属标识。
        account.can_log_in()
            && self
                .profile_dir(&account.user.id)
                .is_ok_and(|path| path.join(".local-account.json").is_file())
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
            if let Some(broker) = current.broker.take() {
                broker.revoke();
            }
        }
        state.view.session = None;
    }

    pub(crate) async fn restore(self: &Arc<Self>, app: &AppHandle) {
        let _operation = self.operation.lock().await;
        {
            let mut state = self.inner.lock().await;
            if state.view.status != "restoring"
                && !(state.view.status == "error" && state.current.is_none())
            {
                return;
            }
            state.view.status = "restoring".into();
            state.view.error = None;
            Self::publish(app, &mut state.view);
        }
        let result = async {
            let mut accounts = Accounts::open(&self.data)?;
            let account = if accounts.is_empty() {
                migration::adopt(app, &self.data, &mut accounts).await?
            } else {
                local::remembered_account(&self.data)?
                    .map(|id| accounts.find(&id))
                    .transpose()?
            };
            if let Some(account) = account {
                self.accept(app, account).await
            } else {
                let mut state = self.inner.lock().await;
                state.view.status = "signed_out".into();
                Self::publish(app, &mut state.view);
                Ok(())
            }
        }
        .await;
        if let Err(error) = result {
            self.report_startup_error(app, error).await;
        }
    }

    async fn report_startup_error(&self, app: &AppHandle, error: String) {
        if std::env::var_os("TYPEDANCE_RELEASE_SMOKE_EXIT_AFTER_MS").is_some() {
            eprintln!(
                "Smoke account startup error (shutdown={}): {error}",
                self.shutting_down.load(Ordering::SeqCst)
            );
        }
        let mut state = self.inner.lock().await;
        state.view.can_login = state
            .current
            .as_ref()
            .is_some_and(|current| current.account.can_log_in());
        state.current = None;
        state.view.status = "error".into();
        state.view.user = None;
        state.view.legacy = None;
        state.view.github_bound = false;
        state.view.error = Some(error);
        Self::publish(app, &mut state.view);
    }

    async fn accept(&self, app: &AppHandle, account: Account) -> Result<(), String> {
        let id = account.user.id.clone();
        local::remember_account(&self.data, &id)?;
        {
            let mut state = self.inner.lock().await;
            state.view.user = Some(account.user.clone());
            state.view.login_target = None;
            state.view.github_bound = account.github_bound();
            state.view.can_login = account.can_log_in();
            state.current = Some(Current {
                account,
                broker: None,
            });
        }
        let profile = self.profile_dir(&id)?;
        let marker = profile.join(".local-account.json");
        let sources = if marker.is_file() {
            vec![]
        } else {
            self.legacy_sources(&id)?
        };
        {
            let mut state = self.inner.lock().await;
            state.view.error = None;
            state.view.legacy = legacy::summarize(sources);
            if state.view.legacy.is_some() {
                state.view.status = "needs_import".into();
                Self::publish(app, &mut state.view);
                return Ok(());
            }
        }
        self.activate(app).await
    }

    async fn activate(&self, app: &AppHandle) -> Result<(), String> {
        let id = self.current_id().await?;
        let profile = self.profile_dir(&id)?;
        fs::create_dir_all(&profile).map_err(|_| "无法创建账号资料空间。")?;
        plain_directory(&profile)?;
        let marker = profile.join(".local-account.json");
        if marker.is_file() {
            let saved: String =
                serde_json::from_slice(&fs::read(&marker).map_err(|_| "无法读取本机工作区归属。")?)
                    .map_err(|_| "本机工作区归属无效。")?;
            if saved != id {
                return Err("本机工作区与当前账号不匹配。".into());
            }
        } else {
            write_json(&marker, &id)?;
        }
        let broker =
            CredentialBroker::start(Vault::new(local::VAULT_NAMESPACE.into())?, id).await?;
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
        app.state::<crate::runtime::ManagedProcesses>()
            .adopt(processes);
        {
            let mut state = self.inner.lock().await;
            if state.login_cancel.is_cancelled() || self.shutting_down.load(Ordering::SeqCst) {
                drop(state);
                app.state::<crate::runtime::ManagedProcesses>().shutdown();
                return Err("账号服务启动已取消。".into());
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
        Ok(())
    }

    async fn current_id(&self) -> Result<String, String> {
        self.inner
            .lock()
            .await
            .current
            .as_ref()
            .map(|current| current.account.user.id.clone())
            .ok_or_else(|| "本机账号会话已结束。".into())
    }

    async fn can_sign_in(&self) -> Result<(), String> {
        if !matches!(
            self.inner.lock().await.view.status.as_str(),
            "signed_out" | "locked"
        ) {
            return Err("请先完成当前账号操作。".into());
        }
        if self.shutting_down.load(Ordering::SeqCst) {
            return Err("客户端正在退出。".into());
        }
        Ok(())
    }

    async fn publish_profile(&self, app: &AppHandle, account: Account) -> Result<(), String> {
        let mut state = self.inner.lock().await;
        state.view.user = Some(account.user.clone());
        state.view.github_bound = account.github_bound();
        state.view.can_login = account.can_log_in();
        state
            .current
            .as_mut()
            .ok_or("本机账号会话已结束。")?
            .account = account;
        Self::publish(app, &mut state.view);
        Ok(())
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

    async fn cancel_sign_in(&self) -> AccountState {
        self.inner.lock().await.login_cancel.cancel();
        let _operation = self.operation.lock().await;
        self.snapshot().await
    }

    async fn github_authorization(
        &self,
        app: &AppHandle,
        bind: bool,
        target: Option<String>,
    ) -> Result<AccountState, String> {
        let _operation = self.operation.lock().await;
        let owner = if bind {
            if self.inner.lock().await.view.status != "ready" {
                return Err("请先登录要绑定的 TypeDance 账号。".into());
            }
            Some(self.current_id().await?)
        } else {
            self.can_sign_in().await?;
            None
        };
        let client = github::Github::new(config::github_client_id().ok_or("GitHub 登录未配置。")?)?;
        let cancelled = CancellationToken::new();
        {
            let mut state = self.inner.lock().await;
            state.login_cancel = cancelled.clone();
            state.view.error = None;
            if !bind {
                state.view.status = "signing_in".into();
                state.view.login_target = target.clone();
            }
            Self::publish(app, &mut state.view);
        }

        let result = async {
            let code = tokio::select! {
                _ = cancelled.cancelled() => return Err("GitHub 授权已取消。".into()),
                code = client.begin() => code?,
            };
            {
                let mut state = self.inner.lock().await;
                state.view.github_code = Some(code.user_code.clone());
                Self::publish(app, &mut state.view);
            }
            app.opener()
                .open_url(github::VERIFY_URL, None::<&str>)
                .map_err(|_| "无法打开 GitHub 授权页面。")?;
            let subject = client.finish(code, &cancelled).await?;
            if cancelled.is_cancelled() || self.shutting_down.load(Ordering::SeqCst) {
                return Err("GitHub 授权已取消。".into());
            }
            let mut accounts = Accounts::open(&self.data)?;
            let account = if let Some(id) = target {
                let account = accounts.find(&id)?;
                if !account.matches_github(&subject) {
                    return Err(
                        "GitHub 授权账号与所选账号不匹配，请使用对应的 GitHub 账号。".into(),
                    );
                }
                account
            } else {
                accounts.github(&subject, owner.as_deref())?
            };
            if bind {
                self.publish_profile(app, account).await
            } else if let Err(error) = self.accept(app, account).await {
                self.report_startup_error(app, error.clone()).await;
                Err(error)
            } else {
                Ok(())
            }
        }
        .await;

        let mut state = self.inner.lock().await;
        state.view.github_code = None;
        state.login_cancel = CancellationToken::new();
        if !bind && state.view.status == "signing_in" {
            state.view.status = "signed_out".into();
        }
        if !cancelled.is_cancelled() {
            if let Err(error) = &result {
                state.view.error = Some(error.clone());
            }
        }
        Self::publish(app, &mut state.view);
        if bind && !cancelled.is_cancelled() {
            result?;
        }
        Ok(state.view.clone())
    }

    async fn logout_local(&self, app: &AppHandle, target: Option<String>) -> Result<(), String> {
        if self
            .inner
            .lock()
            .await
            .current
            .as_ref()
            .is_some_and(|current| !current.account.can_log_in())
        {
            return Err(
                "请先在「账号与安全」设置本机邮箱和密码，或绑定 GitHub，再退出登录。".into(),
            );
        }
        local::forget_account(&self.data)?;
        self.stop_local(app).await;
        let mut state = self.inner.lock().await;
        state.current = None;
        state.login_cancel = CancellationToken::new();
        state.view.user = None;
        state.view.legacy = None;
        state.view.github_code = None;
        state.view.github_bound = false;
        state.view.can_login = false;
        state.view.login_target = target;
        state.view.status = "signed_out".into();
        state.view.error = None;
        Self::publish(app, &mut state.view);
        Ok(())
    }

    async fn login_local(&self, app: &AppHandle, account: Account) -> Result<AccountState, String> {
        self.inner.lock().await.login_cancel = CancellationToken::new();
        if let Err(error) = self.accept(app, account).await {
            self.report_startup_error(app, error.clone()).await;
            return Err(error);
        }
        Ok(self.snapshot().await)
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
        if let Some(source_id) = source {
            let (target, profile) = {
                let state = self.inner.lock().await;
                let current = state.current.as_ref().ok_or("账号会话已结束。")?;
                (
                    self.profile_dir(&current.account.user.id)?,
                    current.account.user.id.clone(),
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
                    Vault::new(local::VAULT_NAMESPACE.into())?.write(
                        &profile,
                        "model-api-key",
                        key,
                    )?;
                    for path in credentials {
                        fs::remove_file(path)
                            .map_err(|_| "模型凭据已安全保存，但旧明文副本未能清理，请重试。")?;
                    }
                } else {
                    return Err("旧模型凭据格式无效，请先修复或清除旧凭据文件后重试。".into());
                }
            }
        }
        if let Err(error) = self.activate(app).await {
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
        let result = self.activate(app).await;
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
    Ok(state.snapshot().await)
}
#[tauri::command]
pub(crate) async fn sign_in_account(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
    provider: Provider,
    target: Option<String>,
) -> Result<AccountState, String> {
    state.inner.lock().await.login_cancel.cancel();
    match provider {
        Provider::Github => state.github_authorization(&app, false, target).await,
    }
}
#[tauri::command]
pub(crate) async fn cancel_account_sign_in(
    state: State<'_, Arc<AccountManager>>,
) -> Result<AccountState, String> {
    Ok(state.cancel_sign_in().await)
}
#[tauri::command]
pub(crate) async fn sign_out_account(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
) -> Result<AccountState, String> {
    state.inner.lock().await.login_cancel.cancel();
    let _operation = state.operation.lock().await;
    {
        let inner = state.inner.lock().await;
        match inner.view.status.as_str() {
            "ready" => {}
            "error" if inner.view.can_login => {}
            "locking" => return Err("请先保存当前资料。".into()),
            _ => return Err("当前没有可退出的本机会话。".into()),
        }
    }
    state.inner.lock().await.login_cancel = CancellationToken::new();
    state.logout_local(&app, None).await?;
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
pub(crate) async fn retry_account_restore(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
) -> Result<AccountState, String> {
    state.inner.lock().await.login_cancel = CancellationToken::new();
    state.inner().restore(&app).await;
    Ok(state.snapshot().await)
}

#[tauri::command]
pub(crate) async fn list_login_accounts(
    window: WebviewWindow,
    state: State<'_, Arc<AccountManager>>,
) -> Result<Vec<LoginAccount>, String> {
    require_main_window(&window)?;
    let _operation = state.operation.lock().await;
    if !matches!(
        state.inner.lock().await.view.status.as_str(),
        "signed_out" | "locked" | "ready"
    ) {
        return Err("请先完成当前账号操作。".into());
    }
    let accounts = Accounts::open(&state.data)?;
    Ok(accounts
        .iter()
        .filter(|account| state.has_login_history(account))
        .map(|account| LoginAccount {
            id: account.user.id.clone(),
            name: account.user.name.clone(),
            email: account.user.email.clone(),
            password_login: account.has_password(),
            password_saved: account.has_saved_password(&state.data),
            github_bound: account.github_bound(),
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn switch_local_account(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<AccountManager>>,
    target: String,
) -> Result<AccountState, String> {
    require_main_window(&window)?;
    let _operation = state.operation.lock().await;
    if state.inner.lock().await.view.status != "ready" || state.shutting_down.load(Ordering::SeqCst)
    {
        return Err("当前无法切换账号。".into());
    }
    if target == state.current_id().await? {
        return Err("此账号已登录。".into());
    }
    let account = Accounts::open(&state.data)?.find(&target)?;
    if !state.has_login_history(&account) {
        return Err("所选账号未在本机登录过。".into());
    }
    if account
        .authenticate_saved(&state.data)
        .ok()
        .flatten()
        .is_some()
    {
        state.logout_local(&app, None).await?;
        state.login_local(&app, account).await
    } else {
        state.logout_local(&app, Some(target)).await?;
        Ok(state.snapshot().await)
    }
}

#[tauri::command]
pub(crate) async fn login_local_account(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<AccountManager>>,
    credentials: LocalLogin,
    remember_password: bool,
) -> Result<AccountState, String> {
    require_main_window(&window)?;
    let _operation = state.operation.lock().await;
    state.can_sign_in().await?;
    let accounts = Accounts::open(&state.data)?;
    let account = match credentials {
        LocalLogin::Password { email, password } => {
            let password = Zeroizing::new(password);
            let account = accounts.authenticate(&email, &password)?;
            account
                .set_saved_password(&state.data, remember_password.then_some(password.as_str()))?;
            account
        }
        LocalLogin::Saved { account_id } => {
            let account = accounts.find(&account_id)?;
            account
                .authenticate_saved(&state.data)?
                .ok_or("已保存的密码不可用，请输入密码登录。")?;
            if !remember_password {
                account.set_saved_password(&state.data, None)?;
            }
            account
        }
    };
    state.login_local(&app, account).await
}

#[tauri::command]
pub(crate) async fn register_local_account(
    state: State<'_, Arc<AccountManager>>,
    name: String,
    email: String,
    password: String,
) -> Result<String, String> {
    let _operation = state.operation.lock().await;
    state.can_sign_in().await?;
    Accounts::open(&state.data)?
        .register(&name, &email, &password)
        .map(|(_, recovery)| recovery)
}

#[tauri::command]
pub(crate) async fn update_local_account(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
    name: String,
    email: String,
    avatar: Option<String>,
) -> Result<AccountState, String> {
    let _operation = state.operation.lock().await;
    if state.inner.lock().await.view.status != "ready" {
        return Err("请先登录 TypeDance 账号。".into());
    }
    let id = state.current_id().await?;
    let account = Accounts::open(&state.data)?.update(&id, &name, &email, avatar)?;
    state.publish_profile(&app, account).await?;
    Ok(state.snapshot().await)
}

#[tauri::command]
pub(crate) async fn change_local_password(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
    password: String,
) -> Result<String, String> {
    let _operation = state.operation.lock().await;
    if state.inner.lock().await.view.status != "ready" {
        return Err("请先登录 TypeDance 账号。".into());
    }
    let id = state.current_id().await?;
    let (account, recovery) = Accounts::open(&state.data)?.change_password(&id, &password)?;
    let _ = account.set_saved_password(&state.data, None);
    state.publish_profile(&app, account).await?;
    Ok(recovery)
}

#[tauri::command]
pub(crate) async fn recover_local_password(
    state: State<'_, Arc<AccountManager>>,
    email: String,
    recovery: String,
    password: String,
) -> Result<String, String> {
    let _operation = state.operation.lock().await;
    state.can_sign_in().await?;
    let (account, next) = Accounts::open(&state.data)?.recover(&email, &recovery, &password)?;
    let _ = account.set_saved_password(&state.data, None);
    Ok(next)
}

#[tauri::command]
pub(crate) async fn bind_github_account(
    app: AppHandle,
    state: State<'_, Arc<AccountManager>>,
) -> Result<AccountState, String> {
    state.github_authorization(&app, true, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancel_waits_for_the_active_login_operation_to_finish() {
        let data = tempfile::tempdir().unwrap();
        let token = CancellationToken::new();
        let manager = Arc::new(AccountManager {
            data: data.path().to_path_buf(),
            inner: Mutex::new(Inner {
                view: AccountState {
                    revision: 1,
                    status: "signing_in".into(),
                    configured: true,
                    providers: vec![],
                    user: None,
                    session: None,
                    error: None,
                    legacy: None,
                    github_code: None,
                    github_bound: false,
                    can_login: false,
                    login_target: None,
                },
                current: None,
                login_cancel: token.clone(),
            }),
            operation: Mutex::new(()),
            shutting_down: AtomicBool::new(false),
        });
        let active_login = manager.operation.lock().await;
        let canceling = tokio::spawn({
            let manager = manager.clone();
            async move { manager.cancel_sign_in().await }
        });
        tokio::time::timeout(Duration::from_secs(1), token.cancelled())
            .await
            .unwrap();
        assert!(
            !canceling.is_finished(),
            "cancellation must wait for login cleanup"
        );
        manager.inner.lock().await.view.status = "signed_out".into();
        drop(active_login);
        let state = tokio::time::timeout(Duration::from_secs(1), canceling)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(state.status, "signed_out");
    }
}
