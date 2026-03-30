use std::{sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use retterm_game_websocket_core::{
    BinHeader, JsonValue, PeerCore, PeerCoreConfig, RpcEvent, RpcRequest, RpcResponse,
    decode_binary_frame, encode_binary_frame,
};
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::{WebSocketStream, tungstenite::Message};
use tracing::warn;

/// What to do when the outbound or inbound queue is full.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum QueueFullPolicy {
    /// Return an error (caller handles busy).
    #[default]
    Busy,
    /// Drop the message and continue.
    Drop,
    /// Wait for space (blocking send).
    Wait,
}

/// Worker pool configuration for applications that dispatch requests to a pool.
/// The runtime itself does not run workers; this config is for app use (e.g. worker_n, queue size).
#[derive(Debug, Clone)]
pub struct WorkerPolicy {
    pub worker_count: usize,
    pub queue_capacity: usize,
    pub queue_full_policy: QueueFullPolicy,
}

impl Default for WorkerPolicy {
    fn default() -> Self {
        Self {
            worker_count: 4,
            queue_capacity: 64,
            queue_full_policy: QueueFullPolicy::Busy,
        }
    }
}

/// Per-channel backpressure when sending to the socket or to the app.
#[derive(Debug, Clone)]
pub struct BackpressurePolicy {
    pub outbound_queue_full: QueueFullPolicy,
    pub inbound_queue_full: QueueFullPolicy,
}

impl Default for BackpressurePolicy {
    fn default() -> Self {
        Self {
            outbound_queue_full: QueueFullPolicy::Busy,
            inbound_queue_full: QueueFullPolicy::Drop,
        }
    }
}

/// Reconnect strategy: base delay, exponential backoff cap, optional first-connection wait.
#[derive(Debug, Clone)]
pub struct ReconnectPolicy {
    pub base_delay: Duration,
    pub max_delay: Duration,
    /// If set, wait this long before the first connection attempt (e.g. let server listen).
    pub first_connection_wait: Option<Duration>,
    /// Max exponent for backoff (delay = base_delay * 2^min(attempt, max_backoff_exponent)).
    pub max_backoff_exponent: u32,
}

impl Default for ReconnectPolicy {
    fn default() -> Self {
        Self {
            base_delay: Duration::from_millis(1000),
            max_delay: Duration::from_secs(60),
            first_connection_wait: None,
            max_backoff_exponent: 5,
        }
    }
}

impl ReconnectPolicy {
    pub fn delay(&self, attempt: u32) -> Duration {
        let base_ms = self.base_delay.as_millis() as u64;
        let exp = attempt.min(self.max_backoff_exponent);
        let delay_ms = base_ms
            .saturating_mul(1 << exp)
            .min(self.max_delay.as_millis() as u64);
        Duration::from_millis(delay_ms)
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub heartbeat_interval: Duration,
    pub outbound_queue: usize,
    pub inbound_queue: usize,
    pub worker_policy: WorkerPolicy,
    pub backpressure: BackpressurePolicy,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            heartbeat_interval: Duration::from_secs(30),
            outbound_queue: 64,
            inbound_queue: 256,
            worker_policy: WorkerPolicy::default(),
            backpressure: BackpressurePolicy::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub enum OutboundMessage {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    Close,
}

#[derive(Debug, Clone)]
pub enum RuntimeEvent {
    Connected,
    Disconnected,
    Request(RpcRequest<JsonValue>),
    Event(RpcEvent<JsonValue>),
    Response(RpcResponse<JsonValue>),
    Binary { header: BinHeader, payload: Vec<u8> },
}

#[derive(Debug, Clone)]
pub struct RuntimeHandle {
    peer: PeerCore,
    outbound_tx: mpsc::Sender<OutboundMessage>,
    backpressure: BackpressurePolicy,
}

impl RuntimeHandle {
    pub fn new(
        peer: PeerCore,
        outbound_tx: mpsc::Sender<OutboundMessage>,
        backpressure: BackpressurePolicy,
    ) -> Self {
        Self {
            peer,
            outbound_tx,
            backpressure,
        }
    }

    pub fn peer(&self) -> &PeerCore {
        &self.peer
    }

    async fn send_outbound_reliable(
        &self,
        msg: OutboundMessage,
    ) -> Result<(), retterm_game_websocket_core::TransportError> {
        match self.backpressure.outbound_queue_full {
            QueueFullPolicy::Busy => self.outbound_tx.try_send(msg).map_err(|e| match e {
                tokio::sync::mpsc::error::TrySendError::Full(_) => {
                    retterm_game_websocket_core::TransportError::QueueFull
                }
                tokio::sync::mpsc::error::TrySendError::Closed(_) => {
                    retterm_game_websocket_core::TransportError::ChannelClosed
                }
            }),
            QueueFullPolicy::Drop => {
                // request/response/binary must not be silently dropped.
                match self.outbound_tx.try_send(msg) {
                    Ok(()) => Ok(()),
                    Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                        Err(retterm_game_websocket_core::TransportError::QueueFull)
                    }
                    Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                        Err(retterm_game_websocket_core::TransportError::ChannelClosed)
                    }
                }
            }
            QueueFullPolicy::Wait => self
                .outbound_tx
                .send(msg)
                .await
                .map_err(|_| retterm_game_websocket_core::TransportError::ChannelClosed),
        }
    }

