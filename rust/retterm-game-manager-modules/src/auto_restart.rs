use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::warn;
use uuid::Uuid;

#[async_trait::async_trait]
pub trait AutoRestartAdapter: Clone + Send + Sync + 'static {
    type State: Clone + Send + Sync + 'static;
    type Target: Send + Sync + 'static;

    fn name(&self) -> &'static str;

    fn interval(&self) -> Duration {
        Duration::from_secs(AUTO_RESTART_RETRY_INTERVAL_SECS as u64)
    }

    async fn list_targets(&self, state: &Self::State) -> anyhow::Result<Vec<Self::Target>>;

    fn uuid(&self, target: &Self::Target) -> Uuid;

    fn auto_restart_state<'a>(&self, target: &'a Self::Target) -> &'a AutoRestartState;

    fn is_eligible(&self, target: &Self::Target) -> bool;

    fn is_running(&self, target: &Self::Target) -> bool;

    fn is_maintenance_state(&self, target: &Self::Target) -> bool;

    async fn sync_status(
        &self,
        state: &Self::State,
        target: &mut Self::Target,
    ) -> anyhow::Result<bool>;

    async fn mark_observing(
        &self,
        state: &Self::State,
        target: &Self::Target,
    ) -> anyhow::Result<()>;

    async fn mark_success(&self, state: &Self::State, target: &Self::Target)
    -> anyhow::Result<()>;

    async fn mark_failure(&self, state: &Self::State, target: &Self::Target)
    -> anyhow::Result<()>;

    async fn mark_starting(&self, state: &Self::State, target: &Self::Target)
    -> anyhow::Result<()>;

    async fn trigger_start(&self, state: &Self::State, target: &Self::Target)
    -> anyhow::Result<bool>;
}

pub const AUTO_RESTART_MAX_FAILURES: i32 = 5;
pub const AUTO_RESTART_RETRY_INTERVAL_SECS: i64 = 10;
pub const AUTO_RESTART_SUCCESS_WINDOW_SECS: i64 = 60;

pub const STOP_REASON_MANUAL_STOP: &str = "manual_stop";
pub const STOP_REASON_INSTALLING: &str = "installing";
pub const STOP_REASON_REINSTALLING: &str = "reinstalling";
pub const STOP_REASON_SUSPENDED: &str = "suspended";
pub const STOP_REASON_UNEXPECTED_EXIT: &str = "unexpected_exit";

pub const START_SOURCE_MANUAL: &str = "manual";
pub const START_SOURCE_AUTO: &str = "auto";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutoRestartState {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub fail_count: i32,
    #[serde(default)]
    pub observing_since: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_started_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_start_source: Option<String>,
    #[serde(default)]
    pub last_failure_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_success_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub blocked_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub block_reason: Option<String>,
    #[serde(default)]
    pub last_stop_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoRestartStatus {
    pub enabled: bool,
    pub fail_count: i32,
    pub max_failures: i32,
    pub blocked: bool,
    pub observing: bool,
    pub observing_since: Option<DateTime<Utc>>,
    pub last_started_at: Option<DateTime<Utc>>,
    pub last_failure_at: Option<DateTime<Utc>>,
    pub last_success_at: Option<DateTime<Utc>>,
    pub block_reason: Option<String>,
}

impl AutoRestartState {
    pub fn to_status(&self) -> AutoRestartStatus {
        AutoRestartStatus {
            enabled: self.enabled,
            fail_count: self.fail_count,
            max_failures: AUTO_RESTART_MAX_FAILURES,
            blocked: self.blocked_at.is_some(),
            observing: self.observing_since.is_some(),
            observing_since: self.observing_since,
            last_started_at: self.last_started_at,
            last_failure_at: self.last_failure_at,
            last_success_at: self.last_success_at,
            block_reason: self.block_reason.clone(),
        }
    }

    pub fn is_maintenance_reason(reason: Option<&str>) -> bool {
        matches!(
            reason,
            Some(STOP_REASON_MANUAL_STOP)
                | Some(STOP_REASON_INSTALLING)
                | Some(STOP_REASON_REINSTALLING)
                | Some(STOP_REASON_SUSPENDED)
        )
    }

    pub fn should_mark_success(&self, now: DateTime<Utc>) -> bool {
        self.observing_since
            .map(|since| (now - since).num_seconds() >= AUTO_RESTART_SUCCESS_WINDOW_SECS)
            .unwrap_or(false)
    }

    pub fn should_mark_timeout_failure(&self, now: DateTime<Utc>) -> bool {
        self.last_started_at
            .map(|since| (now - since).num_seconds() >= AUTO_RESTART_SUCCESS_WINDOW_SECS)
            .unwrap_or(false)
    }

    pub fn should_retry_now(&self, now: DateTime<Utc>) -> bool {
        if !self.enabled || self.blocked_at.is_some() || self.last_started_at.is_some() {
            return false;
        }
        self.last_failure_at
            .map(|ts| (now - ts).num_seconds() >= AUTO_RESTART_RETRY_INTERVAL_SECS)
            .unwrap_or(true)
    }
}

pub fn spawn_auto_restart_reconciler<A>(state: A::State, adapter: A)
where
    A: AutoRestartAdapter,
{
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(adapter.interval());
        loop {
            tick.tick().await;
            reconcile_auto_restart_once(&state, &adapter).await;
        }
    });
}

