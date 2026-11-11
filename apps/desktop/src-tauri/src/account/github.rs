use serde::Deserialize;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

pub(super) const VERIFY_URL: &str = "https://github.com/login/device";

#[derive(Deserialize)]
pub(super) struct DeviceCode {
    device_code: String,
    pub(super) user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    interval: Option<u64>,
}

#[derive(Deserialize)]
struct GithubError {
    error: String,
}

#[derive(Deserialize)]
struct GithubUser {
    id: u64,
}

pub(super) struct Github {
    client: reqwest::Client,
    id: String,
}

impl Github {
    pub(super) fn new(id: String) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("TypeDance Desktop")
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| "无法初始化 GitHub 授权。")?;
        Ok(Self { client, id })
    }

    pub(super) async fn begin(&self) -> Result<DeviceCode, String> {
        let response = self
            .client
            .post("https://github.com/login/device/code")
            .header("accept", "application/json")
            .form(&[("client_id", &self.id)])
            .send()
            .await
            .map_err(|_| "无法连接 GitHub，请检查网络。")?;
        if !response.status().is_success() {
            if response
                .json::<GithubError>()
                .await
                .is_ok_and(|error| error.error == "device_flow_disabled")
            {
                return Err("GitHub OAuth App 尚未启用 Device Flow。".into());
            }
            return Err("GitHub 无法启动设备授权。".into());
        }
        let code: DeviceCode = response
            .json()
            .await
            .map_err(|_| "GitHub 未返回设备码，请检查 OAuth App 是否启用 Device Flow。")?;
        if code.verification_uri != VERIFY_URL
            || code.device_code.is_empty()
            || code.user_code.is_empty()
            || code.user_code.len() > 32
            || !code
                .user_code
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || !(1..=900).contains(&code.expires_in)
            || !(1..=900).contains(&code.interval)
        {
            return Err("GitHub 返回了无效的设备授权信息。".into());
        }
        Ok(code)
    }

    pub(super) async fn finish(
        &self,
        code: DeviceCode,
        cancel: &CancellationToken,
    ) -> Result<String, String> {
        let duration = Duration::from_secs(code.expires_in);
        tokio::select! {
            _ = cancel.cancelled() => Err("GitHub 授权已取消。".into()),
            result = tokio::time::timeout(duration, self.poll(code)) =>
                result.map_err(|_| "GitHub 授权码已过期，请重试。".to_owned())?,
        }
    }

    async fn poll(&self, code: DeviceCode) -> Result<String, String> {
        let mut interval = code.interval;
        let deadline = Instant::now() + Duration::from_secs(code.expires_in);
        loop {
            if Instant::now() + Duration::from_secs(interval) >= deadline {
                return Err("GitHub 授权码已过期，请重试。".into());
            }
            tokio::time::sleep(Duration::from_secs(interval)).await;
            let response: TokenResponse = self
                .client
                .post("https://github.com/login/oauth/access_token")
                .header("accept", "application/json")
                .form(&[
                    ("client_id", self.id.as_str()),
                    ("device_code", code.device_code.as_str()),
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ])
                .send()
                .await
                .map_err(|_| "无法连接 GitHub，请重试授权。")?
                .error_for_status()
                .map_err(|_| "GitHub 设备授权请求失败。")?
                .json()
                .await
                .map_err(|_| "GitHub 设备授权结果无效。")?;
            match response.error.as_deref() {
                Some("authorization_pending") => continue,
                Some("slow_down") => {
                    interval = response.interval.unwrap_or(0).max(interval + 5).min(900)
                }
                Some("access_denied") => return Err("GitHub 授权被拒绝。".into()),
                Some("expired_token") => return Err("GitHub 授权码已过期，请重试。".into()),
                Some(_) => return Err("GitHub 设备授权失败，请检查 OAuth App 配置。".into()),
                None => {
                    let token =
                        Zeroizing::new(response.access_token.ok_or("GitHub 未返回访问凭据。")?);
                    let user: GithubUser = self
                        .client
                        .get("https://api.github.com/user")
                        .header("accept", "application/vnd.github+json")
                        .bearer_auth(token.as_str())
                        .send()
                        .await
                        .map_err(|_| "无法确认 GitHub 账号。")?
                        .error_for_status()
                        .map_err(|_| "GitHub 无法确认当前授权账号。")?
                        .json()
                        .await
                        .map_err(|_| "GitHub 账号资料无效。")?;
                    if user.id == 0 {
                        return Err("GitHub 账号标识无效。".into());
                    }
                    return Ok(user.id.to_string());
                }
            }
        }
    }
}
