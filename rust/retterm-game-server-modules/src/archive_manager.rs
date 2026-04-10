use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::sync::{Mutex, mpsc};
use tokio::time::{Duration, sleep};
use uuid::Uuid;

const QUEUE_LIMIT: usize = 20;
const SUCCESS_TTL_SECS: u64 = 3;
const ERROR_TTL_SECS: u64 = 60;
const COPY_BUF_SIZE: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveTaskKind {
    Compress,
    Decompress,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveTaskStatus {
    Queued,
    Running,
    Canceling,
    Success,
    Failed,
    Canceled,
}

#[derive(Clone, Debug, Serialize)]
pub struct ArchiveTaskView {
    pub id: String,
    pub kind: ArchiveTaskKind,
    pub status: ArchiveTaskStatus,
    pub source_items: Vec<String>,
    pub target_path: String,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub current_item: Option<String>,
    pub items_total: u64,
    pub items_done: u64,
    pub bytes_total: u64,
    pub bytes_done: u64,
    pub message: Option<String>,
    pub can_cancel: bool,
}

#[derive(Clone, Debug)]
pub enum ArchiveRequest {
    Compress {
        root: String,
        sources: Vec<String>,
        dst: String,
    },
    Decompress {
        src: String,
        dst: String,
    },
}

#[derive(Clone, Debug)]
struct TaskRecord {
    view: ArchiveTaskView,
    request: ArchiveRequest,
    control: Arc<TaskControl>,
}

#[derive(Debug)]
struct TaskControl {
    canceled: AtomicBool,
}

#[derive(Debug)]
struct ArchiveState {
    tasks: HashMap<String, TaskRecord>,
    order: VecDeque<String>,
    worker_running: bool,
}

#[derive(Clone, Debug)]
pub struct ArchiveManager {
    root_dir: PathBuf,
    state: Arc<Mutex<ArchiveState>>,
}

#[derive(Clone, Debug)]
struct ProgressUpdate {
    current_item: Option<String>,
    items_done: Option<u64>,
    bytes_done: Option<u64>,
    message: Option<String>,
}

#[derive(Clone, Debug)]
struct PlannedTask {
    items_total: u64,
    bytes_total: u64,
}

enum TaskError {
    Message(String),
    Canceled,
}

impl ArchiveManager {
    pub fn new(root_dir: impl Into<PathBuf>) -> Self {
        Self {
            root_dir: root_dir.into(),
            state: Arc::new(Mutex::new(ArchiveState {
                tasks: HashMap::new(),
                order: VecDeque::new(),
                worker_running: false,
            })),
        }
    }

    pub async fn create_compress_task(
        &self,
        root: String,
        sources: Vec<String>,
        dst: String,
    ) -> Result<ArchiveTaskView, String> {
        if sources.is_empty() {
            return Err("missing source items".into());
        }
        let root_dir = self.root_dir.clone();
        let planned = tokio::task::spawn_blocking({
            let root = root.clone();
            let sources = sources.clone();
            let dst = dst.clone();
            move || plan_compress_task(&root_dir, &root, &sources, &dst)
        })
        .await
        .map_err(|error| error.to_string())??;

        let id = Uuid::new_v4().to_string();
        let view = ArchiveTaskView {
            id: id.clone(),
            kind: ArchiveTaskKind::Compress,
            status: ArchiveTaskStatus::Queued,
            source_items: sources.clone(),
            target_path: dst.clone(),
            created_at: now_ts(),
            started_at: None,
            finished_at: None,
            current_item: None,
            items_total: planned.items_total,
            items_done: 0,
            bytes_total: planned.bytes_total,
            bytes_done: 0,
            message: None,
            can_cancel: true,
        };
        self.insert_task(
            id,
            view.clone(),
            ArchiveRequest::Compress { root, sources, dst },
        )
        .await?;
        Ok(view)
    }

    pub async fn create_decompress_task(
        &self,
        src: String,
        dst: String,
    ) -> Result<ArchiveTaskView, String> {
        let root_dir = self.root_dir.clone();
        let planned = tokio::task::spawn_blocking({
            let src = src.clone();
            let dst = dst.clone();
            move || plan_decompress_task(&root_dir, &src, &dst)
        })
        .await
        .map_err(|error| error.to_string())??;

        let id = Uuid::new_v4().to_string();
        let view = ArchiveTaskView {
            id: id.clone(),
            kind: ArchiveTaskKind::Decompress,
            status: ArchiveTaskStatus::Queued,
            source_items: vec![src.clone()],
            target_path: dst.clone(),
            created_at: now_ts(),
            started_at: None,
            finished_at: None,
            current_item: None,
            items_total: planned.items_total,
            items_done: 0,
            bytes_total: planned.bytes_total,
            bytes_done: 0,
            message: None,
            can_cancel: true,
        };
        self.insert_task(id, view.clone(), ArchiveRequest::Decompress { src, dst })
            .await?;
        Ok(view)
    }

    pub async fn list_tasks(&self) -> Vec<ArchiveTaskView> {
        let state = self.state.lock().await;
        state
            .order
            .iter()
            .filter_map(|id| state.tasks.get(id).map(|task| task.view.clone()))
            .collect()
    }

    pub async fn cancel_task(&self, task_id: &str) -> Result<ArchiveTaskView, String> {
        let ttl = {
            let mut state = self.state.lock().await;
            let task = state
                .tasks
                .get_mut(task_id)
                .ok_or_else(|| "task not found".to_string())?;
            match task.view.status {
                ArchiveTaskStatus::Queued => {
                    task.control.canceled.store(true, Ordering::SeqCst);
                    task.view.status = ArchiveTaskStatus::Canceled;
                    task.view.finished_at = Some(now_ts());
                    task.view.can_cancel = false;
                    task.view.message = Some("canceled before start".into());
                    ERROR_TTL_SECS
                }
                ArchiveTaskStatus::Running => {
                    task.control.canceled.store(true, Ordering::SeqCst);
                    task.view.status = ArchiveTaskStatus::Canceling;
                    task.view.can_cancel = false;
                    0
                }
                ArchiveTaskStatus::Canceling => return Err("task is already canceling".into()),
                ArchiveTaskStatus::Success
                | ArchiveTaskStatus::Failed
                | ArchiveTaskStatus::Canceled => {
                    return Err("task is already finished".into());
                }
            }
        };
        if ttl > 0 {
            self.schedule_cleanup(task_id.to_string(), ttl);
        }
        self.task_view(task_id).await
    }

    async fn task_view(&self, task_id: &str) -> Result<ArchiveTaskView, String> {
        let state = self.state.lock().await;
        state
            .tasks
            .get(task_id)
            .map(|task| task.view.clone())
            .ok_or_else(|| "task not found".to_string())
    }

    async fn insert_task(
        &self,
        id: String,
        view: ArchiveTaskView,
        request: ArchiveRequest,
    ) -> Result<(), String> {
        let mut spawn_worker = false;
        {
            let mut state = self.state.lock().await;
            if state.tasks.len() >= QUEUE_LIMIT {
                return Err("archive queue is full".into());
            }
            let control = Arc::new(TaskControl {
                canceled: AtomicBool::new(false),
            });
            state.order.push_back(id.clone());
            state.tasks.insert(
                id,
                TaskRecord {
                    view,
                    request,
                    control,
                },
            );
            if !state.worker_running {
                state.worker_running = true;
                spawn_worker = true;
            }
        }
        if spawn_worker {
            self.spawn_worker();
        }
        Ok(())
    }

    fn spawn_worker(&self) {
        let manager = self.clone();
        tokio::spawn(async move {
            manager.worker_loop().await;
        });
    }

    async fn worker_loop(self) {
        loop {
            let Some((task_id, request, control)) = self.take_next_task().await else {
                let mut state = self.state.lock().await;
                state.worker_running = false;
                if state
                    .tasks
                    .values()
                    .any(|task| task.view.status == ArchiveTaskStatus::Queued)
                {
                    state.worker_running = true;
                    drop(state);
                    continue;
                }
                break;
            };

            let root_dir = self.root_dir.clone();
            let (progress_tx, mut progress_rx) = mpsc::unbounded_channel::<ProgressUpdate>();
            let handle = tokio::task::spawn_blocking(move || {
                run_task_sync(&root_dir, &request, &control, progress_tx)
            });
            tokio::pin!(handle);

            let outcome = loop {
                tokio::select! {
                    Some(update) = progress_rx.recv() => {
                        self.apply_progress(&task_id, update).await;
                    }
                    result = &mut handle => {
                        break result;
                    }
                }
            };

            let ttl = match outcome {
                Ok(Ok(())) => {
                    self.finish_task(&task_id, ArchiveTaskStatus::Success, None)
                        .await;
                    SUCCESS_TTL_SECS
                }
                Ok(Err(TaskError::Canceled)) => {
                    self.finish_task(
                        &task_id,
                        ArchiveTaskStatus::Canceled,
                        Some("task canceled".into()),
                    )
                    .await;
                    ERROR_TTL_SECS
                }
                Ok(Err(TaskError::Message(message))) => {
                    self.finish_task(&task_id, ArchiveTaskStatus::Failed, Some(message))
                        .await;
                    ERROR_TTL_SECS
                }
                Err(error) => {
                    self.finish_task(
                        &task_id,
                        ArchiveTaskStatus::Failed,
                        Some(error.to_string()),
                    )
                    .await;
                    ERROR_TTL_SECS
                }
            };
            self.schedule_cleanup(task_id, ttl);
        }
    }

    async fn take_next_task(&self) -> Option<(String, ArchiveRequest, Arc<TaskControl>)> {
        let mut state = self.state.lock().await;
        let next_id = state.order.iter().find_map(|id| {
            state
                .tasks
                .get(id)
                .filter(|task| task.view.status == ArchiveTaskStatus::Queued)
                .map(|_| id.clone())
        })?;
        let task = state.tasks.get_mut(&next_id)?;
        task.view.status = ArchiveTaskStatus::Running;
        task.view.started_at = Some(now_ts());
        task.view.message = None;
        task.view.can_cancel = true;
        Some((next_id, task.request.clone(), task.control.clone()))
    }

    async fn apply_progress(&self, task_id: &str, progress: ProgressUpdate) {
        let mut state = self.state.lock().await;
        let Some(task) = state.tasks.get_mut(task_id) else {
            return;
        };
        if let Some(current_item) = progress.current_item {
            task.view.current_item = Some(current_item);
        }
        if let Some(items_done) = progress.items_done {
            task.view.items_done = items_done;
        }
        if let Some(bytes_done) = progress.bytes_done {
            task.view.bytes_done = bytes_done;
        }
        if let Some(message) = progress.message {
            task.view.message = Some(message);
        }
    }

    async fn finish_task(
        &self,
        task_id: &str,
        status: ArchiveTaskStatus,
        message: Option<String>,
    ) {
        let mut state = self.state.lock().await;
        let Some(task) = state.tasks.get_mut(task_id) else {
            return;
        };
        task.view.status = status;
        task.view.finished_at = Some(now_ts());
        task.view.current_item = None;
        task.view.can_cancel = false;
        if matches!(status, ArchiveTaskStatus::Success) {
            task.view.items_done = task.view.items_total;
            task.view.bytes_done = task.view.bytes_total;
        }
        if message.is_some() {
            task.view.message = message;
        }
    }

    fn schedule_cleanup(&self, task_id: String, ttl_secs: u64) {
        let state = self.state.clone();
        tokio::spawn(async move {
            sleep(Duration::from_secs(ttl_secs)).await;
            let mut state = state.lock().await;
            let removable = state.tasks.get(&task_id).map(|task| {
                matches!(
                    task.view.status,
                    ArchiveTaskStatus::Success
                        | ArchiveTaskStatus::Failed
                        | ArchiveTaskStatus::Canceled
                )
            });
            if removable == Some(true) {
                state.tasks.remove(&task_id);
                state.order.retain(|item| item != &task_id);
            }
        });
    }
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

fn plan_compress_task(
    root_dir: &Path,
    root: &str,
    sources: &[String],
    dst: &str,
) -> Result<PlannedTask, String> {
    let root_path = resolve_task_root(root_dir, root)?;
    let _ = resolve_output_path(root_dir, dst)?;
    let mut items_total = 0;
    let mut bytes_total = 0;
    for source in sources {
        let source_path = resolve_relative_to(&root_path, source)?;
        let meta = source_path.metadata().map_err(|error| error.to_string())?;
        if meta.is_file() {
            items_total += 1;
            bytes_total += meta.len();
        } else if meta.is_dir() {
            collect_dir_stats(&source_path, &mut items_total, &mut bytes_total)?;
        }
    }
    Ok(PlannedTask {
        items_total,
        bytes_total,
    })
}

fn plan_decompress_task(root_dir: &Path, src: &str, dst: &str) -> Result<PlannedTask, String> {
    let src_path = resolve_inside_root(root_dir, src)?;
    let _ = resolve_inside_root_allow_empty(root_dir, dst)?;
    let lower = src_path.to_string_lossy().to_lowercase();
    if lower.ends_with(".zip") {
        let file = File::open(&src_path).map_err(|error| error.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
        let mut items_total = 0;
        let mut bytes_total = 0;
        for index in 0..archive.len() {
            let entry = archive.by_index(index).map_err(|error| error.to_string())?;
            if !entry.is_dir() {
                items_total += 1;
                bytes_total += entry.size();
            }
        }
        return Ok(PlannedTask {
            items_total,
            bytes_total,
        });
    }
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        let file = File::open(&src_path).map_err(|error| error.to_string())?;
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        let mut items_total = 0;
        let mut bytes_total = 0;
        let entries = archive.entries().map_err(|error| error.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            if entry.header().entry_type().is_file() {
                items_total += 1;
                bytes_total += entry.size();
            }
        }
        return Ok(PlannedTask {
            items_total,
            bytes_total,
        });
    }
    Err("unsupported archive format".into())
}

fn run_task_sync(
    root_dir: &Path,
    request: &ArchiveRequest,
    control: &TaskControl,
    progress_tx: mpsc::UnboundedSender<ProgressUpdate>,
) -> Result<(), TaskError> {
    match request {
        ArchiveRequest::Compress { root, sources, dst } => {
            run_compress_task(root_dir, root, sources, dst, control, progress_tx)
        }
        ArchiveRequest::Decompress { src, dst } => {
            run_decompress_task(root_dir, src, dst, control, progress_tx)
        }
    }
}

fn run_compress_task(
    root_dir: &Path,
    root: &str,
    sources: &[String],
    dst: &str,
    control: &TaskControl,
    progress_tx: mpsc::UnboundedSender<ProgressUpdate>,
) -> Result<(), TaskError> {
    let root_path = resolve_task_root(root_dir, root).map_err(TaskError::Message)?;
    let dst_path = resolve_output_path(root_dir, dst).map_err(TaskError::Message)?;
    if let Some(parent) = dst_path.parent() {
        std::fs::create_dir_all(parent).map_err(to_task_error)?;
    }
    if sources.len() == 1 {
        let single_source =
            resolve_relative_to(&root_path, &sources[0]).map_err(TaskError::Message)?;
        if single_source == dst_path {
            return Err(TaskError::Message("source and target are identical".into()));
        }
    }

    let mut writer = zip::ZipWriter::new(File::create(&dst_path).map_err(to_task_error)?);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut items_done = 0u64;
    let mut bytes_done = 0u64;

    for source in sources {
        if is_canceled(control) {
            return Err(TaskError::Canceled);
        }
        let source_path = resolve_relative_to(&root_path, source).map_err(TaskError::Message)?;
        let source_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(source.as_str())
            .to_string();
        write_path_to_zip(
            &mut writer,
            &source_path,
            &source_name,
            options,
            control,
            &progress_tx,
            &mut items_done,
            &mut bytes_done,
        )?;
    }

    writer.finish().map_err(to_zip_task_error)?;
    Ok(())
}

fn write_path_to_zip<W: Write + Seek>(
    writer: &mut zip::ZipWriter<W>,
    path: &Path,
    zip_name: &str,
    options: zip::write::SimpleFileOptions,
    control: &TaskControl,
    progress_tx: &mpsc::UnboundedSender<ProgressUpdate>,
    items_done: &mut u64,
    bytes_done: &mut u64,
) -> Result<(), TaskError> {
    if is_canceled(control) {
        return Err(TaskError::Canceled);
    }
    let metadata = path.metadata().map_err(to_task_error)?;
    if metadata.is_dir() {
        for entry in std::fs::read_dir(path).map_err(to_task_error)? {
            let entry = entry.map_err(to_task_error)?;
            let child_path = entry.path();
            let child_name = entry.file_name().to_string_lossy().to_string();
            let child_zip_name = format!("{zip_name}/{child_name}");
            write_path_to_zip(
                writer,
                &child_path,
                &child_zip_name,
                options,
                control,
                progress_tx,
                items_done,
                bytes_done,
            )?;
        }
        return Ok(());
    }

    progress_tx
        .send(ProgressUpdate {
            current_item: Some(zip_name.to_string()),
            items_done: None,
            bytes_done: None,
            message: None,
        })
        .ok();
    writer.start_file(zip_name, options).map_err(to_zip_task_error)?;
    let mut file = File::open(path).map_err(to_task_error)?;
    let start_bytes = *bytes_done;
    let mut latest_bytes = start_bytes;
    copy_with_progress(
        &mut file,
        writer,
        control,
        |written| {
            latest_bytes = written;
            progress_tx
                .send(ProgressUpdate {
                    current_item: Some(zip_name.to_string()),
                    items_done: None,
                    bytes_done: Some(written),
                    message: None,
                })
                .ok();
        },
        start_bytes,
    )?;
    *bytes_done = latest_bytes;
    *items_done += 1;
    progress_tx
        .send(ProgressUpdate {
            current_item: Some(zip_name.to_string()),
            items_done: Some(*items_done),
            bytes_done: Some(*bytes_done),
            message: None,
        })
        .ok();
    Ok(())
}

fn run_decompress_task(
    root_dir: &Path,
    src: &str,
    dst: &str,
    control: &TaskControl,
    progress_tx: mpsc::UnboundedSender<ProgressUpdate>,
) -> Result<(), TaskError> {
    let src_path = resolve_inside_root(root_dir, src).map_err(TaskError::Message)?;
    let dst_path = resolve_inside_root_allow_empty(root_dir, dst).map_err(TaskError::Message)?;
    std::fs::create_dir_all(&dst_path).map_err(to_task_error)?;

    let lower = src_path.to_string_lossy().to_lowercase();
    if lower.ends_with(".zip") {
        return run_zip_decompress(&src_path, &dst_path, control, progress_tx);
    }
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        return run_targz_decompress(&src_path, &dst_path, control, progress_tx);
    }
    Err(TaskError::Message("unsupported archive format".into()))
}

fn run_zip_decompress(
    src_path: &Path,
    dst_path: &Path,
    control: &TaskControl,
    progress_tx: mpsc::UnboundedSender<ProgressUpdate>,
) -> Result<(), TaskError> {
    let file = File::open(src_path).map_err(to_task_error)?;
    let mut archive = zip::ZipArchive::new(file).map_err(to_zip_task_error)?;
    let mut items_done = 0u64;
    let mut bytes_done = 0u64;
    for index in 0..archive.len() {
        if is_canceled(control) {
            return Err(TaskError::Canceled);
        }
        let mut entry = archive.by_index(index).map_err(to_zip_task_error)?;
        let raw_name = entry.name().to_string();
        let Some(rel_path) = sanitize_archive_entry_path(&raw_name) else {
            continue;
        };
        let out_path = dst_path.join(&rel_path);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(to_task_error)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(to_task_error)?;
        }
        progress_tx
            .send(ProgressUpdate {
                current_item: Some(raw_name.clone()),
                items_done: None,
                bytes_done: None,
                message: None,
            })
            .ok();
        let mut output = File::create(&out_path).map_err(to_task_error)?;
        let start_bytes = bytes_done;
        copy_with_progress(
            &mut entry,
            &mut output,
            control,
            |written| {
                bytes_done = written;
                progress_tx
                    .send(ProgressUpdate {
                        current_item: Some(raw_name.clone()),
                        items_done: None,
                        bytes_done: Some(bytes_done),
                        message: None,
                    })
                    .ok();
            },
            start_bytes,
        )?;
        items_done += 1;
        progress_tx
            .send(ProgressUpdate {
                current_item: Some(raw_name),
                items_done: Some(items_done),
                bytes_done: Some(bytes_done),
                message: None,
            })
            .ok();
    }
    Ok(())
}

