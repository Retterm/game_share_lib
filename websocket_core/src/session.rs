use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const SESSION_ID_HEADER: &str = "x-rpchub-session-id";
pub const SESSION_EVENT_HELLO: &str = "rpchub.session.hello";
pub const SESSION_EVENT_DRAINING: &str = "rpchub.session.draining";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionControlPayload {
    pub server_uuid: String,
    pub session_id: String,
    pub ts: i64,
}

pub fn is_session_control_event(kind: &str) -> bool {
    matches!(kind, SESSION_EVENT_HELLO | SESSION_EVENT_DRAINING)
}

pub fn session_control_payload(
    server_uuid: impl Into<String>,
    session_id: impl Into<String>,
) -> Value {
    session_control_payload_with_ts(server_uuid, session_id, now_timestamp_ms())
}

pub fn session_control_payload_with_ts(
    server_uuid: impl Into<String>,
    session_id: impl Into<String>,
    ts: i64,
) -> Value {
    json!({
        "server_uuid": server_uuid.into(),
        "session_id": session_id.into(),
        "ts": ts,
    })
}

pub fn parse_session_control_payload(payload: &Value) -> Option<SessionControlPayload> {
    let server_uuid = payload.get("server_uuid")?.as_str()?.trim();
    let session_id = payload.get("session_id")?.as_str()?.trim();
    if server_uuid.is_empty() || session_id.is_empty() {
        return None;
    }

    Some(SessionControlPayload {
        server_uuid: server_uuid.to_string(),
        session_id: session_id.to_string(),
        ts: payload.get("ts").and_then(Value::as_i64).unwrap_or(0),
    })
}

fn now_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        SESSION_EVENT_DRAINING, SESSION_EVENT_HELLO, is_session_control_event,
        parse_session_control_payload, session_control_payload_with_ts,
    };

    #[test]
    fn parses_valid_session_payload() {
        let payload = session_control_payload_with_ts("server-1", "session-1", 123);
        let parsed = parse_session_control_payload(&payload).expect("session payload");
        assert_eq!(parsed.server_uuid, "server-1");
        assert_eq!(parsed.session_id, "session-1");
        assert_eq!(parsed.ts, 123);
    }

    #[test]
    fn rejects_empty_session_payload_fields() {
        let payload = serde_json::json!({
            "server_uuid": "",
            "session_id": "  ",
            "ts": 1,
        });
        assert!(parse_session_control_payload(&payload).is_none());
    }

    #[test]
    fn recognizes_internal_session_event_kinds() {
        assert!(is_session_control_event(SESSION_EVENT_HELLO));
        assert!(is_session_control_event(SESSION_EVENT_DRAINING));
        assert!(!is_session_control_event("console.log"));
    }
}
