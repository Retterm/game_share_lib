import { FileActionDialog } from "../components/file/FileActionDialog";
import { FileBreadcrumbs } from "../components/file/FileBreadcrumbs";
import { FileEditorDialog } from "../components/file/FileEditorDialog";
import { FileFilterBar } from "../components/file/FileFilterBar";
import { FileSelectionBar } from "../components/file/FileSelectionBar";
import { FileTable } from "../components/file/FileTable";
import { FileToolbar } from "../components/file/FileToolbar";
import { PanelScaffold } from "../components/page/PanelScaffold";
import { PanelSurface } from "../components/page/PanelSurface";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useFileManager } from "../hooks/useFileManager";
import { joinPath } from "../lib/fileManager";

export function SharedFilesPage() {
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
    confirmDelete,
    cancelDelete,
    openDialog,
    closeDialog,
    submitDialog,
    toggleFileSelection,
    selectAll,
    toggleSort,
  } = useFileManager();

  return (
    <PanelScaffold
      bodyClassName="block"
      mainClassName="overflow-visible"
      scrollY
      header={<FileBreadcrumbs items={breadcrumbs} onSelect={(path) => void loadDir(path)} />}
    >
      <PanelSurface className="overflow-visible">
        <div className="flex min-h-0 flex-col">
          <FileToolbar
            path={curPath}
            loading={loading}
            uploading={uploading}
            fileInputRef={fileInputRef}
            onPathChange={setCurPath}
            onPathSubmit={() => void loadDir(curPath)}
            onRefresh={() => void loadDir(curPath)}
            onCreateDirectory={() => openDialog("mkdir")}
            onUploadClick={() => fileInputRef.current?.click()}
            onCreateFile={() => openDialog("new-file")}
            onUploadSelected={(event) => void onUploadFilesSelected(event)}
          />

          <FileSelectionBar
            count={selectedFiles.size}
            currentPath={curPath}
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
    </PanelScaffold>
  );
}
