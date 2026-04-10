use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use base64::{Engine as _, engine::general_purpose};
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::Mutex;

use crate::archive_manager::ArchiveManager;

#[derive(Debug, Serialize)]
pub struct FsEntry {
    pub name: String,
    pub is_directory: bool,
    pub size: String,
    pub modified: i64,
    pub permissions: String,
}

#[derive(Clone, Debug)]
struct UploadSession {
    path: String,
    temp_path: String,
    bytes_received: u64,
}

#[derive(Clone)]
pub struct FsService {
    root_dir: PathBuf,
    uploads: Arc<Mutex<HashMap<String, UploadSession>>>,
    archive: Arc<ArchiveManager>,
}

static DEFAULT_UPLOADS: Lazy<Arc<Mutex<HashMap<String, UploadSession>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

impl FsService {
    pub fn new(root_dir: impl Into<PathBuf>) -> Self {
        let root_dir = root_dir.into();
        Self {
            archive: Arc::new(ArchiveManager::new(root_dir.clone())),
            root_dir,
            uploads: DEFAULT_UPLOADS.clone(),
        }
    }

    pub async fn list(&self, path: String) -> Result<Value, String> {
        let entries = list_dir(&self.root_dir, &path)
            .await
            .map_err(|error| error.to_string())?;
        Ok(serde_json::to_value(entries).unwrap_or_default())
    }

    pub async fn read(&self, path: String) -> Result<Value, String> {
        let data = read_file(&self.root_dir, &path)
            .await
            .map_err(|error| error.to_string())?;
        Ok(json!({
            "content_base64": general_purpose::STANDARD.encode(&data),
            "size": data.len(),
        }))
    }

    pub async fn write(&self, path: String, content_base64: String) -> Result<Value, String> {
        let data = general_purpose::STANDARD
            .decode(content_base64)
            .map_err(|error| error.to_string())?;
        write_file(&self.root_dir, &path, &data)
            .await
            .map_err(|error| error.to_string())?;
        Ok(json!({ "ok": true }))
    }

    pub async fn mkdir(&self, path: String) -> Result<Value, String> {
        create_dir(&self.root_dir, &path)
            .await
            .map_err(|error| error.to_string())?;
        Ok(json!({ "ok": true }))
    }

    pub async fn delete(&self, path: String, recursive: bool) -> Result<Value, String> {
        delete_path(&self.root_dir, &path, recursive)
            .await
            .map_err(|error| error.to_string())?;
        Ok(json!({ "ok": true }))
    }

    pub async fn rename(&self, from: String, to: String) -> Result<Value, String> {
        rename_path(&self.root_dir, &from, &to)
            .await
            .map_err(|error| error.to_string())?;
        Ok(json!({ "ok": true }))
    }

    pub async fn copy(&self, from: String, to: String) -> Result<Value, String> {
        copy_path(&self.root_dir, &from, &to)
            .await
            .map_err(|error| error.to_string())?;
        Ok(json!({ "ok": true }))
    }