fn run_targz_decompress(
    src_path: &Path,
    dst_path: &Path,
    control: &TaskControl,
    progress_tx: mpsc::UnboundedSender<ProgressUpdate>,
) -> Result<(), TaskError> {
    let file = File::open(src_path).map_err(to_task_error)?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let mut items_done = 0u64;
    let mut bytes_done = 0u64;
    let entries = archive.entries().map_err(to_task_error)?;
    for entry in entries {
        if is_canceled(control) {
            return Err(TaskError::Canceled);
        }
        let mut entry = entry.map_err(to_task_error)?;
        let path = entry.path().map_err(to_task_error)?;
        let Some(rel_path) = sanitize_archive_entry_path(path.to_string_lossy().as_ref()) else {
            continue;
        };
        let out_path = dst_path.join(&rel_path);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&out_path).map_err(to_task_error)?;
            continue;
        }
        if !entry.header().entry_type().is_file() {
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(to_task_error)?;
        }
        let current_name = rel_path.to_string_lossy().to_string();
        progress_tx
            .send(ProgressUpdate {
                current_item: Some(current_name.clone()),
                items_done: None,
                bytes_done: None,
                message: None,
            })
            .ok();
        let mut output = File::create(&out_path).map_err(to_task_error)?;
        let start_bytes = bytes_done;
        copy_with_progress(
            &mut entry,
            &mut output,
            control,
            |written| {
                bytes_done = written;
                progress_tx
                    .send(ProgressUpdate {
                        current_item: Some(current_name.clone()),
                        items_done: None,
                        bytes_done: Some(bytes_done),
                        message: None,
                    })
                    .ok();
            },
            start_bytes,
        )?;
        items_done += 1;
        progress_tx
            .send(ProgressUpdate {
                current_item: Some(current_name),
                items_done: Some(items_done),
                bytes_done: Some(bytes_done),
                message: None,
            })
            .ok();
    }
    Ok(())
}

