use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
    time::{Duration, Instant},
};

use tokio::sync::{Mutex, oneshot};
use uuid::Uuid;

use crate::{
    contracts::{JsonValue, RpcEvent, RpcRequest, RpcResponse},
    error::TransportError,
    text_frame::{
        TextFrame, encode_event_text_frame, encode_request_text_frame, encode_response_text_frame,
        parse_text_frame,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected = 0,
    Connected = 1,
}

#[derive(Debug, Clone)]
pub struct PeerCoreConfig {
    pub request_timeout: Duration,
    pub heartbeat_interval: Duration,
    pub offline_grace: Duration,
}

impl Default for PeerCoreConfig {
    fn default() -> Self {
        Self {
            request_timeout: Duration::from_secs(10),
            heartbeat_interval: Duration::from_secs(25),
            offline_grace: Duration::from_secs(75),
        }
    }
}

#[derive(Debug)]
pub struct PreparedRequest {
    pub request: RpcRequest<JsonValue>,
    pub response_rx: oneshot::Receiver<RpcResponse<JsonValue>>,
}

#[derive(Debug, Clone)]
pub struct ResponseReceipt {
    pub response: RpcResponse<JsonValue>,
    pub matched_pending: bool,
}

#[derive(Debug, Clone)]
pub enum InboundTextFrame {
    Request(RpcRequest<JsonValue>),
    Response(ResponseReceipt),
    Event(RpcEvent<JsonValue>),
}

#[derive(Debug, Clone)]
pub struct PeerCore {
    inner: Arc<PeerCoreInner>,
}

#[derive(Debug)]
struct PeerCoreInner {
    config: PeerCoreConfig,
    state: AtomicU8,
    last_seen: Mutex<Instant>,
    pending: Mutex<HashMap<String, oneshot::Sender<RpcResponse<JsonValue>>>>,
}

impl PeerCore {
    pub fn new(config: PeerCoreConfig) -> Self {
        Self {
            inner: Arc::new(PeerCoreInner {
                config,
                state: AtomicU8::new(ConnectionState::Disconnected as u8),
                last_seen: Mutex::new(Instant::now()),
                pending: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn config(&self) -> &PeerCoreConfig {
        &self.inner.config
    }

    pub fn connection_state(&self) -> ConnectionState {
        match self.inner.state.load(Ordering::Relaxed) {
            1 => ConnectionState::Connected,
            _ => ConnectionState::Disconnected,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connection_state() == ConnectionState::Connected
    }

    pub async fn mark_connected(&self) {
        self.inner
            .state
            .store(ConnectionState::Connected as u8, Ordering::Relaxed);
        self.mark_seen().await;
    }

    pub async fn mark_disconnected(&self) {
        self.inner
            .state
            .store(ConnectionState::Disconnected as u8, Ordering::Relaxed);
        self.fail_all_pending().await;
    }

    pub async fn mark_seen(&self) {
        *self.inner.last_seen.lock().await = Instant::now();
    }

    pub async fn last_seen_elapsed(&self) -> Duration {
        self.inner.last_seen.lock().await.elapsed()
    }

    pub async fn is_stale(&self) -> bool {
        self.last_seen_elapsed().await > self.inner.config.offline_grace
    }

    pub async fn pending_count(&self) -> usize {
        self.inner.pending.lock().await.len()
    }

    pub async fn prepare_request(
        &self,
        kind: impl Into<String>,
        payload: JsonValue,
    ) -> PreparedRequest {
        let request_id = Uuid::new_v4().to_string();
        let request = RpcRequest {
            uuid: request_id.clone(),
            kind: kind.into(),
            payload,
            ..Default::default()
        };
        let (response_tx, response_rx) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .await
            .insert(request_id, response_tx);
        PreparedRequest {
            request,
            response_rx,
        }
    }

    pub async fn await_response(
        &self,
        request_id: &str,
        response_rx: oneshot::Receiver<RpcResponse<JsonValue>>,
    ) -> Result<RpcResponse<JsonValue>, TransportError> {
        match tokio::time::timeout(self.inner.config.request_timeout, response_rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err(TransportError::ResponseChannelClosed {
                request_id: request_id.to_string(),
            }),
            Err(_) => {
                self.inner.pending.lock().await.remove(request_id);
                Err(TransportError::RequestTimeout {
                    request_id: request_id.to_string(),
                    timeout: self.inner.config.request_timeout,
                })
            }
        }
    }

    pub async fn fail_all_pending(&self) {
        let pending = {
            let mut guard = self.inner.pending.lock().await;
            std::mem::take(&mut *guard)
        };
        drop(pending);
    }

    pub async fn cancel_pending_request(&self, request_id: &str) {
        self.inner.pending.lock().await.remove(request_id);
    }

    /// Parse order: response -> request -> event using the typed envelope wire format.
    pub async fn handle_text_frame(&self, text: &str) -> Result<InboundTextFrame, TransportError> {
        self.mark_seen().await;
        match parse_text_frame(text)? {
            TextFrame::Response(response) => {
                let matched_pending = self
                    .inner
                    .pending
                    .lock()
                    .await
                    .remove(&response.uuid)
                    .map(|tx| tx.send(response.clone()).is_ok())
                    .unwrap_or(false);
                Ok(InboundTextFrame::Response(ResponseReceipt {
                    response,
                    matched_pending,
                }))
            }
            TextFrame::Request(request) => Ok(InboundTextFrame::Request(request)),
            TextFrame::Event(event) => Ok(InboundTextFrame::Event(event)),
        }
    }

    pub fn encode_request_text(
        &self,
        request: &RpcRequest<JsonValue>,
    ) -> Result<String, TransportError> {
        encode_request_text_frame(request)
    }

    pub fn encode_response_text(
        &self,
        response: &RpcResponse<JsonValue>,
    ) -> Result<String, TransportError> {
        encode_response_text_frame(response)
    }

    pub fn encode_event_text(&self, event: &RpcEvent<JsonValue>) -> Result<String, TransportError> {
        encode_event_text_frame(event)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;

    use crate::{
        binproto::{BinHeader, decode_binary_frame, encode_binary_frame},
        contracts::{RpcRequest, RpcResponse, RpcStatus},
    };

    use super::{InboundTextFrame, PeerCore, PeerCoreConfig};

    #[test]
    fn rpc_status_accepts_error_only() {
        let response: RpcResponse = serde_json::from_value(json!({
            "uuid": "1",
            "status": "error",
            "payload": {}
        }))
        .expect("deserialize response");
        assert_eq!(response.status, RpcStatus::Error);
    }

    #[test]
    fn binproto_roundtrip() {
        let header = BinHeader {
            kind: "fs.upload.chunk".to_string(),
            upload_id: "upload-1".to_string(),
            offset: 128,
            part_no: Some(2),
            ..Default::default()
        };
        let payload = b"hello";
        let encoded = encode_binary_frame(&header, payload).expect("encode frame");
        let (decoded_header, decoded_payload) =
            decode_binary_frame(&encoded).expect("decode frame");
        assert_eq!(decoded_header, header);
        assert_eq!(decoded_payload, payload);
    }

    #[tokio::test]
    async fn matched_response_completes_pending_request() {
        let peer = PeerCore::new(PeerCoreConfig {
            request_timeout: Duration::from_millis(50),
            ..Default::default()
        });
        let prepared = peer.prepare_request("manager.ping", json!({})).await;
        let request_id = prepared.request.uuid.clone();

        let response = RpcResponse {
            uuid: request_id.clone(),
            status: RpcStatus::Ok,
            payload: json!({ "ok": true }),
            error: None,
        };
        let text = peer
            .encode_response_text(&response)
            .expect("serialize response");

        let outcome = peer.handle_text_frame(&text).await.expect("handle text");
        match outcome {
            InboundTextFrame::Response(receipt) => {
                assert!(receipt.matched_pending);
                assert_eq!(receipt.response.uuid, request_id);
            }
            other => panic!("unexpected outcome: {other:?}"),
        }

        let resolved = peer
            .await_response(&request_id, prepared.response_rx)
            .await
            .expect("await response");
        assert_eq!(resolved.status, RpcStatus::Ok);
    }

    #[tokio::test]
    async fn request_timeout_clears_pending_entry() {
        let peer = PeerCore::new(PeerCoreConfig {
            request_timeout: Duration::from_millis(10),
            ..Default::default()
        });
        let prepared = peer
            .prepare_request("console.exec", json!({"command": "say hi"}))
            .await;
        let request_id = prepared.request.uuid.clone();
        let error = peer
            .await_response(&request_id, prepared.response_rx)
            .await
            .expect_err("timeout expected");
        assert!(matches!(
            error,
            crate::error::TransportError::RequestTimeout { .. }
        ));
        assert_eq!(peer.pending_count().await, 0);
    }

    #[tokio::test]
    async fn text_frame_parses_request_before_event() {
        let peer = PeerCore::new(PeerCoreConfig::default());
        let request = RpcRequest {
            uuid: "req-1".to_string(),
            kind: "game.echo".to_string(),
            payload: json!({ "echo": true }),
            ..Default::default()
        };
        let text = peer.encode_request_text(&request).expect("serialize request");
        let outcome = peer.handle_text_frame(&text).await.expect("handle text");
        match outcome {
            InboundTextFrame::Request(parsed) => assert_eq!(parsed.kind, "game.echo"),
            other => panic!("unexpected outcome: {other:?}"),
        }
    }

    #[tokio::test]
    async fn typed_event_is_parsed_as_event() {
        let peer = PeerCore::new(PeerCoreConfig::default());
        let text = serde_json::json!({
            "type": "event",
            "kind": "metrics.update",
            "payload": {"cpu": 0.8}
        })
        .to_string();
        let outcome = peer.handle_text_frame(&text).await.expect("handle text");
        match outcome {
            InboundTextFrame::Event(event) => assert_eq!(event.kind, "metrics.update"),
            other => panic!("unexpected outcome: {other:?}"),
        }
    }
}
