use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type JsonValue = Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RpcRequest<T = JsonValue> {
    pub uuid: String,
    pub kind: String,
    #[serde(default)]
    pub payload: T,
}

impl<T: Default> Default for RpcRequest<T> {
    fn default() -> Self {
        Self {
            uuid: String::new(),
            kind: String::new(),
            payload: T::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RpcError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RpcStatus {
    Ok,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RpcResponse<T = JsonValue> {
    #[serde(default)]
    pub uuid: String,
    #[serde(default = "default_ok")]
    pub status: RpcStatus,
    #[serde(default)]
    pub payload: T,
    #[serde(default)]
    pub error: Option<RpcError>,
}

fn default_ok() -> RpcStatus {
    RpcStatus::Ok
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RpcEvent<T = JsonValue> {
    pub kind: String,
    #[serde(default)]
    pub payload: T,
}

impl<T: Default> Default for RpcEvent<T> {
    fn default() -> Self {
        Self {
            kind: String::new(),
            payload: T::default(),
        }
    }
}

// -------- Typed envelope (wire format with "type" wrapper) --------

pub const ENVELOPE_TYPE_RPC_REQUEST: &str = "rpc_request";
pub const ENVELOPE_TYPE_RPC_RESPONSE: &str = "rpc_response";
pub const ENVELOPE_TYPE_EVENT: &str = "event";

/// Parse JSON text as typed envelope: `{ "type": "rpc_request"|"rpc_response"|"event", "id"?, "kind"?, "payload"?, ... }`.
/// Returns the root object and type tag so caller can convert to RpcRequest/RpcResponse/RpcEvent.
pub fn parse_typed_envelope(text: &str) -> Option<(String, Value)> {
    let root: Value = serde_json::from_str(text).ok()?;
    let obj = root.as_object()?;
    let type_tag = obj.get("type").and_then(Value::as_str)?.to_string();
    match type_tag.as_str() {
        ENVELOPE_TYPE_RPC_REQUEST | ENVELOPE_TYPE_RPC_RESPONSE | ENVELOPE_TYPE_EVENT => {}
        _ => return None,
    }
    Some((type_tag, root))
}

/// Build typed envelope JSON string for a request (id = uuid, kind, payload).
pub fn encode_typed_request(request: &RpcRequest<JsonValue>) -> Result<String, serde_json::Error> {
    serde_json::to_string(&serde_json::json!({
        "type": ENVELOPE_TYPE_RPC_REQUEST,
        "id": request.uuid,
        "kind": request.kind,
        "payload": request.payload,
    }))
}

/// Build typed envelope JSON string for a response.
pub fn encode_typed_response(
    response: &RpcResponse<JsonValue>,
) -> Result<String, serde_json::Error> {
    serde_json::to_string(&serde_json::json!({
        "type": ENVELOPE_TYPE_RPC_RESPONSE,
        "id": response.uuid,
        "status": if response.status == RpcStatus::Ok { "ok" } else { "error" },
        "payload": response.payload,
        "error": response.error.as_ref().map(|e| serde_json::json!({
            "code": e.code,
            "message": e.message
        })),
    }))
}

/// Build typed envelope JSON string for an event.
pub fn encode_typed_event(event: &RpcEvent<JsonValue>) -> Result<String, serde_json::Error> {
    serde_json::to_string(&serde_json::json!({
        "type": ENVELOPE_TYPE_EVENT,
        "kind": event.kind,
        "payload": event.payload,
    }))
}

/// Convert typed-envelope Value (with type "rpc_request") into RpcRequest.
pub fn typed_envelope_to_request(v: &Value) -> Option<RpcRequest<JsonValue>> {
    let id = v.get("id").and_then(Value::as_str)?.to_string();
    if id.is_empty() {
        return None;
    }
    let kind = v.get("kind").and_then(Value::as_str)?.to_string();
    if kind.is_empty() {
        return None;
    }
    let payload = v.get("payload").cloned().unwrap_or(Value::Null);
    Some(RpcRequest {
        uuid: id,
        kind,
        payload,
    })
}

/// Convert typed-envelope Value (with type "rpc_response") into RpcResponse.
pub fn typed_envelope_to_response(v: &Value) -> Option<RpcResponse<JsonValue>> {
    let id = v
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let status = match v.get("status").and_then(Value::as_str) {
        Some("ok") => RpcStatus::Ok,
        Some("error") => RpcStatus::Error,
        _ => return None,
    };
    let payload = v.get("payload").cloned().unwrap_or(Value::Null);
    let error = v.get("error").and_then(|e| {
        if e.is_null() {
            return None;
        }
        let code = e
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let message = e
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        Some(RpcError { code, message })
    });
    Some(RpcResponse {
        uuid: id,
        status,
        payload,
        error,
    })
}

/// Convert typed-envelope Value (with type "event") into RpcEvent.
pub fn typed_envelope_to_event(v: &Value) -> Option<RpcEvent<JsonValue>> {
    let kind = v.get("kind").and_then(Value::as_str)?.to_string();
    let payload = v.get("payload").cloned().unwrap_or(Value::Null);
    Some(RpcEvent { kind, payload })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn typed_request_roundtrip() {
        let req = RpcRequest {
            uuid: "req-1".to_string(),
            kind: "fs.upload.start".to_string(),
            payload: json!({"file":"a.zip"}),
        };
        let encoded = encode_typed_request(&req).expect("encode request");
        let (typ, val) = parse_typed_envelope(&encoded).expect("parse envelope");
        assert_eq!(typ, ENVELOPE_TYPE_RPC_REQUEST);
        let decoded = typed_envelope_to_request(&val).expect("decode request");
        assert_eq!(decoded.uuid, req.uuid);
        assert_eq!(decoded.kind, req.kind);
        assert_eq!(decoded.payload, req.payload);
    }

    #[test]
    fn typed_response_roundtrip() {
        let resp = RpcResponse {
            uuid: "req-2".to_string(),
            status: RpcStatus::Error,
            payload: json!({"ok":false}),
            error: Some(RpcError {
                code: "busy".to_string(),
                message: "queue full".to_string(),
            }),
        };
        let encoded = encode_typed_response(&resp).expect("encode response");
        let (typ, val) = parse_typed_envelope(&encoded).expect("parse envelope");
        assert_eq!(typ, ENVELOPE_TYPE_RPC_RESPONSE);
        let decoded = typed_envelope_to_response(&val).expect("decode response");
        assert_eq!(decoded.uuid, resp.uuid);
        assert_eq!(decoded.status, resp.status);
        assert_eq!(decoded.payload, resp.payload);
        assert_eq!(
            decoded.error.as_ref().map(|e| &e.code),
            Some(&"busy".to_string())
        );
    }

    #[test]
    fn typed_event_roundtrip() {
        let ev = RpcEvent {
            kind: "metrics.update".to_string(),
            payload: json!({"cpu":0.7, "kind":"biz-field"}),
        };
        let encoded = encode_typed_event(&ev).expect("encode event");
        let (typ, val) = parse_typed_envelope(&encoded).expect("parse envelope");
        assert_eq!(typ, ENVELOPE_TYPE_EVENT);
        let decoded = typed_envelope_to_event(&val).expect("decode event");
        assert_eq!(decoded.kind, ev.kind);
        assert_eq!(decoded.payload, ev.payload);
    }
}