fn copy_with_progress<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    control: &TaskControl,
    mut on_progress: impl FnMut(u64),
    start_bytes: u64,
) -> Result<(), TaskError> {
    let mut buf = vec![0u8; COPY_BUF_SIZE];
    let mut written = start_bytes;
    loop {
        if is_canceled(control) {
            return Err(TaskError::Canceled);
        }
        let read = reader.read(&mut buf).map_err(to_task_error)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buf[..read]).map_err(to_task_error)?;
        written += read as u64;
        on_progress(written);
    }
    Ok(())
}

fn collect_dir_stats(
    dir: &Path,
    items_total: &mut u64,
    bytes_total: &mut u64,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let meta = entry.metadata().map_err(|error| error.to_string())?;
        if meta.is_file() {
            *items_total += 1;
            *bytes_total += meta.len();
        } else if meta.is_dir() {
            collect_dir_stats(&path, items_total, bytes_total)?;
        }
    }
    Ok(())
}

fn resolve_task_root(root_dir: &Path, root: &str) -> Result<PathBuf, String> {
    let rel = sanitize_rel_path_allow_empty(root)?;
    let path = if rel.as_os_str().is_empty() {
        root_dir.to_path_buf()
    } else {
        root_dir.join(rel)
    };
    let real = path.canonicalize().map_err(|error| error.to_string())?;
    let root_real = root_dir.canonicalize().map_err(|error| error.to_string())?;
    if !real.starts_with(&root_real) {
        return Err("path traversal".into());
    }
    Ok(real)
}