    pub async fn compress(&self, src: String, dst: String) -> Result<Value, String> {
        let src_path = sanitize_rel_path_non_empty(&src).map_err(|error| error.to_string())?;
        let root = src_path
            .parent()
            .map(|value| format!("/{}", value.to_string_lossy()))
            .unwrap_or_else(|| "/".to_string());
        let source_name = src_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "invalid source path".to_string())?
            .to_string();
        self.compress_many(root, vec![source_name], dst).await
    }

    pub async fn compress_many(
        &self,
        root: String,
        sources: Vec<String>,
        dst: String,
    ) -> Result<Value, String> {
        let task = self.archive.create_compress_task(root, sources, dst).await?;
        Ok(serde_json::to_value(task).unwrap_or_default())
    }

    pub async fn decompress(&self, src: String, dst: String) -> Result<Value, String> {
        let task = self.archive.create_decompress_task(src, dst).await?;
        Ok(serde_json::to_value(task).unwrap_or_default())
    }

    pub async fn list_archive_tasks(&self) -> Result<Value, String> {
        Ok(json!({ "items": self.archive.list_tasks().await }))
    }

    pub async fn cancel_archive_task(&self, task_id: String) -> Result<Value, String> {
        let task = self.archive.cancel_task(&task_id).await?;
        Ok(serde_json::to_value(task).unwrap_or_default())
    }

    pub async fn upload_init(&self, path: String, temp_prefix: &str) -> Result<Value, String> {
        let upload_id = uuid::Uuid::new_v4().to_string();
        let temp_path = std::env::temp_dir()
            .join(format!("{temp_prefix}-{upload_id}.bin"))
            .to_string_lossy()
            .to_string();
        tokio::fs::write(&temp_path, &[])
            .await
            .map_err(|error| error.to_string())?;
        self.uploads.lock().await.insert(
            upload_id.clone(),
            UploadSession {
                path,
                temp_path,
                bytes_received: 0,
            },
        );
        Ok(json!({ "upload_id": upload_id }))
    }

    pub async fn upload_commit(&self, payload: Value) -> Result<Value, String> {
        let upload_id = get_upload_id(&payload)?;
        let session = self
            .uploads
            .lock()
            .await
            .remove(upload_id.as_str())
            .ok_or_else(|| "upload session not found".to_string())?;
        if let Some(encoded) = payload
            .get("content_base64")
            .and_then(|value| value.as_str())
        {
            let data = general_purpose::STANDARD
                .decode(encoded)
                .map_err(|error| error.to_string())?;
            write_file(&self.root_dir, &session.path, &data)
                .await
                .map_err(|error| error.to_string())?;
        } else {
            let data = tokio::fs::read(&session.temp_path)
                .await
                .map_err(|error| error.to_string())?;
            write_file(&self.root_dir, &session.path, &data)
                .await
                .map_err(|error| error.to_string())?;
        }
        let _ = tokio::fs::remove_file(&session.temp_path).await;
        Ok(json!({ "ok": true }))
    }

    pub async fn upload_status(&self, payload: Value) -> Result<Value, String> {
        let upload_id = get_upload_id(&payload)?;
        let uploads = self.uploads.lock().await;
        let Some(session) = uploads.get(upload_id.as_str()) else {
            return Err("upload session not found".into());
        };
        Ok(json!({
            "upload_id": upload_id,
            "path": session.path,
            "bytes_received": session.bytes_received,
        }))
    }

    pub async fn upload_abort(&self, payload: Value) -> Result<Value, String> {
        let upload_id = get_upload_id(&payload)?;
        if let Some(session) = self.uploads.lock().await.remove(upload_id.as_str()) {
            let _ = tokio::fs::remove_file(&session.temp_path).await;
            return Ok(json!({ "ok": true }));
        }
        Err("upload session not found".into())
    }

    pub async fn download_init(&self, path: String) -> Result<Value, String> {
        let data = read_file(&self.root_dir, &path)
            .await
            .map_err(|error| error.to_string())?;
        Ok(json!({
            "path": path,
            "content_base64": general_purpose::STANDARD.encode(data),
        }))
    }
}

fn get_upload_id(payload: &Value) -> Result<String, String> {
    payload
        .get("upload_id")
        .or_else(|| payload.get("uploadId"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .ok_or_else(|| "missing upload_id".to_string())
}

fn sanitize_rel_path_allow_empty(path: &str) -> Result<PathBuf, std::io::Error> {
    let raw = path.trim().trim_start_matches('/');
    if raw.is_empty() {
        return Ok(PathBuf::new());
    }

    let mut clean = PathBuf::new();
    for component in Path::new(raw).components() {
        match component {
            Component::Normal(value) => clean.push(value),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "path traversal",
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "absolute path not allowed",
                ));
            }
        }
    }
    Ok(clean)
}

fn sanitize_rel_path_non_empty(path: &str) -> Result<PathBuf, std::io::Error> {
    let rel = sanitize_rel_path_allow_empty(path)?;
    if rel.as_os_str().is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "empty path",
        ));
    }
    Ok(rel)
}

fn resolve_inside_root(root: &Path, path: &str) -> Result<PathBuf, String> {
    let rel = sanitize_rel_path_non_empty(path).map_err(|error| error.to_string())?;
    Ok(root.join(rel))
}

fn resolve_inside_root_allow_empty(root: &Path, path: &str) -> Result<PathBuf, String> {
    let rel = sanitize_rel_path_allow_empty(path).map_err(|error| error.to_string())?;
    Ok(root.join(rel))
}

