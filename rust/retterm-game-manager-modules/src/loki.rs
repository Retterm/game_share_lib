use axum::http::StatusCode;
use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct LokiConfig {
    pub url: String,
    pub tenant: Option<String>,
    pub basic_auth: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionItem {
    pub name: String,
    #[serde(rename = "type")]
    pub typ: String,
}

pub async fn label_values(
    http: &reqwest::Client,
    cfg: &LokiConfig,
    label: &str,
    server_uuid: &Uuid,
    start_ns: &str,
    end_ns: &str,
) -> Result<Option<Vec<String>>, StatusCode> {
    let mut url = reqwest::Url::parse(&format!(
        "{}/loki/api/v1/label/{label}/values",
        cfg.url.trim_end_matches('/')
    ))
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    {
        let mut pairs = url.query_pairs_mut();
        let selector = format!("{{server_uuid=\"{server_uuid}\"}}");
        pairs.append_pair("query", &selector);
        pairs.append_pair("start", start_ns);
        pairs.append_pair("end", end_ns);
    }

    let mut req = http.get(url);
    if let Some(tenant) = cfg.tenant.as_ref() {
        req = req.header("X-Scope-OrgID", tenant);
    }
    if let Some(basic) = cfg.basic_auth.as_ref() {
        let encoded = general_purpose::STANDARD.encode(basic.as_bytes());
        req = req.header("Authorization", format!("Basic {encoded}"));
    }
    let response = req.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if status == StatusCode::NOT_FOUND || status == StatusCode::BAD_REQUEST {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(StatusCode::BAD_GATEWAY);
    }

    let mut values = Vec::new();
    if let Ok(body) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(items) = body.get("data").and_then(|value| value.as_array()) {
            for item in items {
                if let Some(value) = item.as_str() {
                    if !value.is_empty() {
                        values.push(value.to_string());
                    }
                }
            }
        }
    }
    Ok(Some(values))
}

pub fn build_query_with_uuid(server_uuid: &Uuid, raw_query: &str) -> String {
    let trimmed = raw_query.trim();
    if trimmed.is_empty() {
        return format!("{{server_uuid=\"{server_uuid}\"}}");
    }
    if let Some(end) = trimmed.find('}') {
        let selector = &trimmed[..=end];
        let suffix = &trimmed[end + 1..];
        if selector.contains("server_uuid=") {
            return trimmed.to_string();
        }
        let inner = selector.trim_start_matches('{').trim_end_matches('}');
        let merged = if inner.trim().is_empty() {
            format!("server_uuid=\"{server_uuid}\"")
        } else {
            format!("{inner},server_uuid=\"{server_uuid}\"")
        };
        return format!("{{{merged}}}{suffix}");
    }
    format!("{{server_uuid=\"{server_uuid}\"}} {trimmed}")
}

pub fn parse_session_ts(name: &str) -> i64 {
    if let Some(first_dash) = name.find('-') {
        let rest = &name[first_dash + 1..];
        if let Some(second_dash) = rest.find('-') {
            if let Ok(epoch_ms) = rest[..second_dash].parse::<i64>() {
                return epoch_ms;
            }
        }
    }
    if name.len() >= 14 {
        let tail = &name[name.len() - 14..];
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(tail, "%Y%m%d%H%M%S") {
            return dt.and_utc().timestamp_millis();
        }
    }
    0
}

pub fn classify_session(name: &str) -> SessionItem {
    let typ = if name.starts_with("start_time_install_") || name.ends_with("-install") {
        "install"
    } else {
        "run"
    };
    SessionItem {
        name: name.to_string(),
        typ: typ.to_string(),
    }
}
