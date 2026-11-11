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

    pub(super) fn previous_account_vaults(profile: &str) -> Result<Vec<Self>, String> {
        if profile.len() != 64 || !profile.bytes().all(|value| value.is_ascii_hexdigit()) {
            return Err("旧账号凭据标识无效。".into());
        }
        previous_account_namespaces(profile)?
            .into_iter()
            .map(Self::new)
            .collect()
    }
}

#[cfg(windows)]
fn previous_account_namespaces(profile: &str) -> Result<Vec<String>, String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{CredEnumerateW, CredFree, CREDENTIALW, CRED_TYPE_GENERIC},
    };

    struct Entries(*mut *mut CREDENTIALW);
    impl Drop for Entries {
        fn drop(&mut self) {
            // CredEnumerateW allocates the array and its contents as one block.
            unsafe { CredFree(self.0.cast()) };
        }
    }

    // The previous Windows store formed TargetName as user + "." + service.
    let namespace_prefix = "app.typedance.desktop.account.";
    let prefix = format!("refresh:{profile}.{namespace_prefix}");
    let filter: Vec<u16> = format!("{prefix}*").encode_utf16().chain([0]).collect();
    let mut count = 0;
    let mut pointer = std::ptr::null_mut();
    // Filter at the OS boundary. The migration only inspects this app's matching target names.
    if unsafe { CredEnumerateW(filter.as_ptr(), 0, &mut count, &mut pointer) } == 0 {
        return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
            Ok(Vec::new())
        } else {
            Err("无法查询旧账号的 Windows 凭据。".into())
        };
    }
    if pointer.is_null() {
        return Ok(Vec::new());
    }
    let entries = Entries(pointer);
    // Successful enumeration supplies a count-element array valid until CredFree.
    let pointers = unsafe { std::slice::from_raw_parts(entries.0, count as usize) };
    let mut namespaces = Vec::new();
    for &entry in pointers {
        let Some(entry) = (unsafe { entry.as_ref() }) else {
            continue;
        };
        if entry.Type != CRED_TYPE_GENERIC || entry.TargetName.is_null() {
            continue;
        }
        // TargetName is NUL-terminated. Stop at NUL or one unit beyond the expected length.
        let name: Vec<u16> = (0..=prefix.len() + 64)
            .map(|offset| unsafe { *entry.TargetName.add(offset) })
            .take_while(|unit| *unit != 0)
            .collect();
        let Ok(name) = String::from_utf16(&name) else {
            continue;
        };
        if let Some(suffix) = name.strip_prefix(&prefix) {
            if suffix.len() == 64 && suffix.bytes().all(|value| value.is_ascii_hexdigit()) {
                namespaces.push(format!("{namespace_prefix}{suffix}"));
            }
        }
    }
    Ok(namespaces)
}

#[cfg(not(windows))]
fn previous_account_namespaces(_: &str) -> Result<Vec<String>, String> {
    Err("当前账号安全存储仅支持 Windows 桌面端。".into())
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

    #[test]
    fn previous_account_discovery_only_matches_our_exact_profile_target() {
        use crate::account::config::profile_key;
        let seed = crate::account::random_token();
        let profile = profile_key("fixture", &seed);
        let another = profile_key("different-profile", &seed);
        let namespace = format!(
            "app.typedance.desktop.account.{}",
            profile_key("legacy", &seed)
        );
        let legacy = Vault::new(namespace.clone()).unwrap();
        let unrelated = Vault::new(format!("example.other-app.{seed}")).unwrap();
        legacy.write(&profile, "refresh", "fixture-only").unwrap();
        legacy.write(&another, "refresh", "fixture-only").unwrap();
        unrelated
            .write(&profile, "refresh", "fixture-only")
            .unwrap();
        let matches: Vec<_> = Vault::previous_account_vaults(&profile)
            .unwrap()
            .into_iter()
            .map(|vault| vault.service)
            .collect();
        unrelated.delete(&profile, "refresh").unwrap();
        legacy.delete(&another, "refresh").unwrap();
        legacy.delete(&profile, "refresh").unwrap();
        assert_eq!(matches, vec![namespace]);
    }
}
