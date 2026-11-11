use super::{config::profile_key, random_token, vault::Vault, write_json, AccountUser};
use argon2::{password_hash::SaltString, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use subtle::ConstantTimeEq;

pub(super) const VAULT_NAMESPACE: &str = "app.typedance.desktop.local";

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct Account {
    pub(super) user: AccountUser,
    #[serde(default)]
    identities: Vec<Identity>,
    password: Option<String>,
    recovery: Option<[u8; 32]>,
}

#[derive(Clone, Deserialize, Serialize)]
struct Identity {
    provider: String,
    subject: String,
}

#[derive(Deserialize, Serialize)]
pub(super) struct Accounts {
    device: String,
    accounts: Vec<Account>,
    #[serde(skip)]
    file: PathBuf,
}

impl Accounts {
    pub(super) fn open(root: &Path) -> Result<Self, String> {
        let file = root.join("local-accounts.json");
        let vault = Vault::new(VAULT_NAMESPACE.into())?;
        let scope = vault_scope(root)?;
        if file.is_file() {
            let mut store: Self =
                serde_json::from_slice(&fs::read(&file).map_err(|_| "无法读取本机账号。")?)
                    .map_err(|_| "本机账号数据损坏，请使用备份恢复。")?;
            let device = vault
                .read(&scope, "device")?
                .ok_or("此账号库属于另一台设备或 Windows 用户。")?;
            let fingerprint = profile_key("typedance.device-key", device.as_str());
            if !bool::from(store.device.as_bytes().ct_eq(fingerprint.as_bytes())) {
                return Err("本机账号库的设备标识不匹配。".into());
            }
            store.file = file;
            return Ok(store);
        }
        let device_key = random_token();
        vault.write(&scope, "device", &device_key)?;
        let store = Self {
            device: profile_key("typedance.device-key", &device_key),
            accounts: Vec::new(),
            file,
        };
        store.save()?;
        Ok(store)
    }

    fn save(&self) -> Result<(), String> {
        write_json(&self.file, self)
    }

    pub(super) fn find(&self, id: &str) -> Result<Account, String> {
        self.accounts
            .iter()
            .find(|account| account.user.id == id)
            .cloned()
            .ok_or_else(|| "本机账号不存在。".into())
    }

    pub(super) fn is_empty(&self) -> bool {
        self.accounts.is_empty()
    }

    pub(super) fn insert(&mut self, account: Account) -> Result<Account, String> {
        self.accounts.push(account.clone());
        self.save()?;
        Ok(account)
    }

    pub(super) fn register(
        &mut self,
        name: &str,
        email: &str,
        password: &str,
    ) -> Result<(Account, String), String> {
        let mut account = Account::new(profile_key("typedance.local", &random_token()), name)?;
        account.user.email = Some(self.available_email(email, &account.user.id)?);
        let recovery = account.set_password(password)?;
        Ok((self.insert(account)?, recovery))
    }

    pub(super) fn authenticate(&self, email: &str, password: &str) -> Result<Account, String> {
        if password.len() > 1024 {
            return Err("邮箱或密码不正确。".into());
        }
        let account = self.by_email(email).ok_or("邮箱或密码不正确。")?;
        let hash = account
            .password
            .as_deref()
            .and_then(|value| PasswordHash::new(value).ok())
            .ok_or("邮箱或密码不正确。")?;
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .map_err(|_| "邮箱或密码不正确。")?;
        Ok(account.clone())
    }

    pub(super) fn github(
        &mut self,
        subject: &str,
        current: Option<&str>,
    ) -> Result<Account, String> {
        let owner = self.accounts.iter().find(|account| {
            account
                .identities
                .iter()
                .any(|identity| identity.provider == "github" && identity.subject == subject)
        });
        if let Some(owner) = owner {
            if current.is_some_and(|id| owner.user.id != id) {
                return Err("此 GitHub 账号已绑定另一个本机账号。".into());
            }
            return Ok(owner.clone());
        }
        let mut account = match current {
            Some(id) => self.find(id)?,
            None => Account::new(
                profile_key("typedance.local", &random_token()),
                "TypeDance 用户",
            )?,
        };
        if account.github_bound() {
            return Err("当前账号已绑定 GitHub。".into());
        }
        account.identities.push(Identity {
            provider: "github".into(),
            subject: subject.into(),
        });
        match current {
            Some(_) => self.replace(account),
            None => self.insert(account),
        }
    }

    pub(super) fn update(
        &mut self,
        id: &str,
        name: &str,
        email: &str,
        avatar: Option<String>,
    ) -> Result<Account, String> {
        let mut account = self.find(id)?;
        account.user.name = checked_name(name)?;
        account.user.email = if email.trim().is_empty() && account.password.is_none() {
            None
        } else {
            Some(self.available_email(email, id)?)
        };
        account.user.avatar = avatar.map(checked_avatar).transpose()?;
        self.replace(account)
    }

    pub(super) fn change_password(
        &mut self,
        id: &str,
        password: &str,
    ) -> Result<(Account, String), String> {
        let mut account = self.find(id)?;
        let recovery = account.set_password(password)?;
        Ok((self.replace(account)?, recovery))
    }

    pub(super) fn recover(
        &mut self,
        email: &str,
        recovery: &str,
        password: &str,
    ) -> Result<String, String> {
        let account = self.by_email(email).ok_or("邮箱或恢复码不正确。")?;
        let expected = account.recovery.ok_or("邮箱或恢复码不正确。")?;
        let actual: [u8; 32] = Sha256::digest(recovery.trim().as_bytes()).into();
        if !bool::from(expected.ct_eq(&actual)) {
            return Err("邮箱或恢复码不正确。".into());
        }
        self.change_password(&account.user.id.clone(), password)
            .map(|(_, next)| next)
    }

    fn by_email(&self, email: &str) -> Option<&Account> {
        self.accounts.iter().find(|account| {
            account
                .user
                .email
                .as_deref()
                .is_some_and(|saved| saved.eq_ignore_ascii_case(email.trim()))
        })
    }

    fn available_email(&self, email: &str, account_id: &str) -> Result<String, String> {
        let email = email.trim();
        let valid = email.split_once('@').is_some_and(|(local, host)| {
            !local.is_empty() && host.contains('.') && !host.contains('@')
        });
        if email.len() > 254
            || !valid
            || email
                .chars()
                .any(|value| value.is_whitespace() || value.is_control())
        {
            return Err("请输入有效的邮箱地址。".into());
        }
        if self
            .by_email(email)
            .is_some_and(|account| account.user.id != account_id)
        {
            return Err("此邮箱已被另一个本机账号使用。".into());
        }
        Ok(email.to_ascii_lowercase())
    }

    fn replace(&mut self, account: Account) -> Result<Account, String> {
        let saved = self
            .accounts
            .iter_mut()
            .find(|saved| saved.user.id == account.user.id)
            .ok_or("本机账号不存在。")?;
        *saved = account.clone();
        self.save()?;
        Ok(account)
    }
}

impl Account {
    pub(super) fn new(id: String, name: &str) -> Result<Self, String> {
        Ok(Self {
            user: AccountUser {
                id,
                name: checked_name(name)?,
                email: None,
                avatar: None,
            },
            identities: Vec::new(),
            password: None,
            recovery: None,
        })
    }

    pub(super) fn github_bound(&self) -> bool {
        self.identities
            .iter()
            .any(|identity| identity.provider == "github")
    }

    pub(super) fn can_log_in(&self) -> bool {
        self.password.is_some() || self.github_bound()
    }

    fn set_password(&mut self, password: &str) -> Result<String, String> {
        if self.user.email.is_none() {
            return Err("请先在当前账号保存邮箱。".into());
        }
        if password.chars().count() < 8 || password.len() > 1024 {
            return Err("密码至少需要 8 个字符。".into());
        }
        let salt =
            SaltString::encode_b64(&rand::random::<[u8; 16]>()).map_err(|_| "无法生成密码盐。")?;
        self.password = Some(
            Argon2::default()
                .hash_password(password.as_bytes(), &salt)
                .map_err(|_| "无法安全保存密码。")?
                .to_string(),
        );
        let recovery = random_token();
        self.recovery = Some(Sha256::digest(recovery.as_bytes()).into());
        Ok(recovery)
    }
}

pub(super) fn remembered_account(root: &Path) -> Result<Option<String>, String> {
    let vault = Vault::new(VAULT_NAMESPACE.into())?;
    Ok(vault
        .read(&vault_scope(root)?, "session")?
        .map(|value| value.to_string()))
}

pub(super) fn remember_account(root: &Path, id: &str) -> Result<(), String> {
    Vault::new(VAULT_NAMESPACE.into())?.write(&vault_scope(root)?, "session", id)
}

pub(super) fn forget_account(root: &Path) -> Result<(), String> {
    Vault::new(VAULT_NAMESPACE.into())?.delete(&vault_scope(root)?, "session")
}

fn vault_scope(root: &Path) -> Result<String, String> {
    let canonical = root
        .canonicalize()
        .map_err(|_| "无法定位本机账号凭据空间。")?;
    Ok(profile_key(
        "typedance.device",
        &canonical.to_string_lossy(),
    ))
}

fn checked_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
        return Err("昵称需要 1 到 40 个字符。".into());
    }
    Ok(name.into())
}