async fn ensure_dir_path(base: &Path, rel: &Path) -> Result<(), std::io::Error> {
    let mut cur = base.to_path_buf();
    for component in rel.components() {
        let Component::Normal(name) = component else {
            continue;
        };
        cur.push(name);
        if let Ok(meta) = tokio::fs::symlink_metadata(&cur).await {
            if meta.file_type().is_symlink() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "symlink not allowed",
                ));
            }
            if !meta.is_dir() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    "path exists and is not a directory",
                ));
            }
        } else {
            tokio::fs::create_dir(&cur).await?;
        }
        let real = tokio::fs::canonicalize(&cur).await?;
        if !real.starts_with(base) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "path traversal",
            ));
        }
    }
    Ok(())
}

pub async fn list_dir(root: &Path, rel_path: &str) -> Result<Vec<FsEntry>, std::io::Error> {
    use std::os::unix::fs::PermissionsExt;

    let base = tokio::fs::canonicalize(root).await?;
    let rel = sanitize_rel_path_allow_empty(rel_path)?;
    let target = if rel.as_os_str().is_empty() {
        base.clone()
    } else {
        tokio::fs::canonicalize(base.join(&rel)).await?
    };
    if !target.starts_with(&base) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path traversal",
        ));
    }

    let mut dir = tokio::fs::read_dir(&target).await?;
    let mut entries = Vec::new();
    while let Some(entry) = dir.next_entry().await? {
        let meta = entry.metadata().await?;
        let mode = meta.permissions().mode();
        let modified = meta
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_secs() as i64)
            .unwrap_or(0);
        entries.push(FsEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_directory: meta.is_dir(),
            size: meta.len().to_string(),
            modified,
            permissions: format!("{mode:o}"),
        });
    }
    Ok(entries)
}

pub async fn read_file(root: &Path, rel_path: &str) -> Result<Vec<u8>, std::io::Error> {
    let base = tokio::fs::canonicalize(root).await?;
    let rel = sanitize_rel_path_non_empty(rel_path)?;
    let target = tokio::fs::canonicalize(base.join(&rel)).await?;
    if !target.starts_with(&base) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path traversal",
        ));
    }
    tokio::fs::read(target).await
}

pub async fn write_file(root: &Path, rel_path: &str, data: &[u8]) -> Result<(), std::io::Error> {
    use tokio::io::AsyncWriteExt;

    let base = tokio::fs::canonicalize(root).await?;
    let rel = sanitize_rel_path_non_empty(rel_path)?;
    if let Some(parent) = rel.parent() {
        ensure_dir_path(&base, parent).await?;
    }
    let target = base.join(rel);
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o644)
        .open(target)
        .await?;
    file.write_all(data).await?;
    Ok(())
}

pub async fn create_dir(root: &Path, rel_path: &str) -> Result<(), std::io::Error> {
    let base = tokio::fs::canonicalize(root).await?;
    let rel = sanitize_rel_path_allow_empty(rel_path)?;
    if rel.as_os_str().is_empty() {
        return Ok(());
    }
    ensure_dir_path(&base, &rel).await
}

pub async fn delete_path(
    root: &Path,
    rel_path: &str,
    recursive: bool,
) -> Result<(), std::io::Error> {
    let base = tokio::fs::canonicalize(root).await?;
    let rel = sanitize_rel_path_non_empty(rel_path)?;
    let target = tokio::fs::canonicalize(base.join(&rel)).await?;
    if !target.starts_with(&base) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path traversal",
        ));
    }
    let meta = tokio::fs::metadata(&target).await?;
    if meta.is_dir() {
        if recursive {
            tokio::fs::remove_dir_all(target).await
        } else {
            tokio::fs::remove_dir(target).await
        }
    } else {
        tokio::fs::remove_file(target).await
    }
}

pub async fn rename_path(root: &Path, from: &str, to: &str) -> Result<(), std::io::Error> {
    let base = tokio::fs::canonicalize(root).await?;
    let from_rel = sanitize_rel_path_non_empty(from)?;
    let to_rel = sanitize_rel_path_non_empty(to)?;
    if let Some(parent) = to_rel.parent() {
        ensure_dir_path(&base, parent).await?;
    }
    tokio::fs::rename(base.join(from_rel), base.join(to_rel)).await
}

pub async fn copy_path(root: &Path, from: &str, to: &str) -> Result<(), std::io::Error> {
    let data = read_file(root, from).await?;
    write_file(root, to, &data).await
}