fn resolve_relative_to(root: &Path, child: &str) -> Result<PathBuf, String> {
    let rel = sanitize_rel_path_non_empty(child)?;
    let path = root.join(rel);
    let real = path.canonicalize().map_err(|error| error.to_string())?;
    if !real.starts_with(root) {
        return Err("path traversal".into());
    }
    Ok(real)
}

fn resolve_output_path(root_dir: &Path, path: &str) -> Result<PathBuf, String> {
    let out_path = resolve_inside_root_allow_empty(root_dir, path)?;
    if out_path == root_dir {
        return Err("empty output path".into());
    }
    Ok(out_path)
}

fn sanitize_archive_entry_path(path: &str) -> Option<PathBuf> {
    if path.contains('\\') {
        return None;
    }
    let mut clean = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(value) => clean.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if clean.as_os_str().is_empty() {
        None
    } else {
        Some(clean)
    }
}

fn sanitize_rel_path_allow_empty(path: &str) -> Result<PathBuf, String> {
    let raw = path.trim().trim_start_matches('/');
    if raw.is_empty() {
        return Ok(PathBuf::new());
    }
    let mut clean = PathBuf::new();
    for component in Path::new(raw).components() {
        match component {
            Component::Normal(value) => clean.push(value),
            Component::CurDir => {}
            Component::ParentDir => return Err("path traversal".into()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("absolute path not allowed".into());
            }
        }
    }
    Ok(clean)
}

