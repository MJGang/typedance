use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Provider {
    Github,
    Google,
    Wechat,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AccountConfig {
    pub(crate) endpoint: String,
    pub(crate) app_id: String,
    #[serde(default)]
    pub(crate) connectors: BTreeMap<Provider, String>,
}

impl AccountConfig {
    pub(crate) fn load(data_dir: &Path) -> Result<Option<Self>, String> {
        Self::load_with_settings(data_dir, public_setting)
    }

    fn load_with_settings(
        data_dir: &Path,
        setting: impl Fn(&str) -> Option<String>,
    ) -> Result<Option<Self>, String> {
        let path = data_dir.join("account-config.json");
        let mut config = if path.is_file() {
            serde_json::from_slice::<Self>(&fs::read(path).map_err(|_| "无法读取账号配置。")?)
                .map_err(|_| "账号配置格式无效，请检查 account-config.json。")?
        } else {
            Self {
                endpoint: String::new(),
                app_id: String::new(),
                connectors: BTreeMap::new(),
            }
        };

        if let Some(value) = setting("TYPEDANCE_LOGTO_ENDPOINT") {
            config.endpoint = value;
        }
        if let Some(value) = setting("TYPEDANCE_LOGTO_APP_ID") {
            config.app_id = value;
        }
        for (provider, name) in [
            (Provider::Github, "TYPEDANCE_LOGTO_GITHUB_CONNECTOR_ID"),
            (Provider::Google, "TYPEDANCE_LOGTO_GOOGLE_CONNECTOR_ID"),
            (Provider::Wechat, "TYPEDANCE_LOGTO_WECHAT_CONNECTOR_ID"),
        ] {
            if let Some(value) = setting(name) {
                config.connectors.insert(provider, value);
            }
        }
        if config.endpoint.trim().is_empty() && config.app_id.trim().is_empty() {
            return Ok(None);
        }
        config.validate()?;
        Ok(Some(config))
    }

    pub(crate) fn validate(&mut self) -> Result<(), String> {
        let url = Url::parse(&self.endpoint).map_err(|_| "账号服务地址无效。")?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path().trim_matches('/').len() != 0
        {
            return Err("账号服务必须配置为可信的 HTTPS 源地址，不能包含路径、凭据或参数。".into());
        }
        if self.app_id.trim().is_empty() || self.app_id.len() > 256 {
            return Err("请配置有效的 Logto Native 应用 ID。".into());
        }
        if self.connectors.values().any(|value| {
            value.is_empty()
                || value.len() > 128
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        }) {
            return Err("第三方登录连接器 ID 无效。".into());
        }
        self.endpoint = url.as_str().trim_end_matches('/').to_string();
        Ok(())
    }

    pub(crate) fn issuer(&self) -> String {
        format!("{}/oidc", self.endpoint)
    }

    pub(crate) fn account_center(&self) -> Result<Url, String> {
        let origin = Url::parse(&self.endpoint).map_err(|_| "账号服务地址无效。")?;
        let center = origin
            .join("/account/security")
            .map_err(|_| "账号中心地址无效。")?;
        if center.origin() != origin.origin() || center.scheme() != "https" {
            return Err("账号中心地址不属于已配置的账号服务。".into());
        }
        Ok(center)
    }

    pub(crate) fn vault_namespace(&self) -> String {
        let digest = Sha256::digest(format!("{}\0{}", self.issuer(), self.app_id).as_bytes());
        format!("app.typedance.desktop.account.{digest:x}")
    }
}

fn public_setting(name: &str) -> Option<String> {
    let runtime = std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty());
    runtime.or_else(|| embedded_setting(name).map(str::to_string))
}

fn embedded_setting(name: &str) -> Option<&'static str> {
    let embedded = match name {
        "TYPEDANCE_LOGTO_ENDPOINT" => option_env!("TYPEDANCE_LOGTO_ENDPOINT"),
        "TYPEDANCE_LOGTO_APP_ID" => option_env!("TYPEDANCE_LOGTO_APP_ID"),
        "TYPEDANCE_LOGTO_GITHUB_CONNECTOR_ID" => option_env!("TYPEDANCE_LOGTO_GITHUB_CONNECTOR_ID"),
        "TYPEDANCE_LOGTO_GOOGLE_CONNECTOR_ID" => option_env!("TYPEDANCE_LOGTO_GOOGLE_CONNECTOR_ID"),
        "TYPEDANCE_LOGTO_WECHAT_CONNECTOR_ID" => option_env!("TYPEDANCE_LOGTO_WECHAT_CONNECTOR_ID"),
        _ => None,
    };
    embedded.filter(|value| !value.trim().is_empty())
}

pub(crate) fn profile_key(issuer: &str, subject: &str) -> String {
    let digest = Sha256::digest(format!("{issuer}\0{subject}").as_bytes());
    format!("{digest:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_configuration_provides_sign_in_without_a_local_config_file() {
        let data = tempfile::tempdir().unwrap();
        let config = AccountConfig::load_with_settings(data.path(), |name| match name {
            "TYPEDANCE_LOGTO_ENDPOINT" => Some("https://auth.example.com".into()),
            "TYPEDANCE_LOGTO_APP_ID" => Some("native-app".into()),
            "TYPEDANCE_LOGTO_GITHUB_CONNECTOR_ID" => Some("github-connector".into()),
            _ => None,
        })
        .unwrap()
        .unwrap();
        assert_eq!(config.endpoint, "https://auth.example.com");
        assert_eq!(
            config.connectors.get(&Provider::Github).unwrap(),
            "github-connector"
        );
        assert!(!data.path().join("account-config.json").exists());
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn release_embeds_sign_in_configuration_for_a_clean_install() {
        let data = tempfile::tempdir().unwrap();
        let config = AccountConfig::load_with_settings(data.path(), |name| {
            embedded_setting(name).map(str::to_string)
        })
        .expect("embedded account configuration must be valid")
        .expect("release must embed its public account configuration");
        assert!(
            !config.connectors.is_empty(),
            "release must provide a sign-in channel"
        );
        assert!(!data.path().join("account-config.json").exists());
    }

    #[test]
    fn configured_origin_rejects_credentials_paths_and_plain_http() {
        for endpoint in [
            "http://localhost:3001",
            "https://user:pass@example.com",
            "https://example.com/evil",
            "https://example.com?redirect=evil",
        ] {
            let mut config = AccountConfig {
                endpoint: endpoint.into(),
                app_id: "app".into(),
                connectors: BTreeMap::new(),
            };
            assert!(config.validate().is_err());
        }
    }

    #[test]
    fn identity_scope_includes_issuer_and_unambiguous_subject() {
        assert_ne!(
            profile_key("https://one/oidc", "user"),
            profile_key("https://two/oidc", "user")
        );
        assert_ne!(profile_key("ab", "c"), profile_key("a", "bc"));
        assert_eq!(profile_key("a", "b").len(), 64);
    }
}
