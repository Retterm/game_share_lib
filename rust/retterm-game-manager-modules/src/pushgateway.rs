use base64::Engine as _;
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};

#[derive(Clone, Debug)]
pub struct PushgatewayConfig {
    pub url: String,
    pub basic_auth: Option<String>,
}

pub async fn push_metrics(
    http: &reqwest::Client,
    cfg: &PushgatewayConfig,
    job: &str,
    server_uuid: &str,
    body: &str,
) -> anyhow::Result<()> {
    let base = cfg.url.trim_end_matches('/');
    let url = format!("{base}/metrics/job/{job}/server_uuid/{server_uuid}");
    let mut req = http.put(url).body(body.to_string());
    if let Some(basic) = cfg.basic_auth.as_ref().filter(|value| !value.is_empty()) {
        let mut headers = HeaderMap::new();
        let encoded = base64::engine::general_purpose::STANDARD.encode(basic.as_bytes());
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Basic {encoded}"))
                .unwrap_or_else(|_| HeaderValue::from_static("")),
        );
        req = req.headers(headers);
    }
    let response = req.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!("pushgateway push failed: {status} {text}");
    }
    Ok(())
}
