import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { createGamePanelApi } from "../gamePanelApi";
import { formatUploadError } from "../gamePanelApi";
import { joinPath, getFileType } from "../lib/fileManager";
import { sha256Hex } from "../lib/sha256";

type FsEntry = {
  name: string;
  is_directory: boolean;
  size: string;
  modified: number;
  permissions: string;
};

type DeleteConfirmState =
  | { mode: "single"; entry: FsEntry }
  | { mode: "multi" }
  | null;

type SortBy = "name" | "size" | "modified" | "type";
type SortOrder = "asc" | "desc";
type DialogKind =
  | "rename"
  | "copy"
  | "move"
  | "multi-copy"
  | "multi-move"
  | "mkdir"
  | "new-file"
  | "compress"
  | null;

type UploadItem = {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  uploadedBytes: number;
  startTime: number;
  lastUpdateTime: number;
  error?: string;
  controller?: AbortController;
};

const api = createGamePanelApi();
const MULTIPART_THRESHOLD = 8 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;

function normalizeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useFileManager() {
  const [curPath, setCurPath] = useState<string>("/");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [filterType, setFilterType] = useState<string>("");
  const [showEdit, setShowEdit] = useState(false);
  const [editPath, setEditPath] = useState("");
  const [editContent, setEditContent] = useState("");
  const [dialogKind, setDialogKind] = useState<DialogKind>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [dialogSource, setDialogSource] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadAbortRequested, setUploadAbortRequested] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortRequestedRef = useRef(false);

  const loadDir = async (path?: string) => {
    const target = typeof path === "string" ? path : curPath;
    setLoading(true);
    setError(null);
    setSelectedFiles(new Set());
    try {
      const list = await api.listFiles<FsEntry[]>(target);
      setEntries(list);
      setCurPath(target);
    } catch (nextError) {
      setError(normalizeError(nextError, "加载目录失败"));
    } finally {
      setLoading(false);
    }
  };

  const openEntry = async (entry: FsEntry) => {
    if (entry.is_directory) {
      await loadDir(joinPath(curPath, entry.name));
      return;
    }
    try {
      window.open(api.downloadUrl(joinPath(curPath, entry.name)), "_blank", "noopener");
    } catch (nextError) {
      setError(normalizeError(nextError, "下载失败"));
    }
  };

  const startEdit = async (name: string) => {
    const path = joinPath(curPath, name);
    try {
      const payload = await api.readFile(path);
      setEditPath(path);
      setEditContent(payload.content);
      setShowEdit(true);
      setError(null);
    } catch (nextError) {
      setError(normalizeError(nextError, "加载文件失败"));
    }
  };

  const saveEdit = async () => {
    try {
      await api.writeFile(editPath, editContent);
      setShowEdit(false);
      await loadDir();
    } catch (nextError) {
      setError(normalizeError(nextError, "保存失败"));
    }
  };

  const onUploadFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setUploadItems(
      files.map((file) => ({
        file,
        progress: 0,
        status: "pending" as const,
        uploadedBytes: 0,
        startTime: 0,
        lastUpdateTime: 0,
      })),
    );
    setUploadAbortRequested(false);
    uploadAbortRequestedRef.current = false;
    setShowUploadDialog(true);
    setError(null);
  };

  const updateUploadItem = (index: number, nextItem: UploadItem) => {
    setUploadItems((prev) => prev.map((item, itemIndex) => (itemIndex === index ? nextItem : item)));
  };

  const uploadFiles = async () => {
    if (!uploadItems.length || isUploading) return;
    setIsUploading(true);
    setUploadAbortRequested(false);
    uploadAbortRequestedRef.current = false;
    let failures = 0;

    for (let index = 0; index < uploadItems.length; index += 1) {
      if (uploadAbortRequestedRef.current) break;
      const item = uploadItems[index];
      const controller = new AbortController();
      const startTime = Date.now();
      updateUploadItem(index, {
        ...item,
        controller,
        status: "uploading",
        startTime,
        lastUpdateTime: startTime,
        uploadedBytes: 0,
        progress: 0,
        error: undefined,
      });

      try {
        const targetPath = joinPath(curPath, item.file.name);
        if (item.file.size < MULTIPART_THRESHOLD) {
          await api.writeFile(targetPath, item.file);
          updateUploadItem(index, {
            ...item,
            status: "done",
            progress: 100,
            uploadedBytes: item.file.size,
            startTime,
            lastUpdateTime: Date.now(),
          });
          continue;
        }

        const init = await api.fs2UploadInit(targetPath, item.file.size, {
          mode: "multipart",
          partSize: PART_SIZE,
        });
        const uploadId = init.upload_id;
        const partSize = init.part_size || PART_SIZE;

        for (let offset = 0, partNo = 0; offset < item.file.size; offset += partSize, partNo += 1) {
          if (uploadAbortRequestedRef.current) {
            await api.fs2UploadAbort(uploadId).catch(() => undefined);
            throw new Error("上传已取消");
          }
          const chunk = item.file.slice(offset, Math.min(offset + partSize, item.file.size));
          const buffer = await chunk.arrayBuffer();
          const digest = await sha256Hex(buffer);
          await api.fs2UploadPart(uploadId, partNo, new Uint8Array(buffer), digest, controller.signal);
          const uploadedBytes = Math.min(offset + chunk.size, item.file.size);
          updateUploadItem(index, {
            ...item,
            controller,
            status: "uploading",
            progress: Math.round((uploadedBytes / item.file.size) * 100),
            uploadedBytes,
            startTime,
            lastUpdateTime: Date.now(),
          });
        }

        await api.fs2UploadCommit(uploadId);
        updateUploadItem(index, {
          ...item,
          status: "done",
          progress: 100,
          uploadedBytes: item.file.size,
          startTime,
          lastUpdateTime: Date.now(),
        });
      } catch (nextError) {
        failures += 1;
        updateUploadItem(index, {
          ...item,
          status: "error",
          error: formatUploadError(nextError) || normalizeError(nextError, "上传失败"),
          uploadedBytes: item.file.size ? Math.min(item.file.size, item.file.size) : 0,
          lastUpdateTime: Date.now(),
          startTime: startTime || Date.now(),
        });
      }
    }

    setIsUploading(false);
    if (failures > 0) {
      setError(`部分文件上传失败：${failures} 个`);
    }
    if (!uploadAbortRequestedRef.current) {
      await loadDir();
    }
  };

  const cancelUploads = async () => {
    setUploadAbortRequested(true);
    uploadAbortRequestedRef.current = true;
    setIsUploading(false);
    setUploadItems((prev) => {
      prev.forEach((item) => item.controller?.abort());
      return [...prev];
    });
    await loadDir();
  };

  const closeUploadDialog = () => {
    if (isUploading) return;
    setShowUploadDialog(false);
    setUploadItems([]);
  };

  const requestDeleteEntry = (entry: FsEntry) => {
    setDeleteConfirm({ mode: "single", entry });
  };

  const requestDeleteSelectedFiles = () => {
    if (selectedFiles.size === 0) return;
    setDeleteConfirm({ mode: "multi" });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      if (deleteConfirm.mode === "single") {
        const target = joinPath(curPath, deleteConfirm.entry.name);
        await api.delete(target, deleteConfirm.entry.is_directory);
      } else {
        let failures = 0;
        for (const name of Array.from(selectedFiles)) {
          const entry = entries.find((item) => item.name === name);
          if (!entry) continue;
          try {
            await api.delete(joinPath(curPath, name), entry.is_directory);
          } catch {
            failures += 1;
          }
        }
        setSelectedFiles(new Set());
        if (failures > 0) {
          setError(`部分删除失败：${failures} 项`);
        }
      }
      setDeleteConfirm(null);
      await loadDir();
    } catch (nextError) {
      setError(normalizeError(nextError, "删除失败"));
    }
  };

  const openDialog = (kind: DialogKind, source = "", initial = "") => {
    setDialogKind(kind);
    setDialogSource(source);
    setDialogValue(initial);
  };

  const closeDialog = () => {
    setDialogKind(null);
    setDialogSource("");
    setDialogValue("");
  };

  const submitDialog = async () => {
    const value = dialogValue.trim();
    if (!dialogKind || !value) return;
    try {
      if (dialogKind === "rename") {
        await api.rename(joinPath(curPath, dialogSource), joinPath(curPath, value));
      } else if (dialogKind === "copy") {
        await api.copy(joinPath(curPath, dialogSource), joinPath(curPath, value));
      } else if (dialogKind === "move") {
        await api.rename(joinPath(curPath, dialogSource), value);
      } else if (dialogKind === "multi-copy") {
        for (const name of Array.from(selectedFiles)) {
          await api.copy(joinPath(curPath, name), value === "/" ? `/${name}` : `${value.replace(/\/$/, "")}/${name}`);
        }
        setSelectedFiles(new Set());
      } else if (dialogKind === "multi-move") {
        for (const name of Array.from(selectedFiles)) {
          await api.rename(joinPath(curPath, name), value === "/" ? `/${name}` : `${value.replace(/\/$/, "")}/${name}`);
        }
        setSelectedFiles(new Set());
      } else if (dialogKind === "mkdir") {
        await api.mkdir(joinPath(curPath, value));
      } else if (dialogKind === "new-file") {
        await api.writeFile(joinPath(curPath, value), "");
      } else if (dialogKind === "compress") {
        await api.compress(joinPath(curPath, dialogSource), value);
      }
      closeDialog();
      await loadDir();
    } catch (nextError) {
      setError(normalizeError(nextError, "执行文件操作失败"));
    }
  };

  const compressEntry = (name: string) => {
    const defaultTarget = joinPath(curPath, `${name}.zip`);
    openDialog("compress", name, defaultTarget);
  };

  const decompressEntry = async (name: string) => {
    try {
      await api.decompress(joinPath(curPath, name), curPath);
      await loadDir();
    } catch (nextError) {
      setError(normalizeError(nextError, "解压失败"));
    }
  };

  const toggleFileSelection = (name: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSort = (column: SortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
      return;
    }
    setSortBy(column);
    setSortOrder("asc");
  };

  const sortedFiles = useMemo(() => {
    let filtered = entries;
    if (filterType) filtered = entries.filter((entry) => getFileType(entry) === filterType);
    return filtered.slice().sort((a, b) => {
      if (!a.is_directory && b.is_directory) return 1;
      if (a.is_directory && !b.is_directory) return -1;
      let result = 0;
      switch (sortBy) {
        case "name":
          result = a.name.localeCompare(b.name, "zh-CN", { numeric: true });
          break;
        case "size":
          result = Number(a.size) - Number(b.size);
          break;
        case "modified":
          result = a.modified - b.modified;
          break;
        case "type":
          result = getFileType(a).localeCompare(getFileType(b), "zh-CN");
          break;
      }
      return sortOrder === "asc" ? result : -result;
    });
  }, [entries, filterType, sortBy, sortOrder]);

  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    entries.forEach((entry) => types.add(getFileType(entry)));
    return Array.from(types).sort();
  }, [entries]);

  const breadcrumbs = useMemo(() => {
    const parts = curPath.split("/").filter(Boolean);
    const result = [{ name: "主目录", path: "/" }];
    let path = "";
    for (const part of parts) {
      path += `/${part}`;
      result.push({ name: part, path });
    }
    return result;
  }, [curPath]);

  const selectAll = () => {
    if (selectedFiles.size === sortedFiles.length) {
      setSelectedFiles(new Set());
      return;
    }
    setSelectedFiles(new Set(sortedFiles.map((file) => file.name)));
  };

  useEffect(() => {
    void loadDir("/");
  }, []);

  return {
    curPath,
    setCurPath,
    entries,
    sortedFiles,
    availableTypes,
    breadcrumbs,
    loading,
    error,
    setError,
    selectedFiles,
    sortBy,
    sortOrder,
    filterType,
    setFilterType,
    showEdit,
    setShowEdit,
    editPath,
    editContent,
    setEditContent,
    dialogKind,
    dialogValue,
    setDialogValue,
    dialogSource,
    deleteConfirm,
    uploading: isUploading,
    fileInputRef,
    loadDir,
    openEntry,
    startEdit,
    saveEdit,
    onUploadFilesSelected,
    requestDeleteEntry,
    requestDeleteSelectedFiles,
    confirmDelete,
    cancelDelete: () => setDeleteConfirm(null),
    openDialog,
    closeDialog,
    submitDialog,
    toggleFileSelection,
    selectAll,
    toggleSort,
    compressEntry,
    decompressEntry,
    showUploadDialog,
    closeUploadDialog,
    uploadItems,
    uploadFiles,
    cancelUploads,
    uploadAbortRequested,
  };
}
