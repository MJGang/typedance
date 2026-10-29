use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{RawQuery, State},
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use openidconnect::{
    core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata, CoreUserInfoClaims},
    AccessTokenHash, AuthType, AuthorizationCode, ClientId, CsrfToken, IssuerUrl, Nonce,
    OAuth2TokenResponse, PkceCodeChallenge, RedirectUrl, RefreshToken, Scope, SubjectIdentifier,
    TokenResponse,
};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tokio::{net::TcpListener, sync::oneshot};
use tokio_util::sync::CancellationToken;
use url::Url;

use super::{
    config::{profile_key, AccountConfig, Provider},
    AccountUser,
};

#[derive(Deserialize)]
struct DiscoveryEndpoints {
    revocation_endpoint: String,
    end_session_endpoint: String,
}

pub(crate) struct Oidc {
    config: AccountConfig,
    metadata: CoreProviderMetadata,
    http: reqwest::Client,
    revoke_url: Url,
    logout_url: Url,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct StoredRefresh {
    pub(crate) token: String,
    pub(crate) nonce: String,
}

pub(crate) struct VerifiedSession {
    pub(crate) issuer: String,
    pub(crate) subject: String,
    pub(crate) profile: String,
    pub(crate) user: AccountUser,
    pub(crate) refresh: StoredRefresh,
    pub(crate) id_token_hint: Option<String>,
    pub(crate) refresh_after: Duration,
    pub(crate) expires_at: Instant,
}

pub(crate) struct RefreshFailure {
    pub(crate) message: String,
    pub(crate) retryable: bool,
    pub(crate) rotated: Option<StoredRefresh>,
}
impl From<&str> for RefreshFailure {
    fn from(message: &str) -> Self {
        Self {
            message: message.into(),
            retryable: false,
            rotated: None,
        }
    }
}
impl From<String> for RefreshFailure {
    fn from(message: String) -> Self {
        Self {
            message,
            retryable: false,
            rotated: None,
        }
    }
}
impl RefreshFailure {
    pub(crate) fn unavailable(message: String) -> Self {
        Self {
            message,
            retryable: true,
            rotated: None,
        }
    }
}

impl Oidc {
    pub(crate) async fn discover(config: AccountConfig) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| "无法初始化账号安全连接。")?;
        let issuer = IssuerUrl::new(config.issuer()).map_err(|_| "账号服务签发者无效。")?;
        let metadata = CoreProviderMetadata::discover_async(issuer, &http)
            .await
            .map_err(|_| "无法验证账号服务配置，请检查网络和 Logto 地址。")?;
        // 使用成熟 OIDC 库发现与校验 JWKS；额外端点只从同一受信配置取得，不接受客户端传入。
        let endpoints: DiscoveryEndpoints = http
            .get(format!(
                "{}/.well-known/openid-configuration",
                config.issuer()
            ))
            .send()
            .await
            .map_err(|_| "无法读取账号会话端点。")?
            .error_for_status()
            .map_err(|_| "账号服务配置请求失败。")?
            .json()
            .await
            .map_err(|_| "账号服务未提供会话撤销能力。")?;
        let base = Url::parse(&config.endpoint).map_err(|_| "账号地址无效。")?;
        let validate = |value: &str| -> Result<Url, String> {
            let value = Url::parse(value).map_err(|_| "账号服务端点无效。")?;
            if value.scheme() != "https"
                || value.origin() != base.origin()
                || !value.username().is_empty()
                || value.password().is_some()
            {
                return Err("账号服务端点不属于已配置的可信源。".into());
            }
            Ok(value)
        };
        validate(metadata.authorization_endpoint().as_str())?;
        if let Some(token) = metadata.token_endpoint() {
            validate(token.as_str())?;
        }
        validate(metadata.jwks_uri().as_str())?;
        if let Some(userinfo) = metadata.userinfo_endpoint() {
            validate(userinfo.as_str())?;
        }
        let revoke_url = validate(&endpoints.revocation_endpoint)?;
        let logout_url = validate(&endpoints.end_session_endpoint)?;
        Ok(Self {
            config,
            metadata,
            http,
            revoke_url,
            logout_url,
        })
    }

    pub(crate) async fn sign_in<F>(
        &self,
        provider: Option<Provider>,
        cancelled: CancellationToken,
        open: F,
    ) -> Result<VerifiedSession, String>
    where
        F: FnOnce(&str) -> Result<(), String>,
    {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "无法打开本机登录回调。")?;
        let authority = listener
            .local_addr()
            .map_err(|_| "无法读取登录回调地址。")?
            .to_string();
        let redirect = RedirectUrl::new(format!("http://{authority}/callback"))
            .map_err(|_| "登录回调地址无效。")?;
        let client = CoreClient::from_provider_metadata(
            self.metadata.clone(),
            ClientId::new(self.config.app_id.clone()),
            None,
        )
        .set_auth_type(AuthType::RequestBody)
        .set_redirect_uri(redirect);
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let mut request = client
            .authorize_url(
                CoreAuthenticationFlow::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .set_pkce_challenge(challenge)
            .add_scope(Scope::new("profile".into()))
            .add_scope(Scope::new("email".into()))
            .add_scope(Scope::new("offline_access".into()))
            .add_extra_param("prompt", "login consent");
        if let Some(provider) = provider {
            let connector = self
                .config
                .connectors
                .get(&provider)
                .ok_or("该登录方式尚未配置。")?;
            request = request.add_extra_param("direct_sign_in", format!("social:{connector}"));
        }
        let (url, state, nonce) = request.url();
        let (sender, receiver) = oneshot::channel();
        let callback_state = Arc::new(CallbackState {
            authority,
            expected_state: state.secret().clone(),
            sender: Mutex::new(Some(sender)),
        });
        let server_stop = CancellationToken::new();
        let server_signal = server_stop.clone();
        let task = tokio::spawn(async move {
            let router = Router::new()
                .route("/callback", get(callback))
                .with_state(callback_state);
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(server_signal.cancelled_owned())
                .await;
        });
        if let Err(error) = open(url.as_str()) {
            server_stop.cancel();
            task.abort();
            return Err(error);
        }
        let code = tokio::select! {
            _ = cancelled.cancelled() => Err("登录已取消。".to_string()),
            _ = tokio::time::sleep(Duration::from_secs(180)) => Err("登录已超时，请重新登录。".to_string()),
            result = receiver => result.map_err(|_| "登录回调已关闭。".to_string()).and_then(|value| value),
        };
        server_stop.cancel();
        task.abort();
        let code = code?;
        if cancelled.is_cancelled() {
            return Err("登录已取消。".into());
        }
        let response = client
            .exchange_code(AuthorizationCode::new(code))
            .map_err(|_| "无法交换登录授权。")?
            .set_pkce_verifier(verifier)
            .request_async(&self.http)
            .await
            .map_err(|_| "登录授权已失效或无法交换，请重新登录。")?;
        let id_token = response.id_token().ok_or("账号服务未返回身份凭证。")?;
        let id_verifier = client.id_token_verifier();
        let claims = id_token
            .claims(&id_verifier, &nonce)
            .map_err(|_| "账号身份验证失败，请重新登录。")?;
        if let Some(expected) = claims.access_token_hash() {
            let actual = AccessTokenHash::from_token(
                response.access_token(),
                id_token.signing_alg().map_err(|_| "身份签名无效。")?,
                id_token
                    .signing_key(&id_verifier)
                    .map_err(|_| "身份签名密钥无效。")?,
            )
            .map_err(|_| "登录凭证绑定验证失败。")?;
            if actual != *expected {
                return Err("登录凭证绑定验证失败。".into());
            }
        }
        let subject = claims.subject().as_str().to_string();
        let userinfo: CoreUserInfoClaims = client
            .user_info(
                response.access_token().clone(),
                Some(SubjectIdentifier::new(subject.clone())),
            )
            .map_err(|_| "账号服务未提供资料读取能力。")?
            .request_async(&self.http)
            .await
            .map_err(|_| "无法验证当前账号资料。")?;
        let token = response
            .refresh_token()
            .ok_or("账号服务未授予持续登录权限，请检查 Native 应用配置。")?
            .secret()
            .clone();
        Ok(build_session(
            &self.config,
            subject,
            userinfo,
            StoredRefresh {
                token,
                nonce: nonce.secret().clone(),
            },
            Some(id_token.to_string()),
            response.expires_in(),
        ))
    }

    pub(crate) async fn refresh(
        &self,
        subject: &str,
        stored: StoredRefresh,
    ) -> Result<VerifiedSession, RefreshFailure> {
        let client = CoreClient::from_provider_metadata(
            self.metadata.clone(),
            ClientId::new(self.config.app_id.clone()),
            None,
        )
        .set_auth_type(AuthType::RequestBody);
        let response = client
            .exchange_refresh_token(&RefreshToken::new(stored.token.clone()))
            .map_err(|_| "账号服务无法续期。")?
            .request_async(&self.http)
            .await
            .map_err(|error| RefreshFailure {
                message: "登录无法续期，请检查网络或重新登录。".into(),
                retryable: matches!(error, openidconnect::RequestTokenError::Request(_)),
                rotated: None,
            })?;
        let id_token_hint = if let Some(id_token) = response.id_token() {
            let verifier = client.id_token_verifier();
            let claims = id_token
                .claims(&verifier, |nonce: Option<&Nonce>| {
                    if nonce.is_some_and(|value| {
                        !bool::from(value.secret().as_bytes().ct_eq(stored.nonce.as_bytes()))
                    }) {
                        Err("刷新凭证 nonce 不匹配。".into())
                    } else {
                        Ok(())
                    }
                })
                .map_err(|_| "续期身份凭证验证失败。")?;
            if claims.subject().as_str() != subject {
                return Err("续期返回了其他账号，已阻止访问本机资料。".into());
            }
            if let Some(expected) = claims.access_token_hash() {
                let actual = AccessTokenHash::from_token(
                    response.access_token(),
                    id_token.signing_alg().map_err(|_| "身份签名无效。")?,
                    id_token
                        .signing_key(&verifier)
                        .map_err(|_| "身份签名密钥无效。")?,
                )
                .map_err(|_| "续期凭证绑定验证失败。")?;
                if actual != *expected {
                    return Err("续期凭证绑定验证失败。".into());
                }
            }
            Some(id_token.to_string())
        } else {
            None
        };
        let token = response
            .refresh_token()
            .map_or(stored.token, |value| value.secret().clone());
        let rotated = StoredRefresh {
            token,
            nonce: stored.nonce,
        };
        let userinfo: CoreUserInfoClaims = client
            .user_info(
                response.access_token().clone(),
                Some(SubjectIdentifier::new(subject.to_string())),
            )
            .map_err(|_| "账号服务未提供资料读取能力。")?
            .request_async(&self.http)
            .await
            .map_err(|error| RefreshFailure {
                message: "无法验证续期账号资料。".into(),
                retryable: matches!(error, openidconnect::UserInfoError::Request(_)),
                rotated: Some(rotated.clone()),
            })?;
        Ok(build_session(
            &self.config,
            subject.to_string(),
            userinfo,
            rotated,
            id_token_hint,
            response.expires_in(),
        ))
    }

    pub(crate) async fn revoke(&self, token: &str) -> Result<(), String> {
        self.http
            .post(self.revoke_url.clone())
            .form(&[
                ("token", token),
                ("token_type_hint", "refresh_token"),
                ("client_id", self.config.app_id.as_str()),
            ])
            .send()
            .await
            .map_err(|_| "本机已退出，但远端登录撤销未完成，请检查网络。")?
            .error_for_status()
            .map_err(|_| "本机已退出，但账号服务未确认撤销登录。")?;
        Ok(())
    }

    pub(crate) fn logout_url(&self, id_token_hint: Option<&str>) -> Url {
        let mut url = self.logout_url.clone();
        url.query_pairs_mut()
            .append_pair("client_id", &self.config.app_id);
        if let Some(hint) = id_token_hint {
            url.query_pairs_mut().append_pair("id_token_hint", hint);
        }
        url
    }
}

