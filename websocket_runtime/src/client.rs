use std::time::Duration;

use retterm_game_websocket_core::PeerCoreConfig;
use tokio::net::UnixStream;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, client_async, connect_async,
    tungstenite::{Error, http::Request},
};
use tracing::warn;
use uuid::Uuid;

use crate::runtime::{ReconnectPolicy, RuntimeConfig, RuntimeSession, run_socket_runtime};

/// Connection endpoint: URL or Unix domain socket. Handles request building and header injection.
#[derive(Debug, Clone)]
pub enum Connector {
    Url(String),
    Uds { path: String, ws_path: String },
}

impl Connector {
    /// Build HTTP request with standard headers (Authorization, x-server-uuid, Host).
    fn request(&self, server_token: &str, server_uuid: Uuid) -> Request<()> {
        let (uri, host) = match self {
            Connector::Url(url) => (url.clone(), host_for_url(url)),
            Connector::Uds { ws_path, .. } => (format!("ws://localhost{ws_path}"), "localhost"),
        };
        Request::builder()
            .uri(uri)
            .header("Authorization", format!("Bearer {server_token}"))
            .header("x-server-uuid", server_uuid.to_string())
            .header("Host", host)
            .body(())
            .expect("valid websocket request")
    }

    pub async fn connect(
        &self,
        server_token: &str,
        server_uuid: Uuid,
    ) -> Result<
        EitherSocket<
            WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
            WebSocketStream<UnixStream>,
        >,
        Error,
    > {
        let request = self.request(server_token, server_uuid);
        match self {
            Connector::Url(_) => connect_async(request)
                .await
                .map(|(socket, _)| EitherSocket::Url(socket)),
            Connector::Uds { path, .. } => {
                let stream = UnixStream::connect(path).await.map_err(Error::Io)?;
                client_async(request, stream)
                    .await
                    .map(|(socket, _)| EitherSocket::Uds(socket))
            }
        }
    }
}

