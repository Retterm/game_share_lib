use std::time::Duration;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("outbound queue full")]
    QueueFull,
    #[error("transport channel closed")]
    ChannelClosed,
    #[error("frame too short")]
    FrameTooShort,
    #[error("frame header incomplete: declared={declared}, actual={actual}")]
    FrameHeaderIncomplete { declared: usize, actual: usize },
    #[error("binary header too large: {0}")]
    HeaderTooLarge(usize),
    #[error("invalid text frame")]
    InvalidTextFrame,
    #[error("response channel closed for request {request_id}")]
    ResponseChannelClosed { request_id: String },
    #[error("request {request_id} timed out after {timeout:?}")]
    RequestTimeout {
        request_id: String,
        timeout: Duration,
    },
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}
