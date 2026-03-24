use serde::{Deserialize, Serialize};

use crate::error::TransportError;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct BinHeader {
    pub kind: String,
    pub upload_id: String,
    pub offset: u64,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub part_no: Option<u32>,
    #[serde(default)]
    pub part_size: Option<u64>,
    #[serde(default)]
    pub payload_sha256: Option<String>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

pub fn encode_binary_frame(header: &BinHeader, payload: &[u8]) -> Result<Vec<u8>, TransportError> {
    let header_json = serde_json::to_vec(header)?;
    if header_json.len() > u32::MAX as usize {
        return Err(TransportError::HeaderTooLarge(header_json.len()));
    }

    let mut frame = Vec::with_capacity(4 + header_json.len() + payload.len());
    frame.extend_from_slice(&(header_json.len() as u32).to_be_bytes());
    frame.extend_from_slice(&header_json);
    frame.extend_from_slice(payload);
    Ok(frame)
}

pub fn decode_binary_frame(input: &[u8]) -> Result<(BinHeader, &[u8]), TransportError> {
    if input.len() < 4 {
        return Err(TransportError::FrameTooShort);
    }

    let header_len = u32::from_be_bytes([input[0], input[1], input[2], input[3]]) as usize;
    if input.len() < 4 + header_len {
        return Err(TransportError::FrameHeaderIncomplete {
            declared: header_len,
            actual: input.len().saturating_sub(4),
        });
    }

    let header = serde_json::from_slice::<BinHeader>(&input[4..4 + header_len])?;
    Ok((header, &input[4 + header_len..]))
}