/// Socket from either URL or UDS (for type-erased use in connect_once_with_retry).
pub enum EitherSocket<U, S> {
    Url(U),
    Uds(S),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunLoopControl {
    Continue,
    Stop,
}

#[derive(Debug, Clone)]
pub struct ClientConnectConfig {
    pub server_uuid: Uuid,
    pub server_token: String,
    pub connector: Connector,
    pub reconnect: ReconnectPolicy,
    pub peer: PeerCoreConfig,
    pub runtime: RuntimeConfig,
}

/// Legacy constructor: URL or UDS with base/max reconnect ms.
impl ClientConnectConfig {
    pub fn with_reconnect_ms(
        server_uuid: Uuid,
        server_token: String,
        connector: Connector,
        reconnect_base_ms: u64,
        reconnect_max_ms: u64,
        peer: PeerCoreConfig,
        runtime: RuntimeConfig,
    ) -> Self {
        Self {
            server_uuid,
            server_token,
            connector,
            reconnect: ReconnectPolicy {
                base_delay: Duration::from_millis(reconnect_base_ms),
                max_delay: Duration::from_millis(reconnect_max_ms),
                first_connection_wait: None,
                max_backoff_exponent: 5,
            },
            peer,
            runtime,
        }
    }
}

pub async fn connect_url(
    url: &str,
    server_token: &str,
    server_uuid: Uuid,
) -> Result<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>, Error> {
    let conn = Connector::Url(url.to_string());
    match conn.connect(server_token, server_uuid).await? {
        EitherSocket::Url(s) => Ok(s),
        EitherSocket::Uds(_) => unreachable!(),
    }
}

pub async fn connect_uds(
    uds_path: &str,
    ws_path: &str,
    server_token: &str,
    server_uuid: Uuid,
) -> Result<WebSocketStream<UnixStream>, Error> {
    let conn = Connector::Uds {
        path: uds_path.to_string(),
        ws_path: ws_path.to_string(),
    };
    match conn.connect(server_token, server_uuid).await? {
        EitherSocket::Url(_) => unreachable!(),
        EitherSocket::Uds(s) => Ok(s),
    }
}

pub async fn connect_once_with_retry(config: ClientConnectConfig) -> Result<RuntimeSession, Error> {
    let mut attempts = 0u32;
    loop {
        match config
            .connector
            .connect(&config.server_token, config.server_uuid)
            .await
        {
            Ok(EitherSocket::Url(socket)) => {
                return Ok(
                    run_socket_runtime(socket, config.peer.clone(), config.runtime.clone()).await,
                );
            }
            Ok(EitherSocket::Uds(socket)) => {
                return Ok(
                    run_socket_runtime(socket, config.peer.clone(), config.runtime.clone()).await,
                );
            }
            Err(error) => {
                attempts = attempts.saturating_add(1);
                let delay = config.reconnect.delay(attempts);
                warn!(%error, delay_ms = delay.as_millis(), "websocket connect failed");
                tokio::time::sleep(delay).await;
            }
        }
    }
}

pub async fn run_client_forever(config: ClientConnectConfig) -> Result<(), Error> {
    run_client_forever_with(config, |session| async move {
        wait_until_disconnected(session).await;
        RunLoopControl::Continue
    })
    .await
}

pub async fn run_client_forever_with<F, Fut>(
    config: ClientConnectConfig,
    mut on_session: F,
) -> Result<(), Error>
where
    F: FnMut(RuntimeSession) -> Fut,
    Fut: std::future::Future<Output = RunLoopControl>,
{
    // first_connection_wait is a process-start behavior:
    // apply exactly once before the first run-loop connection attempt.
    if let Some(wait) = config.reconnect.first_connection_wait {
        tokio::time::sleep(wait).await;
    }

    let mut connect_config = config.clone();
    connect_config.reconnect.first_connection_wait = None;

    loop {
        let session = connect_once_with_retry(connect_config.clone()).await?;
        match on_session(session).await {
            RunLoopControl::Continue => continue,
            RunLoopControl::Stop => return Ok(()),
        }
    }
}

async fn wait_until_disconnected(mut session: RuntimeSession) {
    while let Some(event) = session.inbound_rx.recv().await {
        if matches!(event, crate::runtime::RuntimeEvent::Disconnected) {
            break;
        }
    }
}

fn host_for_url(url: &str) -> &str {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .filter(|value| !value.is_empty())
        .unwrap_or("localhost")
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use futures_util::SinkExt;
    use tokio::net::TcpListener;
    use tokio_tungstenite::{accept_async, tungstenite::Message};
    use uuid::Uuid;

    use super::*;
    use crate::runtime::RuntimeConfig;

    // Integration-like reconnect test (requires real websocket handshake timing).
    #[tokio::test]
    #[ignore = "flaky in CI-like environments; run locally for reconnect verification"]
    async fn run_client_forever_reconnects_after_disconnect() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let accepts = Arc::new(AtomicUsize::new(0));
        let accepts_srv = Arc::clone(&accepts);

        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.expect("accept");
                let mut ws = match accept_async(stream).await {
                    Ok(ws) => ws,
                    Err(_) => continue,
                };
                accepts_srv.fetch_add(1, Ordering::SeqCst);
                let _ = ws.send(Message::Close(None)).await;
                if accepts_srv.load(Ordering::SeqCst) >= 2 {
                    break;
                }
            }
        });

        let seen = Arc::new(AtomicUsize::new(0));
        let seen_cb = Arc::clone(&seen);
        let config = ClientConnectConfig {
            server_uuid: Uuid::new_v4(),
            server_token: "token".to_string(),
            connector: Connector::Url(format!("ws://{addr}/ws/server")),
            reconnect: ReconnectPolicy {
                base_delay: Duration::from_millis(10),
                max_delay: Duration::from_millis(30),
                first_connection_wait: None,
                max_backoff_exponent: 2,
            },
            peer: PeerCoreConfig::default(),
            runtime: RuntimeConfig::default(),
        };

        let result = tokio::time::timeout(Duration::from_secs(3), async move {
            run_client_forever_with(config, move |_session| {
                let seen_cb = Arc::clone(&seen_cb);
                async move {
                    let n = seen_cb.fetch_add(1, Ordering::SeqCst) + 1;
                    if n >= 2 {
                        RunLoopControl::Stop
                    } else {
                        RunLoopControl::Continue
                    }
                }
            })
            .await
        })
        .await;
        assert!(result.is_ok(), "run loop timed out");
        assert!(
            accepts.load(Ordering::SeqCst) >= 2,
            "should reconnect at least once"
        );
    }
}
