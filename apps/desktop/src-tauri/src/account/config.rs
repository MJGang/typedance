use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Provider {
    Github,
}

pub(super) fn github_client_id() -> Option<String> {
    std::env::var("TYPEDANCE_GITHUB_CLIENT_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| option_env!("TYPEDANCE_GITHUB_CLIENT_ID").map(str::to_owned))
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        })
}

pub(crate) fn profile_key(issuer: &str, subject: &str) -> String {
    let digest = Sha256::digest(format!("{issuer}\0{subject}").as_bytes());
    format!("{digest:x}")
}
