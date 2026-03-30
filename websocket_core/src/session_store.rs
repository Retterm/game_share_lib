use std::{collections::HashMap, hash::Hash, sync::Arc, time::Instant};

use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub struct SessionState<S> {
    pub session_id: String,
    pub sender: S,
    pub last_seen: Arc<RwLock<Instant>>,
    pub draining: bool,
}

impl<S> SessionState<S> {
    pub fn new(session_id: impl Into<String>, sender: S) -> Self {
        Self {
            session_id: session_id.into(),
            sender,
            last_seen: Arc::new(RwLock::new(Instant::now())),
            draining: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionStore<K, S> {
    inner: Arc<RwLock<HashMap<K, SessionState<S>>>>,
}

impl<K, S> Default for SessionStore<K, S> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K, S> SessionStore<K, S> {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl<K, S> SessionStore<K, S>
where
    K: Eq + Hash + Clone,
    S: Clone,
{
    pub async fn insert(&self, key: K, session: SessionState<S>) -> Option<SessionState<S>> {
        self.inner.write().await.insert(key, session)
    }

    pub async fn get(&self, key: &K) -> Option<SessionState<S>> {
        self.inner.read().await.get(key).cloned()
    }

    pub async fn remove_if_current(&self, key: &K, session_id: &str) -> bool {
        let mut guard = self.inner.write().await;
        match guard.get(key) {
            Some(session) if session.session_id == session_id => {
                guard.remove(key);
                true
            }
            _ => false,
        }
    }

    pub async fn is_current(&self, key: &K, session_id: &str) -> bool {
        self.inner
            .read()
            .await
            .get(key)
            .map(|session| session.session_id == session_id)
            .unwrap_or(false)
    }

    pub async fn is_online(&self, key: &K) -> bool {
        self.inner
            .read()
            .await
            .get(key)
            .map(|session| !session.draining)
            .unwrap_or(false)
    }

    pub async fn update_draining(&self, key: &K, session_id: &str, draining: bool) -> bool {
        let mut guard = self.inner.write().await;
        let Some(session) = guard.get_mut(key) else {
            return false;
        };
        if session.session_id != session_id {
            return false;
        }
        session.draining = draining;
        true
    }

    pub async fn touch_current(&self, key: &K, session_id: &str) -> bool {
        let last_seen = {
            let guard = self.inner.read().await;
            guard
                .get(key)
                .filter(|session| session.session_id == session_id)
                .map(|session| Arc::clone(&session.last_seen))
        };

        let Some(last_seen) = last_seen else {
            return false;
        };

        *last_seen.write().await = Instant::now();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{SessionState, SessionStore};

    #[tokio::test]
    async fn remove_if_current_keeps_newer_session() {
        let store = SessionStore::<String, usize>::new();
        store
            .insert("server-1".to_string(), SessionState::new("newer", 1))
            .await;

        assert!(
            !store
                .remove_if_current(&"server-1".to_string(), "older")
                .await
        );
        let current = store
            .get(&"server-1".to_string())
            .await
            .expect("current session");
        assert_eq!(current.session_id, "newer");
    }

    #[tokio::test]
    async fn draining_session_is_not_online() {
        let store = SessionStore::<String, usize>::new();
        store
            .insert("server-1".to_string(), SessionState::new("session-1", 1))
            .await;
        assert!(store.is_online(&"server-1".to_string()).await);
        assert!(
            store
                .update_draining(&"server-1".to_string(), "session-1", true)
                .await
        );
        assert!(!store.is_online(&"server-1".to_string()).await);
    }
}
