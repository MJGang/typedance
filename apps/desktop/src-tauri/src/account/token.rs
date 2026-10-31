use openidconnect::CsrfToken;

pub(crate) fn random_token() -> String {
    // 本机服务要求至少 32 个 URL 安全字符；32 随机字节编码后为 43 字符。
    CsrfToken::new_random_len(32).secret().clone()
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
