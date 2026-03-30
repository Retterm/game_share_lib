use std::collections::VecDeque;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio::sync::{Mutex, broadcast};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleLine {
    pub ts: i64,
    pub stream: String,
    pub text: String,
}

#[derive(Clone)]
pub struct ConsoleStore {
    tx: broadcast::Sender<String>,
    backlog: Arc<Mutex<VecDeque<ConsoleLine>>>,
    install_backlog: Arc<Mutex<VecDeque<ConsoleLine>>>,
    max_lines: usize,
}

impl ConsoleStore {
    pub fn new(max_lines: usize) -> Self {
        let (tx, _) = broadcast::channel::<String>(1024);
        Self {
            tx,
            backlog: Arc::new(Mutex::new(VecDeque::with_capacity(max_lines))),
            install_backlog: Arc::new(Mutex::new(VecDeque::with_capacity(max_lines.max(500)))),
            max_lines,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }

    pub async fn push_line(&self, stream: &str, text: impl Into<String>, installing: bool) {
        let line = ConsoleLine {
            ts: chrono::Utc::now().timestamp_millis(),
            stream: stream.to_string(),
            text: text.into(),
        };
        {
            let mut backlog = self.backlog.lock().await;
            while backlog.len() >= self.max_lines {
                backlog.pop_front();
            }
            backlog.push_back(line.clone());
        }

        if installing {
            let mut backlog = self.install_backlog.lock().await;
            while backlog.len() >= self.max_lines.saturating_mul(10).max(500) {
                backlog.pop_front();
            }
            backlog.push_back(line.clone());
        }

        if let Ok(serialized) = serde_json::to_string(&line) {
            let _ = self.tx.send(serialized);
        }
    }

    pub async fn recent(&self, limit: usize) -> Vec<ConsoleLine> {
        let backlog = self.backlog.lock().await;
        let len = backlog.len();
        let start = len.saturating_sub(limit);
        backlog.iter().skip(start).cloned().collect()
    }

    pub async fn recent_since(&self, since_ts: Option<i64>) -> Vec<ConsoleLine> {
        let backlog = self.backlog.lock().await;
        backlog
            .iter()
            .filter(|line| since_ts.map(|ts| line.ts > ts).unwrap_or(true))
            .cloned()
            .collect()
    }

    pub async fn install_recent(&self) -> Vec<ConsoleLine> {
        self.install_backlog.lock().await.iter().cloned().collect()
    }

    pub async fn backlog_len(&self) -> usize {
        self.backlog.lock().await.len()
    }

    pub fn spawn_reader<R, F>(&self, stream: &'static str, reader: R, is_installing: F)
    where
        R: AsyncRead + Unpin + Send + 'static,
        F: Fn() -> bool + Send + Sync + 'static,
    {
        let store = self.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                store.push_line(stream, line, is_installing()).await;
            }
        });
    }

    pub async fn execute(
        &self,
        stdin: &Arc<Mutex<Option<ChildStdin>>>,
        command: String,
        installing: bool,
    ) -> Result<(), String> {
        let mut guard = stdin.lock().await;
        let Some(stdin) = guard.as_mut() else {
            return Err("server stdin unavailable".to_string());
        };
        stdin
            .write_all(format!("{command}\n").as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        drop(guard);
        self.push_line("stdin", command, installing).await;
        Ok(())
    }
}
