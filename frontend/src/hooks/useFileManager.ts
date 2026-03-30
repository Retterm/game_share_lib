import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { createGamePanelApi } from "../gamePanelApi";
import {
  getFileType,
  joinPath,
} from "../lib/fileManager";

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
  | null;

const api = createGamePanelApi();

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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      setError(nextError instanceof Error ? nextError.message : "加载目录失败");
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
      setError(nextError instanceof Error ? nextError.message : "下载失败");
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
      setError(nextError instanceof Error ? nextError.message : "加载文件失败");
    }
  };

  const saveEdit = async () => {
    try {
      await api.writeFile(editPath, editContent);
      setShowEdit(false);
      await loadDir();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存失败");
    }
  };

  const onUploadFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setError(null);
    let fail = 0;
    for (const file of files) {
      try {
        await api.writeFile(joinPath(curPath, file.name), file);
      } catch {
        fail += 1;
      }
    }
    setUploading(false);
    if (fail > 0) setError(`部分文件上传失败：${fail} 个`);
    await loadDir();
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
        let fail = 0;
        for (const name of Array.from(selectedFiles)) {
          const entry = entries.find((item) => item.name === name);
          if (!entry) continue;
          try {
            await api.delete(joinPath(curPath, name), entry.is_directory);
          } catch {
            fail += 1;
          }
        }
        setSelectedFiles(new Set());
        if (fail > 0) setError(`部分删除失败：${fail} 项`);
      }
      setDeleteConfirm(null);
      await loadDir();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除失败");
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
      }
      closeDialog();
      await loadDir();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "执行文件操作失败");
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
    uploading,
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
  };
}
