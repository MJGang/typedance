use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use url::Url;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Provider {
    Github,
}

pub(super) fn github_client_id() -> Option<String> {
    setting(
        "TYPEDANCE_GITHUB_CLIENT_ID",
        option_env!("TYPEDANCE_GITHUB_CLIENT_ID"),
    )
    .filter(|value| {
        value.len() <= 128
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    })
}

#[derive(Deserialize)]
pub(super) struct MigrationConfig {
    endpoint: String,
    app_id: String,
}

impl MigrationConfig {
    pub(super) fn load(data: &Path) -> Result<Self, String> {
        let file = data.join("account-config.json");
        let mut config = if file.is_file() {
            serde_json::from_slice::<Self>(&fs::read(file).map_err(|_| "无法读取旧账号配置。")?)
                .map_err(|_| "旧账号配置格式无效。")?
        } else {
            Self {
                endpoint: String::new(),
                app_id: String::new(),
            }
        };
        if let Some(endpoint) = setting(
            "TYPEDANCE_MIGRATION_LOGTO_ENDPOINT",
            option_env!("TYPEDANCE_MIGRATION_LOGTO_ENDPOINT"),
        ) {
            config.endpoint = endpoint;
        }
        if let Some(app_id) = setting(
            "TYPEDANCE_MIGRATION_LOGTO_APP_ID",
            option_env!("TYPEDANCE_MIGRATION_LOGTO_APP_ID"),
        ) {
            config.app_id = app_id;
        }
        let url = Url::parse(&config.endpoint).map_err(|_| "缺少旧账号资料的迁移配置。")?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.path().trim_matches('/').is_empty()
            || config.app_id.is_empty()
        {
            return Err("旧账号资料的迁移配置无效。".into());
        }
        config.endpoint = url.as_str().trim_end_matches('/').into();
        Ok(config)
    }

    pub(super) fn issuer(&self) -> String {
        format!("{}/oidc", self.endpoint)
    }

    pub(super) fn namespace(&self) -> String {
        format!(
            "app.typedance.desktop.account.{}",
            profile_key(&self.issuer(), &self.app_id)
        )
    }
}

fn setting(name: &str, embedded: Option<&str>) -> Option<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            embedded
                .map(str::to_owned)
                .filter(|value| !value.trim().is_empty())
        })
}

pub(crate) fn profile_key(issuer: &str, subject: &str) -> String {
    let digest = Sha256::digest(format!("{issuer}\0{subject}").as_bytes());
    format!("{digest:x}")
}
