use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use once_cell::sync::Lazy;
use serde::Serialize;
use tokio::sync::Mutex;

static CLK_TCK: Lazy<u64> = Lazy::new(|| unsafe { libc::sysconf(libc::_SC_CLK_TCK) as u64 });
static PAGE_SIZE: Lazy<u64> = Lazy::new(|| unsafe { libc::sysconf(libc::_SC_PAGESIZE) as u64 });
static PREV_CPU: Lazy<Arc<Mutex<HashMap<i32, (f64, Instant)>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    pub cpu_percent: f64,
    pub mem_used_bytes: u64,
    pub mem_total_bytes: u64,
    pub net_rx_bytes_total: u64,
    pub net_tx_bytes_total: u64,
    pub disk_used_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MetricsFrame {
    pub metrics: MetricsSnapshot,
    pub ts: i64,
}

#[derive(Clone)]
pub struct MetricsCollector {
    install_dir: String,
    metric_prefix: String,
}

impl MetricsCollector {
    pub fn new(install_dir: impl Into<String>, metric_prefix: impl Into<String>) -> Self {
        Self {
            install_dir: install_dir.into(),
            metric_prefix: metric_prefix.into(),
        }
    }

    pub async fn latest(&self, pid: Option<i32>) -> MetricsFrame {
        let ts = chrono::Utc::now().timestamp();
        let install_dir = self.install_dir.clone();
        let disk_used_bytes =
            tokio::task::spawn_blocking(move || dir_size(Path::new(&install_dir)))
                .await
                .unwrap_or(0);
        let mem_total_bytes = total_memory_bytes();

        let metrics = if let Some(pid) = pid {
            let cpu_total = read_pid_cpu_total_seconds(pid).unwrap_or(0.0);
            let mut prev = PREV_CPU.lock().await;
            let now = Instant::now();
            let cpu_percent =
                if let Some((prev_total, prev_ts)) = prev.insert(pid, (cpu_total, now)) {
                    let dsecs = (cpu_total - prev_total).max(0.0);
                    let dt = now.duration_since(prev_ts).as_secs_f64().max(1e-6);
                    (dsecs / dt * 100.0).max(0.0)
                } else {
                    0.0
                };
            let mem_used_bytes = read_pid_rss_bytes(pid).unwrap_or(0);
            let (net_rx, net_tx) = read_pid_netdev_sum(pid).unwrap_or((0, 0));
            MetricsSnapshot {
                cpu_percent,
                mem_used_bytes,
                mem_total_bytes,
                net_rx_bytes_total: net_rx,
                net_tx_bytes_total: net_tx,
                disk_used_bytes,
            }
        } else {
            MetricsSnapshot {
                cpu_percent: 0.0,
                mem_used_bytes: 0,
                mem_total_bytes,
                net_rx_bytes_total: 0,
                net_tx_bytes_total: 0,
                disk_used_bytes,
            }
        };

        MetricsFrame { metrics, ts }
    }

    pub async fn disk_usage(&self) -> serde_json::Value {
        let install_dir = self.install_dir.clone();
        let install_dir_for_size = install_dir.clone();
        let bytes = tokio::task::spawn_blocking(move || dir_size(Path::new(&install_dir_for_size)))
            .await
            .unwrap_or(0);
        serde_json::json!({
            "diskUsedBytes": bytes,
            "path": install_dir,
            "ts": chrono::Utc::now().timestamp(),
        })
    }

    pub fn render_pushgateway_text(&self, server_uuid: &str, frame: &MetricsFrame) -> String {
        let prefix = self.metric_prefix.trim();
        let metrics = &frame.metrics;
        [
            format!("{prefix}_process_cpu_percent {}", metrics.cpu_percent),
            format!("{prefix}_mem_used_bytes {}", metrics.mem_used_bytes),
            format!("{prefix}_mem_total_bytes {}", metrics.mem_total_bytes),
            format!(
                "{prefix}_network_receive_bytes_total {}",
                metrics.net_rx_bytes_total
            ),
            format!(
                "{prefix}_network_transmit_bytes_total {}",
                metrics.net_tx_bytes_total
            ),
            format!("{prefix}_disk_used_bytes {}", metrics.disk_used_bytes),
            format!("{prefix}_collect_timestamp_seconds {}", frame.ts),
            format!("{prefix}_up 1"),
            format!("{prefix}_server_info{{server_uuid=\"{server_uuid}\"}} 1"),
        ]
        .join("\n")
    }
}

fn read_pid_cpu_total_seconds(pid: i32) -> Option<f64> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let end = stat.rfind(')')?;
    let rest = &stat[end + 2..];
    let fields: Vec<&str> = rest.split_whitespace().collect();
    let utime = fields.get(11)?.parse::<u64>().ok()?;
    let stime = fields.get(12)?.parse::<u64>().ok()?;
    Some((utime + stime) as f64 / *CLK_TCK as f64)
}

fn read_pid_rss_bytes(pid: i32) -> Option<u64> {
    let statm = std::fs::read_to_string(format!("/proc/{pid}/statm")).ok()?;
    let rss_pages = statm.split_whitespace().nth(1)?.parse::<u64>().ok()?;
    Some(rss_pages * *PAGE_SIZE)
}

fn read_pid_netdev_sum(pid: i32) -> Option<(u64, u64)> {
    let file = File::open(format!("/proc/{pid}/net/dev")).ok()?;
    let reader = BufReader::new(file);
    let mut rx = 0u64;
    let mut tx = 0u64;
    for line in reader.lines().skip(2).flatten() {
        let mut parts = line.split(':');
        let _iface = parts.next()?;
        let stats = parts.next()?.split_whitespace().collect::<Vec<_>>();
        rx = rx.saturating_add(stats.first()?.parse::<u64>().ok()?);
        tx = tx.saturating_add(stats.get(8)?.parse::<u64>().ok()?);
    }
    Some((rx, tx))
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(reader) = std::fs::read_dir(path) {
        for entry in reader.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total = total.saturating_add(dir_size(&entry.path()));
                } else if meta.is_file() {
                    total = total.saturating_add(meta.len());
                }
            }
        }
    }
    total
}

fn total_memory_bytes() -> u64 {
    if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
        for line in meminfo.lines() {
            if let Some(value) = line.strip_prefix("MemTotal:") {
                if let Some(kib) = value
                    .split_whitespace()
                    .next()
                    .and_then(|raw| raw.parse::<u64>().ok())
                {
                    return kib * 1024;
                }
            }
        }
    }
    0
}
