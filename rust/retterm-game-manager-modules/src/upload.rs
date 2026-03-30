use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

#[derive(Clone, Debug)]
pub struct UploadSession<T> {
    pub owner: T,
    pub path: String,
    pub temp_path: String,
    pub bytes_received: u64,
}

#[derive(Clone)]
pub struct UploadSessionStore<T> {
    inner: Arc<Mutex<HashMap<String, UploadSession<T>>>>,
}

impl<T: Clone> UploadSessionStore<T> {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn insert(&self, upload_id: String, session: UploadSession<T>) {
        self.inner.lock().await.insert(upload_id, session);
    }

    pub async fn get(&self, upload_id: &str) -> Option<UploadSession<T>> {
        self.inner.lock().await.get(upload_id).cloned()
    }

    pub async fn update_bytes(&self, upload_id: &str, bytes: u64) -> Option<UploadSession<T>> {
        let mut guard = self.inner.lock().await;
        let session = guard.get_mut(upload_id)?;
        session.bytes_received = session.bytes_received.saturating_add(bytes);
        Some(session.clone())
    }

    pub async fn remove(&self, upload_id: &str) -> Option<UploadSession<T>> {
        self.inner.lock().await.remove(upload_id)
    }
}