fn sanitize_rel_path_non_empty(path: &str) -> Result<PathBuf, String> {
    let rel = sanitize_rel_path_allow_empty(path)?;
    if rel.as_os_str().is_empty() {
        return Err("empty path".into());
    }
    Ok(rel)
}

fn resolve_inside_root(root_dir: &Path, path: &str) -> Result<PathBuf, String> {
    let rel = sanitize_rel_path_non_empty(path)?;
    Ok(root_dir.join(rel))
}

fn resolve_inside_root_allow_empty(root_dir: &Path, path: &str) -> Result<PathBuf, String> {
    let rel = sanitize_rel_path_allow_empty(path)?;
    Ok(root_dir.join(rel))
}

fn is_canceled(control: &TaskControl) -> bool {
    control.canceled.load(Ordering::SeqCst)
}

fn to_task_error(error: std::io::Error) -> TaskError {
    TaskError::Message(error.to_string())
}

fn to_zip_task_error(error: zip::result::ZipError) -> TaskError {
    TaskError::Message(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::PathBuf;

    use super::{
        plan_compress_task, plan_decompress_task, sanitize_archive_entry_path,
        sanitize_rel_path_allow_empty,
    };

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("retterm-archive-test-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    #[test]
    fn sanitize_archive_entry_rejects_escape() {
        assert!(sanitize_archive_entry_path("../a.txt").is_none());
        assert!(sanitize_archive_entry_path("/tmp/a.txt").is_none());
        assert!(sanitize_archive_entry_path("a\\b.txt").is_none());
    }

    #[test]
    fn sanitize_archive_entry_accepts_normal_path() {
        let value = sanitize_archive_entry_path("mods/abc.txt").expect("path");
        assert_eq!(value.to_string_lossy(), "mods/abc.txt");
    }

    #[test]
    fn sanitize_rel_path_allows_empty_and_rejects_parent() {
        assert!(sanitize_rel_path_allow_empty("").expect("empty path").as_os_str().is_empty());
        assert!(sanitize_rel_path_allow_empty("../escape").is_err());
    }

    #[test]
    fn plan_compress_counts_nested_files() {
        let root = temp_root("compress-plan");
        let source_dir = root.join("mods");
        fs::create_dir_all(source_dir.join("nested")).expect("mkdir");
        fs::write(source_dir.join("a.txt"), b"hello").expect("write file");
        fs::write(source_dir.join("nested").join("b.txt"), b"world!").expect("write nested file");

        let planned = plan_compress_task(&root, "/", &[String::from("mods")], "/mods.zip")
            .expect("compress plan");
        assert_eq!(planned.items_total, 2);
        assert_eq!(planned.bytes_total, 11);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn plan_decompress_supports_zip_and_rejects_unknown_extension() {
        let root = temp_root("decompress-plan");
        let zip_path = root.join("sample.zip");
        let file = File::create(&zip_path).expect("create zip");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file(
                "inner.txt",
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated),
            )
            .expect("start zip file");
        writer.write_all(b"zip-content").expect("write zip file");
        writer.finish().expect("finish zip");

        let planned = plan_decompress_task(&root, "/sample.zip", "/out").expect("zip plan");
        assert_eq!(planned.items_total, 1);
        assert_eq!(planned.bytes_total, 11);

        fs::write(root.join("bad.bin"), b"plain").expect("write bad file");
        assert!(plan_decompress_task(&root, "/bad.bin", "/out").is_err());

        let _ = fs::remove_dir_all(root);
    }
}
