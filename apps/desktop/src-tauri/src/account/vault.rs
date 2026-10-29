use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

use keyring_core::{Entry, Error};
use zeroize::Zeroizing;

/// 全部凭据访问串行化。Windows Credential Manager 不保证同一条目跨线程写读顺序。
#[derive(Clone)]
pub(crate) struct Vault {
    service: String,
    gate: Arc<Mutex<()>>,
}

static INITIALIZED: OnceLock<Result<(), String>> = OnceLock::new();
static ACCESS_GATE: OnceLock<Arc<Mutex<()>>> = OnceLock::new();

impl Vault {
    pub(crate) fn new(service: String) -> Result<Self, String> {
        INITIALIZED.get_or_init(initialize).clone()?;
        Ok(Self {
            service,
            gate: ACCESS_GATE.get_or_init(|| Arc::new(Mutex::new(()))).clone(),
        })
    }

    fn entry(&self, profile: &str, kind: &str) -> Result<Entry, String> {
        if profile.len() != 64 || !profile.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("账号凭据标识无效。".into());
        }
        Entry::new_with_modifiers(
            &self.service,
            &format!("{kind}:{profile}"),
            &HashMap::from([("persistence", "Local")]),
        )
        .map_err(|_| "系统安全存储不可用，请解锁系统账号后重试。".into())
    }

    pub(crate) fn read(
        &self,
        profile: &str,
        kind: &str,
    ) -> Result<Option<Zeroizing<String>>, String> {
        let _guard = self.gate.lock().map_err(|_| "系统安全存储正忙。")?;
        match self.entry(profile, kind)?.get_password() {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            Err(Error::NoEntry) => Ok(None),
            Err(_) => Err("无法读取系统安全存储，请解锁系统账号后重试。".into()),
        }
    }

    pub(crate) fn write(&self, profile: &str, kind: &str, value: &str) -> Result<(), String> {
        let _guard = self.gate.lock().map_err(|_| "系统安全存储正忙。")?;
        let entry = self.entry(profile, kind)?;
        entry
            .set_password(value)
            .map_err(|_| "无法写入系统安全存储，凭据未保存。")?;
        let restored = Zeroizing::new(
            entry
                .get_password()
                .map_err(|_| "系统凭据保存后无法校验。")?,
        );
        if restored.as_str() != value {
            return Err("系统凭据保存校验失败。".into());
        }
        Ok(())
    }

    pub(crate) fn delete(&self, profile: &str, kind: &str) -> Result<(), String> {
        let _guard = self.gate.lock().map_err(|_| "系统安全存储正忙。")?;
        match self.entry(profile, kind)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(_) => Err("无法移除系统登录凭据，请解锁系统账号后重试。".into()),
        }
    }
}

#[cfg(windows)]
fn initialize() -> Result<(), String> {
    let store =
        windows_native_keyring_store::Store::new().map_err(|_| "无法打开 Windows 凭据管理器。")?;
    keyring_core::set_default_store(store);
    Ok(())
}

#[cfg(not(windows))]
fn initialize() -> Result<(), String> {
    Err("当前账号安全存储仅支持 Windows 桌面端。".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn windows_credentials_are_verified_and_removed_without_plaintext_files() {
        let namespace = format!("app.typedance.test.{}", crate::account::random_token());
        let vault = Vault::new(namespace).unwrap();
        let profile = crate::account::config::profile_key("test-only-issuer", "test-only-subject");
        assert!(vault.read(&profile, "model-api-key").unwrap().is_none());
        vault
            .write(&profile, "model-api-key", "test-only-local-key")
            .unwrap();
        assert_eq!(
            vault
                .read(&profile, "model-api-key")
                .unwrap()
                .unwrap()
                .as_str(),
            "test-only-local-key"
        );
        vault.delete(&profile, "model-api-key").unwrap();
        assert!(vault.read(&profile, "model-api-key").unwrap().is_none());
    }
}