fn build_session(
    config: &AccountConfig,
    subject: String,
    userinfo: CoreUserInfoClaims,
    refresh: StoredRefresh,
    id_token_hint: Option<String>,
    expires_in: Option<Duration>,
) -> VerifiedSession {
    let issuer = config.issuer();
    let profile = profile_key(&issuer, &subject);
    let name = userinfo
        .name()
        .and_then(|value| value.get(None))
        .map(|value| value.as_str().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "TypeDance 用户".into());
    let user = AccountUser {
        id: profile.clone(),
        name,
        email: userinfo
            .email()
            .filter(|_| userinfo.email_verified() == Some(true))
            .map(|value| value.as_str().into()),
        avatar: userinfo
            .picture()
            .and_then(|value| value.get(None))
            .and_then(|value| Url::parse(value.as_str()).ok())
            .filter(|value| {
                value.scheme() == "https"
                    && value.username().is_empty()
                    && value.password().is_none()
            })
            .map(|value| value.to_string()),
    };
    let refresh_after = expires_in
        .unwrap_or(Duration::from_secs(300))
        .saturating_sub(Duration::from_secs(60))
        .clamp(Duration::from_secs(10), Duration::from_secs(300));
    let expires_at = Instant::now()
        + expires_in
            .unwrap_or(Duration::from_secs(300))
            .min(Duration::from_secs(86400));
    VerifiedSession {
        issuer,
        subject,
        profile,
        user,
        refresh,
        id_token_hint,
        refresh_after,
        expires_at,
    }
}