    async fn send_outbound_best_effort(
        &self,
        msg: OutboundMessage,
    ) -> Result<(), retterm_game_websocket_core::TransportError> {
        match self.backpressure.outbound_queue_full {
            QueueFullPolicy::Busy => self.outbound_tx.try_send(msg).map_err(|e| match e {
                tokio::sync::mpsc::error::TrySendError::Full(_) => {
                    retterm_game_websocket_core::TransportError::QueueFull
                }
                tokio::sync::mpsc::error::TrySendError::Closed(_) => {
                    retterm_game_websocket_core::TransportError::ChannelClosed
                }
            }),
            QueueFullPolicy::Drop => match self.outbound_tx.try_send(msg) {
                Ok(()) => Ok(()),
                Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => Ok(()),
                Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                    Err(retterm_game_websocket_core::TransportError::ChannelClosed)
                }
            },
            QueueFullPolicy::Wait => self
                .outbound_tx
                .send(msg)
                .await
                .map_err(|_| retterm_game_websocket_core::TransportError::ChannelClosed),
        }
    }

    pub async fn send_request(
        &self,
        kind: impl Into<String>,
        payload: JsonValue,
    ) -> Result<RpcResponse<JsonValue>, retterm_game_websocket_core::TransportError> {
        let prepared = self.peer.prepare_request(kind, payload).await;
        let request_id = prepared.request.uuid.clone();
        let text = self.peer.encode_request_text(&prepared.request)?;
        if let Err(error) = self
            .send_outbound_reliable(OutboundMessage::Text(text))
            .await
        {
            self.peer.cancel_pending_request(&request_id).await;
            return Err(error);
        }
        self.peer
            .await_response(&request_id, prepared.response_rx)
            .await
    }

    pub async fn send_event(
        &self,
        kind: impl Into<String>,
        payload: JsonValue,
    ) -> Result<(), retterm_game_websocket_core::TransportError> {
        let event = RpcEvent {
            kind: kind.into(),
            payload,
            ..Default::default()
        };
        let text = self.peer.encode_event_text(&event)?;
        self.send_outbound_best_effort(OutboundMessage::Text(text))
            .await
    }

    pub async fn send_response(
        &self,
        response: RpcResponse<JsonValue>,
    ) -> Result<(), retterm_game_websocket_core::TransportError> {
        let text = self.peer.encode_response_text(&response)?;
        self.send_outbound_reliable(OutboundMessage::Text(text))
            .await
    }

    pub async fn send_ok_response(
        &self,
        request_id: impl Into<String>,
        payload: JsonValue,
    ) -> Result<(), retterm_game_websocket_core::TransportError> {
        self.send_response(RpcResponse {
            uuid: request_id.into(),
            status: retterm_game_websocket_core::RpcStatus::Ok,
            payload,
            error: None,
        })
        .await
    }

    pub async fn send_error_response(
        &self,
        request_id: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
        _details: Option<JsonValue>,
    ) -> Result<(), retterm_game_websocket_core::TransportError> {
        self.send_response(RpcResponse {
            uuid: request_id.into(),
            status: retterm_game_websocket_core::RpcStatus::Error,
            payload: serde_json::Value::Null,
            error: Some(retterm_game_websocket_core::RpcError {
                code: code.into(),
                message: message.into(),
            }),
        })
        .await
    }

    pub async fn send_binary(
        &self,
        header: &BinHeader,
        payload: &[u8],
    ) -> Result<(), retterm_game_websocket_core::TransportError> {
        let frame = encode_binary_frame(header, payload)?;
        self.send_outbound_reliable(OutboundMessage::Binary(frame))
            .await
    }

    pub async fn close(&self) {
        let _ = self.outbound_tx.send(OutboundMessage::Close).await;
    }
}