pub async fn reconcile_auto_restart_once<A>(state: &A::State, adapter: &A)
where
    A: AutoRestartAdapter,
{
    let targets = match adapter.list_targets(state).await {
        Ok(targets) => targets,
        Err(error) => {
            warn!(service = adapter.name(), error = %error, "auto_restart.list_targets_failed");
            return;
        }
    };

    for mut target in targets {
        if !adapter.is_eligible(&target) {
            continue;
        }

        let uuid = adapter.uuid(&target);
        let online = match adapter.sync_status(state, &mut target).await {
            Ok(online) => online,
            Err(error) => {
                warn!(service = adapter.name(), server_uuid = %uuid, error = %error, "auto_restart.sync_status_failed");
                false
            }
        };

        let now = Utc::now();
        let auto_restart = adapter.auto_restart_state(&target).clone();

        if adapter.is_running(&target) {
            if auto_restart.last_started_at.is_some() {
                let result = if auto_restart.observing_since.is_none() {
                    adapter.mark_observing(state, &target).await
                } else if auto_restart.should_mark_success(now) {
                    adapter.mark_success(state, &target).await
                } else {
                    Ok(())
                };
                if let Err(error) = result {
                    warn!(service = adapter.name(), server_uuid = %uuid, error = %error, "auto_restart.mark_running_failed");
                }
            }
            continue;
        }

        if adapter.is_maintenance_state(&target)
            || AutoRestartState::is_maintenance_reason(auto_restart.last_stop_reason.as_deref())
        {
            continue;
        }

        if auto_restart.last_started_at.is_some() {
            if !online
                || auto_restart.observing_since.is_some()
                || auto_restart.should_mark_timeout_failure(now)
            {
                if let Err(error) = adapter.mark_failure(state, &target).await {
                    warn!(service = adapter.name(), server_uuid = %uuid, error = %error, "auto_restart.mark_failure_failed");
                }
            }
            continue;
        }

        if !online || !auto_restart.should_retry_now(now) {
            continue;
        }

        let started = match adapter.trigger_start(state, &target).await {
            Ok(started) => started,
            Err(error) => {
                warn!(service = adapter.name(), server_uuid = %uuid, error = %error, "auto_restart.trigger_start_failed");
                false
            }
        };

        let result = if started {
            adapter.mark_starting(state, &target).await
        } else {
            adapter.mark_failure(state, &target).await
        };
        if let Err(error) = result {
            warn!(service = adapter.name(), server_uuid = %uuid, error = %error, "auto_restart.persist_result_failed");
        }
    }
}
