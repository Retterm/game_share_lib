import { useEffect, useRef, useState } from "react";

import { FileArchiveTasksDropdown } from "../components/file/FileArchiveTasksDropdown";
import { FileActionDialog } from "../components/file/FileActionDialog";
import { FileBreadcrumbs } from "../components/file/FileBreadcrumbs";
import { FileEditorDialog } from "../components/file/FileEditorDialog";
import { FileFilterBar } from "../components/file/FileFilterBar";
import { FileSelectionBar } from "../components/file/FileSelectionBar";
import { FileTable } from "../components/file/FileTable";
import { FileToolbar } from "../components/file/FileToolbar";
import { FileUploadDialog } from "../components/file/FileUploadDialog";
import { PanelScaffold } from "../components/page/PanelScaffold";
import { PanelSurface } from "../components/page/PanelSurface";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useFileManager } from "../hooks/useFileManager";
import { joinPath } from "../lib/fileManager";

export function SharedFilesPage() {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const archiveButtonRef = useRef<HTMLButtonElement | null>(null);
  const archiveAreaRef = useRef<HTMLDivElement | null>(null);
  const {
    curPath,
    setCurPath,
    entries,
    sortedFiles,
    availableTypes,
    breadcrumbs,
    loading,
    error,
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
    compressSelected,
    confirmDelete,
    cancelDelete,
    openDialog,
    closeDialog,
    submitDialog,
    toggleFileSelection,
    selectAll,
    toggleSort,
    compressEntry,
    decompressEntry,
    archiveTasks,
    archiveTick,
    loadArchiveTasks,
    cancelArchiveTask,
    showUploadDialog,
    closeUploadDialog,
    uploadItems,
    uploadFiles,
    cancelUploads,
  } = useFileManager();

  useEffect(() => {
    if (!archiveTick) return;
    setLaunching(true);
    const timer = window.setTimeout(() => setLaunching(false), 650);
    return () => window.clearTimeout(timer);
  }, [archiveTick]);

  useEffect(() => {
    if (!archiveOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (archiveAreaRef.current && target && !archiveAreaRef.current.contains(target)) {
        setArchiveOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [archiveOpen]);

  return (
    <PanelScaffold
      bodyClassName="block"
      mainClassName="overflow-visible"
      scrollY
      header={<FileBreadcrumbs items={breadcrumbs} onSelect={(path) => void loadDir(path)} />}
    >
      <PanelSurface className="overflow-visible">
        <div className="flex min-h-0 flex-col p-2 sm:p-3">
          <div ref={archiveAreaRef} className="relative">
            <FileToolbar
              path={curPath}
              loading={loading}
              uploading={uploading}
              archiveTasks={archiveTasks}
              archiveOpen={archiveOpen}
              archiveButtonRef={archiveButtonRef}
              fileInputRef={fileInputRef}
              onPathChange={setCurPath}
              onPathSubmit={() => void loadDir(curPath)}
              onRefresh={() => void loadDir(curPath)}
              onCreateDirectory={() => openDialog("mkdir")}
              onUploadClick={() => fileInputRef.current?.click()}
              onCreateFile={() => openDialog("new-file")}
              onArchiveClick={() => setArchiveOpen((prev) => !prev)}
              onUploadSelected={(event) => void onUploadFilesSelected(event)}
            />
            <FileArchiveTasksDropdown
              open={archiveOpen}
              tasks={archiveTasks}
              onRefresh={() => void loadArchiveTasks()}
              onCancel={(taskId) => void cancelArchiveTask(taskId)}
            />
            {launching ? (
              <div className="pointer-events-none absolute right-24 top-2 z-[360]">
                <div className="animate-[archive-fly_650ms_ease-out_forwards] rounded-full bg-orange-500 px-3 py-1 text-xs font-medium text-white shadow-lg">
                  新任务
                </div>
              </div>
            ) : null}
          </div>

          <FileSelectionBar
            count={selectedFiles.size}
            currentPath={curPath}
            onCompress={() => void compressSelected()}
            onDelete={requestDeleteSelectedFiles}
            onCopy={(path) => openDialog("multi-copy", "", path)}
            onMove={(path) => openDialog("multi-move", "", path)}
            onClear={() => setSelectedFiles(new Set())}
          />

          <FileFilterBar
            filterType={filterType}
            availableTypes={availableTypes}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onFilterChange={setFilterType}
            onFilterClear={() => setFilterType("")}
          />

          <FileTable
            path={curPath}
            entries={sortedFiles}
            allEntriesCount={entries.length}
            loading={loading}
            error={error}
            filterType={filterType}
            selectedFiles={selectedFiles}
            onSelectAll={selectAll}
            onToggleSelection={toggleFileSelection}
            onSort={toggleSort}
            onOpen={(entry) => void openEntry(entry)}
            onEdit={(name) => void startEdit(name)}
            onRename={(name) => openDialog("rename", name, name)}
            onCopy={(name) => openDialog("copy", name, `${name}_copy`)}
            onMove={(name) => openDialog("move", name, joinPath(curPath, name))}
            onCompress={(name) => compressEntry(name)}
            onDecompress={(name) => void decompressEntry(name)}
            onDelete={(entry) => requestDeleteEntry(entry)}
            onNavigateParent={(path) => void loadDir(path)}
          />
        </div>
      </PanelSurface>

      <FileEditorDialog
        open={showEdit}
        path={editPath}
        content={editContent}
        onContentChange={setEditContent}
        onSave={() => void saveEdit()}
        onClose={() => setShowEdit(false)}
      />

      <FileActionDialog
        open={Boolean(dialogKind)}
        kind={dialogKind}
        value={dialogValue}
        selectedCount={selectedFiles.size}
        onValueChange={setDialogValue}
        onSubmit={() => void submitDialog()}
        onClose={closeDialog}
      />

      <ConfirmDialog
        open={Boolean(deleteConfirm)}
        title={deleteConfirm?.mode === "multi" ? "删除已选文件" : "删除文件"}
        description={
          deleteConfirm?.mode === "multi"
            ? `确定要删除选中的 ${selectedFiles.size} 项吗？`
            : deleteConfirm?.mode === "single"
              ? deleteConfirm.entry.is_directory
                ? `确认删除目录及其内容？ ${joinPath(curPath, deleteConfirm.entry.name)}`
                : `确认删除文件？ ${joinPath(curPath, deleteConfirm.entry.name)}`
              : ""
        }
        confirmLabel="删除"
        destructive
        onConfirm={() => void confirmDelete()}
        onClose={cancelDelete}
      />

      <FileUploadDialog
        open={showUploadDialog}
        items={uploadItems}
        uploading={uploading}
        onClose={closeUploadDialog}
        onStart={() => void uploadFiles()}
        onCancel={() => void cancelUploads()}
      />

      <style>{`
        @keyframes archive-fly {
          0% { transform: translate(-220px, 32px) scale(0.7); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translate(0, 0) scale(1); opacity: 0; }
        }
        @keyframes archive-manager-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 rgba(249,115,22,0.12); }
          50% { transform: scale(1.04); box-shadow: 0 0 0.75rem rgba(249,115,22,0.35); }
        }
      `}</style>
    </PanelScaffold>
  );
}