#[derive(Debug)]
pub struct RuntimeSession {
    pub handle: RuntimeHandle,
    pub inbound_rx: mpsc::Receiver<RuntimeEvent>,
}

pub async fn run_socket_runtime<S>(
    socket: WebSocketStream<S>,
    peer_config: PeerCoreConfig,
    runtime_config: RuntimeConfig,
) -> RuntimeSession
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let peer = PeerCore::new(peer_config);
    let (outbound_tx, outbound_rx) = mpsc::channel(runtime_config.outbound_queue.max(1));
    let (inbound_tx, inbound_rx) = mpsc::channel(runtime_config.inbound_queue.max(1));
    let handle = RuntimeHandle::new(
        peer.clone(),
        outbound_tx.clone(),
        runtime_config.backpressure.clone(),
    );

    tokio::spawn(run_socket_task(
        socket,
        peer,
        runtime_config.clone(),
        outbound_tx,
        Arc::new(Mutex::new(outbound_rx)),
        inbound_tx,
    ));

    RuntimeSession { handle, inbound_rx }
}

async fn run_socket_task<S>(
    socket: WebSocketStream<S>,
    peer: PeerCore,
    runtime_config: RuntimeConfig,
    outbound_tx: mpsc::Sender<OutboundMessage>,
    outbound_rx: Arc<Mutex<mpsc::Receiver<OutboundMessage>>>,
    inbound_tx: mpsc::Sender<RuntimeEvent>,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut ws_tx, mut ws_rx) = socket.split();
    peer.mark_connected().await;
    let _ = inbound_tx.send(RuntimeEvent::Connected).await;

    let inbound_policy = runtime_config.backpressure.inbound_queue_full;

    let writer = {
        let outbound_rx = outbound_rx.clone();
        tokio::spawn(async move {
            let mut heartbeat = tokio::time::interval(runtime_config.heartbeat_interval);
            heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    maybe_outgoing = async {
                        let mut guard = outbound_rx.lock().await;
                        guard.recv().await
                    } => {
                        match maybe_outgoing {
                            Some(OutboundMessage::Text(text)) => {
                                if ws_tx.send(Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                            Some(OutboundMessage::Binary(binary)) => {
                                if ws_tx.send(Message::Binary(binary.into())).await.is_err() {
                                    break;
                                }
                            }
                            Some(OutboundMessage::Ping(payload)) => {
                                if ws_tx.send(Message::Ping(payload.into())).await.is_err() {
                                    break;
                                }
                            }
                            Some(OutboundMessage::Pong(payload)) => {
                                if ws_tx.send(Message::Pong(payload.into())).await.is_err() {
                                    break;
                                }
                            }
                            Some(OutboundMessage::Close) | None => {
                                let _ = ws_tx.send(Message::Close(None)).await;
                                break;
                            }
                        }
                    }
                    _ = heartbeat.tick() => {
                        if ws_tx.send(Message::Ping(Vec::new().into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        })
    };

    while let Some(message) = ws_rx.next().await {
        match message {
            Ok(Message::Text(text)) => match peer.handle_text_frame(text.as_ref()).await {
                Ok(retterm_game_websocket_core::InboundTextFrame::Request(request)) => {
                    if !send_reliable_inbound(
                        &inbound_tx,
                        inbound_policy,
                        RuntimeEvent::Request(request),
                    )
                    .await
                    {
                        break;
                    }
                }
                Ok(retterm_game_websocket_core::InboundTextFrame::Event(event)) => {
                    if !send_best_effort_inbound(
                        &inbound_tx,
                        inbound_policy,
                        RuntimeEvent::Event(event),
                    )
                    .await
                    {
                        break;
                    }
                }
                Ok(retterm_game_websocket_core::InboundTextFrame::Response(receipt)) => {
                    if !send_reliable_inbound(
                        &inbound_tx,
                        inbound_policy,
                        RuntimeEvent::Response(receipt.response),
                    )
                    .await
                    {
                        break;
                    }
                }
                Err(error) => {
                    warn!(%error, "failed to decode inbound text frame");
                }
            },
            Ok(Message::Binary(binary)) => match decode_binary_frame(&binary) {
                Ok((header, payload)) => {
                    if !send_reliable_inbound(
                        &inbound_tx,
                        inbound_policy,
                        RuntimeEvent::Binary {
                            header,
                            payload: payload.to_vec(),
                        },
                    )
                    .await
                    {
                        break;
                    }
                }
                Err(error) => {
                    warn!(%error, "failed to decode inbound binary frame");
                }
            },
            Ok(Message::Ping(payload)) => {
                peer.mark_seen().await;
                let _ = outbound_tx
                    .send(OutboundMessage::Pong(payload.to_vec()))
                    .await;
            }
            Ok(Message::Pong(_)) => {
                peer.mark_seen().await;
            }
            Ok(Message::Close(_)) => break,
            Ok(Message::Frame(_)) => {}
            Err(error) => {
                warn!(%error, "websocket runtime receive error");
                break;
            }
        }
    }

    writer.abort();
    peer.mark_disconnected().await;
    let _ = inbound_tx.send(RuntimeEvent::Disconnected).await;
}

async fn send_reliable_inbound(
    tx: &mpsc::Sender<RuntimeEvent>,
    policy: QueueFullPolicy,
    event: RuntimeEvent,
) -> bool {
    match policy {
        QueueFullPolicy::Busy | QueueFullPolicy::Drop => tx.try_send(event).is_ok(),
        QueueFullPolicy::Wait => tx.send(event).await.is_ok(),
    }
}

async fn send_best_effort_inbound(
    tx: &mpsc::Sender<RuntimeEvent>,
    policy: QueueFullPolicy,
    event: RuntimeEvent,
) -> bool {
    match policy {
        QueueFullPolicy::Busy => tx.try_send(event).is_ok(),
        QueueFullPolicy::Drop => {
            let _ = tx.try_send(event);
            true
        }
        QueueFullPolicy::Wait => tx.send(event).await.is_ok(),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use futures_util::{SinkExt, StreamExt};
    use serde_json::json;
    use tokio::io::duplex;
    use tokio_tungstenite::{
        WebSocketStream,
        tungstenite::{Message, protocol::Role},
    };

    use super::*;

    async fn websocket_pair() -> (
        WebSocketStream<tokio::io::DuplexStream>,
        WebSocketStream<tokio::io::DuplexStream>,
    ) {
        let (a, b) = duplex(8192);
        let left = WebSocketStream::from_raw_socket(a, Role::Client, None).await;
        let right = WebSocketStream::from_raw_socket(b, Role::Server, None).await;
        (left, right)
    }

    #[tokio::test]
    async fn can_reply_via_send_response_api() {
        let (client_ws, mut peer_ws) = websocket_pair().await;
        let session = run_socket_runtime(
            client_ws,
            PeerCoreConfig::default(),
            RuntimeConfig {
                heartbeat_interval: Duration::from_secs(300),
                ..Default::default()
            },
        )
        .await;

        let req_text = serde_json::json!({
            "type": "rpc_request",
            "id": "req-1",
            "kind": "core.ping",
            "payload": {"x":1}
        })
        .to_string();
        peer_ws
            .send(Message::Text(req_text.into()))
            .await
            .expect("send request");

        let mut inbound = session.inbound_rx;
        let req_id = loop {
            match inbound.recv().await {
                Some(RuntimeEvent::Request(req)) => break req.uuid,
                Some(_) => continue,
                None => panic!("runtime channel closed"),
            }
        };

        session
            .handle
            .send_ok_response(req_id, json!({"pong":true}))
            .await
            .expect("send ok response");

        let msg = peer_ws.next().await.expect("message").expect("ok frame");
        let text = match msg {
            Message::Text(t) => t.to_string(),
            other => panic!("unexpected frame: {other:?}"),
        };
        let v: serde_json::Value = serde_json::from_str(&text).expect("json response");
        assert_eq!(v.get("type").and_then(|x| x.as_str()), Some("rpc_response"));
        assert_eq!(v.get("status").and_then(|x| x.as_str()), Some("ok"));
    }

    #[tokio::test]
    async fn send_request_receives_matched_response() {
        let (client_ws, mut peer_ws) = websocket_pair().await;
        let session = run_socket_runtime(
            client_ws,
            PeerCoreConfig::default(),
            RuntimeConfig {
                heartbeat_interval: Duration::from_secs(300),
                ..Default::default()
            },
        )
        .await;

        let waiter = tokio::spawn({
            let handle = session.handle.clone();
            async move {
                handle
                    .send_request("core.echo", json!({"k":"v"}))
                    .await
                    .expect("response")
            }
        });

        // Read outbound request from runtime.
        let out_text = loop {
            let msg = peer_ws.next().await.expect("outbound").expect("ok frame");
            if let Message::Text(t) = msg {
                break t.to_string();
            }
        };
        let out_json: serde_json::Value =
            serde_json::from_str(&out_text).expect("outbound request json");
        let req_id = out_json
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        // Reply with matched response id.
        let resp_text = serde_json::json!({
            "type": "rpc_response",
            "id": req_id,
            "status": "ok",
            "payload": {"echo": true},
            "error": null
        })
        .to_string();
        peer_ws
            .send(Message::Text(resp_text.into()))
            .await
            .expect("send response");

        let response = waiter.await.expect("join");
        assert_eq!(response.status, retterm_game_websocket_core::RpcStatus::Ok);
    }

    #[tokio::test]
    async fn outbound_queue_full_policy_busy_returns_queue_full() {
        let peer = PeerCore::new(PeerCoreConfig::default());
        let (tx, mut rx) = mpsc::channel(1);
        tx.try_send(OutboundMessage::Text("occupied".to_string()))
            .expect("fill queue");
        let handle = RuntimeHandle::new(
            peer,
            tx,
            BackpressurePolicy {
                outbound_queue_full: QueueFullPolicy::Busy,
                inbound_queue_full: QueueFullPolicy::Busy,
            },
        );
        let err = handle
            .send_event("metrics.update", json!({"cpu": 1}))
            .await
            .expect_err("queue full expected");
        assert!(matches!(
            err,
            retterm_game_websocket_core::TransportError::QueueFull
        ));
        let _ = rx.recv().await;
    }

    #[tokio::test]
    async fn outbound_queue_full_policy_drop_drops_and_returns_ok() {
        let peer = PeerCore::new(PeerCoreConfig::default());
        let (tx, mut rx) = mpsc::channel(1);
        tx.try_send(OutboundMessage::Text("occupied".to_string()))
            .expect("fill queue");
        let handle = RuntimeHandle::new(
            peer,
            tx,
            BackpressurePolicy {
                outbound_queue_full: QueueFullPolicy::Drop,
                inbound_queue_full: QueueFullPolicy::Busy,
            },
        );
        handle
            .send_event("metrics.update", json!({"cpu": 1}))
            .await
            .expect("drop policy returns ok");

        // Queue remains the original single item; dropped message is not enqueued.
        let first = rx.recv().await.expect("first item");
        match first {
            OutboundMessage::Text(text) => assert_eq!(text, "occupied"),
            other => panic!("unexpected outbound: {other:?}"),
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(20), rx.recv())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn outbound_queue_full_policy_wait_waits_then_sends() {
        let peer = PeerCore::new(PeerCoreConfig::default());
        let (tx, mut rx) = mpsc::channel(1);
        tx.try_send(OutboundMessage::Text("occupied".to_string()))
            .expect("fill queue");
        let handle = RuntimeHandle::new(
            peer,
            tx,
            BackpressurePolicy {
                outbound_queue_full: QueueFullPolicy::Wait,
                inbound_queue_full: QueueFullPolicy::Busy,
            },
        );

        let waiter = tokio::spawn({
            let handle = handle.clone();
            async move {
                handle
                    .send_event("metrics.update", json!({"cpu": 0.9}))
                    .await
            }
        });

        tokio::time::sleep(Duration::from_millis(10)).await;
        let first = rx.recv().await.expect("drain occupied");
        match first {
            OutboundMessage::Text(text) => assert_eq!(text, "occupied"),
            other => panic!("unexpected outbound: {other:?}"),
        }
        waiter
            .await
            .expect("waiter join")
            .expect("wait policy should eventually send");
        let second = rx.recv().await.expect("wait policy enqueued message");
        match second {
            OutboundMessage::Text(_) => {}
            other => panic!("unexpected outbound: {other:?}"),
        }
    }

    #[tokio::test]
    async fn outbound_drop_policy_send_request_returns_queue_full_not_timeout() {
        let peer = PeerCore::new(PeerCoreConfig {
            request_timeout: Duration::from_millis(20),
            ..Default::default()
        });
        let (tx, _rx) = mpsc::channel(1);
        tx.try_send(OutboundMessage::Text("occupied".to_string()))
            .expect("fill queue");
        let handle = RuntimeHandle::new(
            peer,
            tx,
            BackpressurePolicy {
                outbound_queue_full: QueueFullPolicy::Drop,
                inbound_queue_full: QueueFullPolicy::Busy,
            },
        );

        let result = tokio::time::timeout(
            Duration::from_millis(100),
            handle.send_request("core.echo", json!({"k":"v"})),
        )
        .await
        .expect("send_request should fail fast");
        let err = result.expect_err("queue full expected");
        assert!(matches!(
            err,
            retterm_game_websocket_core::TransportError::QueueFull
        ));
    }

    #[tokio::test]
    async fn outbound_drop_policy_send_response_returns_queue_full() {
        let peer = PeerCore::new(PeerCoreConfig::default());
        let (tx, _rx) = mpsc::channel(1);
        tx.try_send(OutboundMessage::Text("occupied".to_string()))
            .expect("fill queue");
        let handle = RuntimeHandle::new(
            peer,
            tx,
            BackpressurePolicy {
                outbound_queue_full: QueueFullPolicy::Drop,
                inbound_queue_full: QueueFullPolicy::Busy,
            },
        );

        let err = handle
            .send_response(RpcResponse {
                uuid: "req-1".to_string(),
                status: retterm_game_websocket_core::RpcStatus::Ok,
                payload: json!({"ok": true}),
                error: None,
            })
            .await
            .expect_err("queue full expected");
        assert!(matches!(
            err,
            retterm_game_websocket_core::TransportError::QueueFull
        ));
    }

    #[tokio::test]
    async fn inbound_drop_policy_keeps_binary_frames_reliable() {
        let (client_ws, mut peer_ws) = websocket_pair().await;
        let session = run_socket_runtime(
            client_ws,
            PeerCoreConfig::default(),
            RuntimeConfig {
                heartbeat_interval: Duration::from_secs(300),
                inbound_queue: 1,
                backpressure: BackpressurePolicy {
                    outbound_queue_full: QueueFullPolicy::Busy,
                    inbound_queue_full: QueueFullPolicy::Drop,
                },
                ..Default::default()
            },
        )
        .await;

        let mut inbound = session.inbound_rx;
        match inbound.recv().await {
            Some(RuntimeEvent::Connected) => {}
            other => panic!("expected connected event, got {other:?}"),
        }

        let header = BinHeader {
            kind: "fs.upload.chunk".to_string(),
            upload_id: "upload-1".to_string(),
            offset: 0,
            ..Default::default()
        };
        let frame = encode_binary_frame(&header, b"hello").expect("binary frame");
        peer_ws
            .send(Message::Binary(frame.into()))
            .await
            .expect("send binary");

        loop {
            match inbound.recv().await {
                Some(RuntimeEvent::Binary {
                    header: recv_header,
                    payload,
                }) => {
                    assert_eq!(recv_header.kind, "fs.upload.chunk");
                    assert_eq!(payload, b"hello");
                    break;
                }
                Some(RuntimeEvent::Connected) => continue,
                Some(other) => panic!("unexpected runtime event: {other:?}"),
                None => panic!("runtime channel closed"),
            }
        }
    }
}
