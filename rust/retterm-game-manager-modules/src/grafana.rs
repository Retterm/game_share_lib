use anyhow::anyhow;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde_json::{Value, json};

#[derive(Clone, Debug)]
pub struct GrafanaConfig {
    pub url: String,
    pub api_token: Option<String>,
    pub folder_uid: Option<String>,
    pub org_id: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct PublicDashboardInfo {
    pub public_uid: String,
    pub access_token: String,
    pub is_enabled: Option<bool>,
    pub time_selection_enabled: Option<bool>,
    pub annotations_enabled: Option<bool>,
    pub share: Option<String>,
}

pub fn auth_headers(cfg: &GrafanaConfig) -> Option<HeaderMap> {
    let token = cfg
        .api_token
        .as_ref()
        .map(|value| value.as_str())
        .filter(|value| !value.is_empty())?;
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))
            .unwrap_or_else(|_| HeaderValue::from_static("")),
    );
    Some(headers)
}

pub async fn get_dashboard_by_uid(
    http: &reqwest::Client,
    cfg: &GrafanaConfig,
    dash_uid: &str,
) -> anyhow::Result<Option<Value>> {
    let base = cfg.url.trim_end_matches('/');
    let url = format!("{base}/api/dashboards/uid/{dash_uid}");
    let headers = match auth_headers(cfg) {
        Some(headers) => headers,
        None => return Ok(None),
    };
    let response = http.get(url).headers(headers).send().await?;
    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!("grafana get dashboard failed: {status} {text}");
    }
    let body: Value = response.json().await.unwrap_or(Value::Null);
    Ok(Some(body.get("dashboard").cloned().unwrap_or(body)))
}

pub fn normalize_dashboard_for_compare(value: &mut Value) {
    if let Value::Object(map) = value {
        for key in [
            "id",
            "version",
            "iteration",
            "gnetId",
            "updated",
            "updateInterval",
            "liveNow",
            "schemaVersion",
        ] {
            map.remove(key);
        }
        for nested in map.values_mut() {
            normalize_dashboard_for_compare(nested);
        }
    } else if let Value::Array(items) = value {
        for nested in items {
            normalize_dashboard_for_compare(nested);
        }
    }
}

pub async fn ensure_dashboard(
    http: &reqwest::Client,
    cfg: &GrafanaConfig,
    dash_uid: &str,
    dashboard: Value,
    overwrite_message: &str,
) -> anyhow::Result<String> {
    let _ = cfg
        .api_token
        .as_ref()
        .ok_or_else(|| anyhow!("grafana api_token missing"))?;
    let base = cfg.url.trim_end_matches('/');
    let api = format!("{base}/api/dashboards/db");

    if let Some(mut existing) = get_dashboard_by_uid(http, cfg, dash_uid).await? {
        let mut desired = dashboard.clone();
        normalize_dashboard_for_compare(&mut existing);
        normalize_dashboard_for_compare(&mut desired);
        if existing == desired {
            return Ok(dash_uid.to_string());
        }
    }

    let body = json!({
        "dashboard": dashboard,
        "folderUid": cfg.folder_uid.clone().unwrap_or_default(),
        "overwrite": true,
        "message": overwrite_message,
    });
    let mut headers = auth_headers(cfg).ok_or_else(|| anyhow!("grafana api_token missing"))?;
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let response = http.post(api).headers(headers).json(&body).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!("grafana ensure dashboard failed: {status} {text}");
    }
    Ok(dash_uid.to_string())
}

pub fn public_dashboard_url(cfg: &GrafanaConfig, public_uid: &str) -> String {
    let base = cfg.url.trim_end_matches('/');
    format!("{base}/public-dashboards/{public_uid}")
}

