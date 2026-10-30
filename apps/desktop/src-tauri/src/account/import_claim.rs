use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

const RECEIPT: &str = ".typedance-account-owner.json";
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Claim {
    profile: String,
}

pub(super) fn owner(source: &Path) -> Result<Option<String>, String> {
    match fs::read(source.join(RECEIPT)) {
        Ok(bytes) => {
            let claim: Claim = serde_json::from_slice(&bytes)
                .map_err(|_| "历史资料归属记录无效，请保留原资料并修复记录后重试。")?;
            Ok(Some(claim.profile))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("无法读取历史资料归属记录。".into()),
    }
}

pub(super) fn available(source: &Path, profile: &str) -> Result<bool, String> {
    Ok(owner(source)?.is_none_or(|owner| owner == profile))
}

/// 认领先于复制，失败可由同一账号继续；原资料备份不会再次分配给其他账号。
pub(super) fn reserve(source: &Path, profile: &str) -> Result<(), String> {
    let value = serde_json::to_vec(&Claim {
        profile: profile.into(),
    })
    .map_err(|_| "无法创建资料归属记录。")?;
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(source.join(RECEIPT))
    {
        Ok(mut file) => file
            .write_all(&value)
            .and_then(|_| file.sync_all())
            .map_err(|_| "无法保存资料归属记录，尚未开始复制。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if available(source, profile)? {
                Ok(())
            } else {
                Err("这份历史资料已由另一个账号认领。".into())
            }
        }
        Err(_) => Err("无法创建资料归属记录，尚未开始复制。".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interrupted_import_remains_owned_and_only_the_owner_can_resume() {
        let path = std::env::temp_dir().join(format!(
            "typedance-claim-{}",
            crate::account::random_token()
        ));
        fs::create_dir(&path).unwrap();
        assert!(available(&path, "a").unwrap());
        reserve(&path, "a").unwrap();
        reserve(&path, "a").unwrap();
        assert!(!available(&path, "b").unwrap());
        assert!(reserve(&path, "b").is_err());
        fs::remove_file(path.join(RECEIPT)).unwrap();
        fs::remove_dir(path).unwrap();
    }
}
