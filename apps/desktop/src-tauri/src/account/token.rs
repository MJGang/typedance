use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};

pub(crate) fn random_token() -> String {
    // 本机服务要求至少 32 个 URL 安全字符；32 随机字节编码后为 43 字符。
    let mut bytes = [0; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::random_token;

    #[test]
    fn generated_capability_satisfies_local_service_contract() {
        let token = random_token();
        assert_eq!(token.len(), 43, "capabilities encode 32 random bytes");
        assert!(token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'));
    }
}