type CallbackSender = oneshot::Sender<Result<String, String>>;
struct CallbackState {
    authority: String,
    expected_state: String,
    sender: Mutex<Option<CallbackSender>>,
}

fn parse_callback(query: &str, expected_state: &str) -> Result<String, String> {
    if query.len() > 8192 {
        return Err("登录回调内容过长。".into());
    }
    let mut values = HashMap::new();
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        if values
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err("登录回调参数重复。".into());
        }
    }
    let state = values.get("state").ok_or("登录回调缺少安全状态。")?;
    if !bool::from(state.as_bytes().ct_eq(expected_state.as_bytes())) {
        return Err("登录回调安全状态不匹配。".into());
    }
    if values.contains_key("error") {
        return Err("账号服务未完成授权，请重新登录。".into());
    }
    values
        .remove("code")
        .filter(|value| !value.is_empty() && value.len() <= 4096)
        .ok_or_else(|| "登录回调缺少授权码。".into())
}

async fn callback(
    State(state): State<Arc<CallbackState>>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> Response {
    if headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        != Some(state.authority.as_str())
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let query = query.unwrap_or_default();
    let result = parse_callback(&query, &state.expected_state);
    // 错误 state 不消费本次授权，防止无关网页提前关闭合法登录。
    let has_expected_state = url::form_urlencoded::parse(query.as_bytes()).any(|(key, value)| {
        key == "state" && bool::from(value.as_bytes().ct_eq(state.expected_state.as_bytes()))
    });
    if !has_expected_state {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(mut sender) = state.sender.lock() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Some(sender) = sender.take() else {
        return StatusCode::CONFLICT.into_response();
    };
    let success = result.is_ok();
    let _ = sender.send(result);
    let text = if success {
        "已收到授权。请返回 TypeDance，等待身份验证完成。"
    } else {
        "登录未完成。请返回 TypeDance 重试。"
    };
    ([(header::CACHE_CONTROL, "no-store"), (header::REFERRER_POLICY, "no-referrer"), (header::CONTENT_SECURITY_POLICY, "default-src 'none'; frame-ancestors 'none'")], Html(format!("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>TypeDance 登录</title><p>{text}</p></html>"))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callbacks_reject_replay_ambiguity_wrong_state_and_provider_errors() {
        assert_eq!(
            parse_callback("code=valid&state=expected", "expected").unwrap(),
            "valid"
        );
        assert!(parse_callback("code=valid&state=wrong", "expected").is_err());
        assert!(parse_callback("code=valid&state=wrong&state=expected", "expected").is_err());
        assert!(parse_callback("code=one&code=two&state=expected", "expected").is_err());
        assert!(parse_callback("error=access_denied&state=expected", "expected").is_err());
        assert!(parse_callback("code=valid", "expected").is_err());
    }
}
