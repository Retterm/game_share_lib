use crate::{
    contracts::{
        ENVELOPE_TYPE_EVENT, ENVELOPE_TYPE_RPC_REQUEST, ENVELOPE_TYPE_RPC_RESPONSE, JsonValue,
        RpcEvent, RpcRequest, RpcResponse, encode_typed_event, encode_typed_request,
        encode_typed_response, parse_typed_envelope, typed_envelope_to_event,
        typed_envelope_to_request, typed_envelope_to_response,
    },
    error::TransportError,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TextFrame {
    Request(RpcRequest<JsonValue>),
    Response(RpcResponse<JsonValue>),
    Event(RpcEvent<JsonValue>),
}

pub fn encode_request_text_frame(
    request: &RpcRequest<JsonValue>,
) -> Result<String, TransportError> {
    Ok(encode_typed_request(request)?)
}

pub fn encode_response_text_frame(
    response: &RpcResponse<JsonValue>,
) -> Result<String, TransportError> {
    Ok(encode_typed_response(response)?)
}

pub fn encode_event_text_frame(event: &RpcEvent<JsonValue>) -> Result<String, TransportError> {
    Ok(encode_typed_event(event)?)
}

pub fn parse_text_frame(text: &str) -> Result<TextFrame, TransportError> {
    let (type_tag, envelope) =
        parse_typed_envelope(text).ok_or(TransportError::InvalidTextFrame)?;
    match type_tag.as_str() {
        ENVELOPE_TYPE_RPC_REQUEST => typed_envelope_to_request(&envelope)
            .map(TextFrame::Request)
            .ok_or(TransportError::InvalidTextFrame),
        ENVELOPE_TYPE_RPC_RESPONSE => typed_envelope_to_response(&envelope)
            .map(TextFrame::Response)
            .ok_or(TransportError::InvalidTextFrame),
        ENVELOPE_TYPE_EVENT => typed_envelope_to_event(&envelope)
            .map(TextFrame::Event)
            .ok_or(TransportError::InvalidTextFrame),
        _ => Err(TransportError::InvalidTextFrame),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{RpcStatus, TransportError};

    use super::{TextFrame, parse_text_frame};

    #[test]
    fn rejects_plain_request() {
        let error = parse_text_frame(r#"{"uuid":"req-1","kind":"lifecycle.start","payload":{}}"#)
            .expect_err("typed mode should reject plain request");
        assert!(matches!(error, TransportError::InvalidTextFrame));
    }

    #[test]
    fn parse_typed_response_roundtrip() {
        let raw = json!({
            "type": "rpc_response",
            "id": "req-2",
            "status": "error",
            "payload": {},
            "error": { "code": "busy", "message": "queue full" }
        })
        .to_string();
        let frame = parse_text_frame(&raw).expect("parse response");
        match frame {
            TextFrame::Response(resp) => {
                assert_eq!(resp.uuid, "req-2");
                assert_eq!(resp.status, RpcStatus::Error);
                assert_eq!(resp.error.as_ref().map(|e| e.code.as_str()), Some("busy"));
            }
            other => panic!("unexpected frame: {other:?}"),
        }
    }
}
