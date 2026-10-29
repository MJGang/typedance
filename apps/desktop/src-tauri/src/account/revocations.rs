use super::{
    config::{profile_key, AccountConfig},
    oidc::Oidc,
    vault::Vault,
    write_json,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Pending {
    id: String,
    config: AccountConfig,
}

fn index(data: &Path) -> Result<Vec<Pending>, String> {
    match fs::read(data.join("pending-revocations.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "待撤销会话记录无效。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(_) => Err("无法读取待撤销会话记录。".into()),
    }
}

/// 文件只存公开应用配置和随机索引，待撤销 token 始终留在系统安全存储。
pub(super) fn enqueue(data: &Path, config: &AccountConfig, token: &str) -> Result<(), String> {
    let mut pending = index(data)?;
    let id = profile_key("pending-revocation", &super::random_token());
    let vault = Vault::new(config.vault_namespace())?;
    vault.write(&id, "pending-revocation", token)?;
    pending.push(Pending {
        id: id.clone(),
        config: config.clone(),
    });
    if let Err(error) = write_json(&data.join("pending-revocations.json"), &pending) {
        let _ = vault.delete(&id, "pending-revocation");
        return Err(error);
    }
    Ok(())
}

pub(super) async fn retry(data: &Path) -> Result<(), String> {
    let mut pending = index(data)?;
    while !pending.is_empty() {
        let item = &mut pending[0];
        item.config.validate()?;
        let vault = Vault::new(item.config.vault_namespace())?;
        let token = vault.read(&item.id, "pending-revocation")?;
        if let Some(token) = token {
            let oidc = Oidc::discover(item.config.clone()).await?;
            oidc.revoke(&token).await?;
        }
        let item = pending.remove(0);
        // 先删公开索引再删已失效凭据；中断只会留下不可使用的凭据。
        write_json(&data.join("pending-revocations.json"), &pending)?;
        vault.delete(&item.id, "pending-revocation")?;
    }
    Ok(())
}
