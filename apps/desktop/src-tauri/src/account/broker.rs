use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use subtle::ConstantTimeEq;
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_util::sync::CancellationToken;

use super::vault::Vault;

pub(crate) trait ModelSecrets: Send + Sync {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

struct ProfileSecrets {
    vault: Vault,
    profile: String,
}
impl ModelSecrets for ProfileSecrets {
    fn get(&self) -> Result<Option<String>, String> {
        self.vault
            .read(&self.profile, "model-api-key")
            .map(|value| value.map(|value| value.to_string()))
    }
    fn set(&self, value: &str) -> Result<(), String> {
        self.vault.write(&self.profile, "model-api-key", value)
    }
    fn delete(&self) -> Result<(), String> {
        self.vault.delete(&self.profile, "model-api-key")
    }
}

struct BrokerState {
    token: String,
    authority: String,
    active: AtomicBool,
    gate: Mutex<()>,
    secrets: Arc<dyn ModelSecrets>,
}

pub(crate) struct CredentialBroker {
    pub(crate) url: String,
    pub(crate) token: String,
    state: Arc<BrokerState>,
    stop: CancellationToken,
    task: JoinHandle<()>,
}

impl CredentialBroker {
    pub(crate) async fn start(vault: Vault, profile: String) -> Result<Self, String> {
        Self::start_with_store(Arc::new(ProfileSecrets { vault, profile })).await
    }

    async fn start_with_store(secrets: Arc<dyn ModelSecrets>) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "无法启动本机凭据通道。")?;
        let authority = listener
            .local_addr()
            .map_err(|_| "无法获取本机凭据通道地址。")?
            .to_string();
        let token = super::random_token();
        let state = Arc::new(BrokerState {
            token: token.clone(),
            authority: authority.clone(),
            active: AtomicBool::new(true),
            gate: Mutex::new(()),
            secrets,
        });
        let router = Router::new()
            .route(
                "/secrets/model-api-key",
                get(read).put(write).delete(remove),
            )
            .layer(DefaultBodyLimit::max(8192))
            .with_state(state.clone());
        let stop = CancellationToken::new();
        let server_stop = stop.clone();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(server_stop.cancelled_owned())
                .await;
        });
        Ok(Self {
            url: format!("http://{authority}"),
            token,
            state,
            stop,
            task,
        })
    }

    pub(crate) fn revoke(&self) {
        self.state.active.store(false, Ordering::SeqCst);
        self.stop.cancel();
        self.task.abort();
    }
}

impl Drop for CredentialBroker {
    fn drop(&mut self) {
        self.revoke();
    }
}

fn authorized(state: &BrokerState, headers: &HeaderMap) -> bool {
    state.active.load(Ordering::SeqCst)
        && headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            == Some(state.authority.as_str())
        && !headers.contains_key(header::ORIGIN)
        && headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .is_some_and(|token| bool::from(token.as_bytes().ct_eq(state.token.as_bytes())))
}

enum Operation {
    Read,
    Write(String),
    Delete,
}

async fn execute(
    state: Arc<BrokerState>,
    headers: HeaderMap,
    operation: Operation,
) -> Result<Json<Value>, StatusCode> {
    if !authorized(&state, &headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    tokio::task::spawn_blocking(move || {
        let _guard = state
            .gate
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if !authorized(&state, &headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        match operation {
            Operation::Read => state
                .secrets
                .get()
                .map(|value| Json(json!({ "value": value }))),
            Operation::Write(value) => state
                .secrets
                .set(&value)
                .map(|()| Json(json!({ "ok": true }))),
            Operation::Delete => state.secrets.delete().map(|()| Json(json!({ "ok": true }))),
        }
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
    })
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
}

async fn read(
    State(state): State<Arc<BrokerState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    execute(state, headers, Operation::Read).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SecretInput {
    value: String,
}

async fn write(
    State(state): State<Arc<BrokerState>>,
    headers: HeaderMap,
    Json(input): Json<SecretInput>,
) -> Result<Json<Value>, StatusCode> {
    if input.value.trim().is_empty()
        || input.value.len() > 4096
        || input.value.contains(['\n', '\r', '\0'])
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    execute(state, headers, Operation::Write(input.value)).await
}

async fn remove(
    State(state): State<Arc<BrokerState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    execute(state, headers, Operation::Delete).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct MemorySecrets(Mutex<Option<String>>);
    impl ModelSecrets for MemorySecrets {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, value: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(value.into());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    #[tokio::test]
    async fn private_broker_enforces_capability_profile_and_revocation() {
        let one = CredentialBroker::start_with_store(Arc::new(MemorySecrets::default()))
            .await
            .unwrap();
        let two = CredentialBroker::start_with_store(Arc::new(MemorySecrets::default()))
            .await
            .unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let path = format!("{}/secrets/model-api-key", one.url);
        assert_eq!(
            client.get(&path).send().await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .get(&path)
                .bearer_auth(&two.token)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .get(&path)
                .bearer_auth(&one.token)
                .header("Origin", "https://evil.example")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert!(client
            .put(&path)
            .bearer_auth(&one.token)
            .json(&json!({"value":"test-only-key"}))
            .send()
            .await
            .unwrap()
            .status()
            .is_success());
        assert_eq!(
            client
                .get(&path)
                .bearer_auth(&one.token)
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()["value"],
            "test-only-key"
        );
        let other = client
            .get(format!("{}/secrets/model-api-key", two.url))
            .bearer_auth(&two.token)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert!(other["value"].is_null());
        one.revoke();
        assert!(!one.state.active.load(Ordering::SeqCst));
        assert!(client
            .get(&path)
            .bearer_auth(&one.token)
            .send()
            .await
            .map_or(true, |response| !response.status().is_success()));
    }
}