pub async fn get_public_dashboard(
    http: &reqwest::Client,
    cfg: &GrafanaConfig,
    dash_uid: &str,
) -> anyhow::Result<Option<PublicDashboardInfo>> {
    let token = match cfg
        .api_token
        .as_ref()
        .map(|value| value.as_str())
        .filter(|value| !value.is_empty())
    {
        Some(token) => token,
        None => return Ok(None),
    };
    let base = cfg.url.trim_end_matches('/');
    let url = format!("{base}/api/dashboards/uid/{dash_uid}/public-dashboards");
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))
            .unwrap_or_else(|_| HeaderValue::from_static("")),
    );
    let response = http.get(url).headers(headers).send().await?;
    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!("grafana get public dashboard failed: {status} {text}");
    }
    let body: Value = response.json().await.unwrap_or_else(|_| Value::Null);
    parse_public_dashboard_info(&body)
}

pub async fn create_public_dashboard(
    http: &reqwest::Client,
    cfg: &GrafanaConfig,
    dash_uid: &str,
) -> anyhow::Result<PublicDashboardInfo> {
    let token = cfg
        .api_token
        .as_ref()
        .ok_or_else(|| anyhow!("grafana api_token missing"))?;
    let base = cfg.url.trim_end_matches('/');
    let url = format!("{base}/api/dashboards/uid/{dash_uid}/public-dashboards");
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))
            .unwrap_or_else(|_| HeaderValue::from_static("")),
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let body = json!({
        "isEnabled": true,
        "timeSelectionEnabled": true,
        "annotationsEnabled": true,
        "share": "public",
    });
    let response = http.post(url).headers(headers).json(&body).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!("grafana create public dashboard failed: {status} {text}");
    }
    let body: Value = response.json().await.unwrap_or_else(|_| Value::Null);
    parse_public_dashboard_info(&body)?
        .ok_or_else(|| anyhow!("grafana public dashboard missing response payload"))
}

pub async fn update_public_dashboard_settings(
    http: &reqwest::Client,
    cfg: &GrafanaConfig,
    dash_uid: &str,
    public_uid: &str,
) -> anyhow::Result<()> {
    let base = cfg.url.trim_end_matches('/');
    let body = json!({
        "share": "public",
        "timeSelectionEnabled": true,
        "annotationsEnabled": true,
        "isEnabled": true,
    });
    let mut headers = match auth_headers(cfg) {
        Some(headers) => headers,
        None => return Ok(()),
    };
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let url = format!("{base}/api/dashboards/uid/{dash_uid}/public-dashboards/{public_uid}");
    let response = http.patch(url).headers(headers).json(&body).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!("grafana update public dashboard failed: {status} {text}");
    }
    Ok(())
}

pub fn public_settings_need_update(info: &PublicDashboardInfo) -> bool {
    info.is_enabled != Some(true)
        || info.time_selection_enabled != Some(true)
        || info.annotations_enabled != Some(true)
        || info.share.as_deref() != Some("public")
}

fn parse_public_dashboard_info(value: &Value) -> anyhow::Result<Option<PublicDashboardInfo>> {
    let obj = match value {
        Value::Array(items) => items.first().and_then(|item| item.as_object()),
        Value::Object(map) => {
            if let Some(Value::Array(items)) = map.get("publicDashboards") {
                items.first().and_then(|item| item.as_object())
            } else if let Some(Value::Array(items)) = map.get("public_dashboards") {
                items.first().and_then(|item| item.as_object())
            } else {
                Some(map)
            }
        }
        _ => None,
    };
    let Some(obj) = obj else {
        return Ok(None);
    };
    let public_uid = find_str(
        obj,
        &[
            "publicDashboardUid",
            "public_dashboard_uid",
            "publicUid",
            "public_uid",
            "uid",
        ],
    )
    .ok_or_else(|| anyhow!("grafana public dashboard missing uid"))?;
    let access_token = find_str(obj, &["accessToken", "access_token"])
        .ok_or_else(|| anyhow!("grafana public dashboard missing access token"))?;
    Ok(Some(PublicDashboardInfo {
        public_uid,
        access_token,
        is_enabled: obj.get("isEnabled").and_then(|value| value.as_bool()),
        time_selection_enabled: obj
            .get("timeSelectionEnabled")
            .and_then(|value| value.as_bool()),
        annotations_enabled: obj
            .get("annotationsEnabled")
            .and_then(|value| value.as_bool()),
        share: obj
            .get("share")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
    }))
}

fn find_str(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(Value::String(value)) = map.get(*key) {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}
