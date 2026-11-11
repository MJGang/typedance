#[path = "../src/account/config.rs"]
#[allow(dead_code)]
mod config;
#[path = "../src/account/vault.rs"]
mod vault;

use serde_json::json;
use std::{fs, path::PathBuf};

const ENDPOINT: &str = "https://typedance-migration-fixture.invalid";
const APP_ID: &str = "fixture-app";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .ok_or("Missing fixture directory")?,
    );
    let in_smoke_root = root
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.starts_with("typedance-release-smoke-"));
    if !root.is_absolute()
        || !in_smoke_root
        || root.file_name().and_then(|value| value.to_str()) != Some("migration-account-data")
    {
        return Err("Expected the isolated installer smoke fixture directory".into());
    }
    let issuer = format!("{ENDPOINT}/oidc");
    let subject = root.to_string_lossy().to_string();
    let id = config::profile_key(&issuer, &subject);
    let profile = root.join("profiles").join(&id);
    let legacy = vault::Vault::new(format!(
        "app.typedance.desktop.account.{}",
        config::profile_key(&issuer, APP_ID)
    ))?;
    let operation = std::env::args().nth(2);
    if let Some(operation) = operation.as_deref() {
        let local = vault::Vault::new("app.typedance.desktop.local".into())?;
        let scope =
            config::profile_key("typedance.device", &root.canonicalize()?.to_string_lossy());
        match operation {
            "verify" => {
                if !local
                    .read(&scope, "session")?
                    .is_some_and(|value| value.as_str() == id)
                    || !local
                        .read(&id, "model-api-key")?
                        .is_some_and(|value| value.as_str() == "fixture-only-model-key")
                {
                    return Err("The migrated login or model key is missing".into());
                }
            }
            "cleanup" => {
                legacy.delete(&id, "refresh")?;
                legacy.delete(&id, "model-api-key")?;
                local.delete(&scope, "session")?;
                local.delete(&scope, "device")?;
                local.delete(&id, "model-api-key")?;
            }
            _ => return Err("Unknown migration fixture operation".into()),
        }
        return Ok(());
    }
    fs::create_dir_all(&profile)?;
    fs::write(root.join("last-account.json"), serde_json::to_vec(&id)?)?;
    fs::write(
        profile.join(".account-profile.json"),
        serde_json::to_vec(&json!({
            "issuer": issuer, "subject": subject, "profile": id,
        }))?,
    )?;
    legacy.write(&id, "refresh", &json!({
        "issuer": issuer, "subject": subject, "refresh": {"token": "fixture-token", "nonce": "fixture"},
    }).to_string())?;
    legacy.write(&id, "model-api-key", "fixture-only-model-key")?;
    if Vault::previous_account_vaults(&id)?.len() != 1 {
        return Err("The isolated previous credential could not be identified".into());
    }
    println!("{id}");
    Ok(())
}
