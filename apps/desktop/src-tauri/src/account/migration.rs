use super::{
    config::{profile_key, MigrationConfig},
    legacy_entries,
    local::{self, Account, Accounts},
    plain_directory,
    vault::Vault,
};
use serde::Deserialize;
use std::{fs, path::Path};
use tauri::AppHandle;

#[derive(Deserialize, PartialEq, Eq)]
struct PreviousProfile {
    issuer: String,
    subject: String,
    profile: String,
}

#[derive(Deserialize)]
struct PreviousSession {
    issuer: String,
    subject: String,
}

impl PreviousProfile {
    fn belongs_to(&self, id: &str, issuer: &str, saved: &PreviousSession) -> bool {
        self.profile == id
            && self.issuer == issuer
            && saved.issuer == self.issuer
            && saved.subject == self.subject
            && profile_key(&self.issuer, &self.subject) == id
    }
}

pub(super) async fn adopt(
    app: &AppHandle,
    root: &Path,
    accounts: &mut Accounts,
) -> Result<Option<Account>, String> {
    let pointer = root.join("last-account.json");
    if !pointer.is_file() {
        let profiles = root.join("profiles");
        if profiles.is_dir()
            && fs::read_dir(profiles)
                .map_err(|_| "无法检查旧工作区。")?
                .filter_map(Result::ok)
                .any(|entry| entry.path().join(".account-profile.json").is_file())
        {
            return Err(
                "检测到未迁移的旧工作区。请在旧版客户端登录原账号并退出客户端，然后重新启动新版。"
                    .into(),
            );
        }
        return Ok(None);
    }
    let config = MigrationConfig::load(root)?;
    let id: String = read_json(&pointer)?;
    if id.len() != 64 || !id.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err("旧账号的工作区标识无效。".into());
    }
    let legacy_vault = Vault::new(config.namespace())?;
    let stored = legacy_vault
        .read(&id, "refresh")?
        .ok_or("请在旧版客户端登录原账号后重试迁移。")?;
    let stored: PreviousSession =
        serde_json::from_str(stored.as_str()).map_err(|_| "旧账号的本机凭据无效。")?;
    let profiles = root.join("profiles");
    plain_directory(&profiles)?;
    let profile = profiles.join(&id);
    plain_directory(&profile)?;
    let owner: PreviousProfile = read_json(&profile.join(".account-profile.json"))?;
    if !owner.belongs_to(&id, &config.issuer(), &stored) {
        return Err("旧凭据与工作区归属不匹配，已保留原资料。".into());
    }

    let backup_root = root.join("account-backups");
    fs::create_dir_all(&backup_root).map_err(|_| "无法创建资料备份目录。")?;
    plain_directory(&backup_root)?;
    let backup = backup_root.join(format!("{}-{}", &id[..12], super::random_token()));
    let mut entries = legacy_entries(&profile);
    entries.push(".account-profile.json".into());
    crate::runtime::run_offline(
        app,
        "typedance-sidecar",
        vec![
            "--migrate-local-data".into(),
            "--preserve-file-references".into(),
            "--source-data-dir".into(),
            profile.clone().into_os_string(),
            "--data-dir".into(),
            backup.into_os_string(),
            "--entries-json".into(),
            serde_json::to_string(&entries)
                .map_err(|_| "无法准备资料备份。")?
                .into(),
        ],
    )
    .await?;

    if let Some(key) = legacy_vault.read(&id, "model-api-key")? {
        Vault::new(local::VAULT_NAMESPACE.into())?.write(&id, "model-api-key", key.as_str())?;
    }
    super::write_json(&profile.join(".local-account.json"), &id)?;
    local::remember_account(root, &id)?;
    let account = accounts.insert(Account::new(id, "TypeDance 用户")?)?;
    Ok(Some(account))
}

fn read_json<T: serde::de::DeserializeOwned>(file: &Path) -> Result<T, String> {
    serde_json::from_slice(&fs::read(file).map_err(|_| "无法读取旧账号资料归属。")?)
        .map_err(|_| "旧账号资料归属无效。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_requires_the_saved_session_to_own_the_exact_workspace() {
        let issuer = "https://old.example.test/oidc";
        let id = profile_key(issuer, "old-user");
        let profile = PreviousProfile {
            issuer: issuer.into(),
            subject: "old-user".into(),
            profile: id.clone(),
        };
        let mut session = PreviousSession {
            issuer: issuer.into(),
            subject: "old-user".into(),
        };
        assert!(profile.belongs_to(&id, issuer, &session));
        assert!(!profile.belongs_to(&id, "https://other.example.test/oidc", &session));
        assert!(!profile.belongs_to(&profile_key(issuer, "other-user"), issuer, &session));
        session.subject = "other-user".into();
        assert!(!profile.belongs_to(&id, issuer, &session));
    }
}