fn checked_avatar(value: String) -> Result<String, String> {
    let encoded = value
        .strip_prefix("data:image/png;base64,")
        .ok_or("头像格式无效。")?;
    if encoded.len() > 160_000 {
        return Err("头像太大，请更换图片。".into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| "头像格式无效。")?;
    if bytes.len() < 24 || &bytes[..16] != b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR" {
        return Err("头像格式无效。".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if !(1..=256).contains(&width) || !(1..=256).contains(&height) {
        return Err("头像尺寸无效。".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_login_and_password_login_resolve_to_the_same_local_profile() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Accounts {
            device: "test".into(),
            accounts: Vec::new(),
            file: root.path().join("local-accounts.json"),
        };
        let (original, _) = store
            .register("本机昵称", "test@example.com", "my-password")
            .unwrap();
        let id = &original.user.id;
        store.github("456", Some(id)).unwrap();
        let signed_in = store.github("456", None).unwrap();
        assert_eq!(signed_in.user.id, *id);
        assert_eq!(signed_in.user.name, "本机昵称");
        assert_eq!(
            store
                .authenticate("TEST@example.com", "my-password")
                .unwrap()
                .user
                .id,
            *id
        );
        let other = store.github("789", None).unwrap();
        assert!(store.github("456", Some(&other.user.id)).is_err());
        assert!(store.github("789", Some(id)).is_err());
    }

    #[test]
    fn password_recovery_rotates_the_recovery_code_and_preserves_account_id() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Accounts {
            device: "test".into(),
            accounts: Vec::new(),
            file: root.path().join("local-accounts.json"),
        };
        let (account, code) = store
            .register("本机账号", "test@example.com", "old-password")
            .unwrap();
        assert!(store
            .recover("test@example.com", "invalid", "new-password")
            .is_err());
        let next = store
            .recover("test@example.com", &code, "new-password")
            .unwrap();
        assert_ne!(next, code);
        assert!(store
            .recover("test@example.com", &code, "newer-password")
            .is_err());
        assert!(store
            .authenticate("test@example.com", "old-password")
            .is_err());
        assert_eq!(
            store
                .authenticate("test@example.com", "new-password")
                .unwrap()
                .user
                .id,
            account.user.id
        );
        let saved = fs::read_to_string(&store.file).unwrap();
        assert!(!saved.contains("new-password"));
        assert!(!saved.contains(&next));
    }

    #[cfg(windows)]
    #[test]
    fn saved_session_survives_reopening_but_does_not_travel_with_the_account_file() {
        let source = tempfile::tempdir().unwrap();
        let copy = tempfile::tempdir().unwrap();
        let mut store = Accounts::open(source.path()).unwrap();
        let account = store.github("test-identity", None).unwrap();
        remember_account(source.path(), &account.user.id).unwrap();

        let remembered = remembered_account(source.path()).unwrap().unwrap();
        let reopened = Accounts::open(source.path())
            .unwrap()
            .find(&remembered)
            .unwrap();
        assert_eq!(reopened.user.id, account.user.id);

        fs::copy(&store.file, copy.path().join("local-accounts.json")).unwrap();
        assert!(Accounts::open(copy.path()).is_err());
        assert!(remembered_account(copy.path()).unwrap().is_none());

        forget_account(source.path()).unwrap();
        assert!(remembered_account(source.path()).unwrap().is_none());
        Vault::new(VAULT_NAMESPACE.into())
            .unwrap()
            .delete(&vault_scope(source.path()).unwrap(), "device")
            .unwrap();
    }
}
