import type { ChangeEvent, RefObject } from "react";

import type { ArchiveTaskView } from "../../gamePanelApi";
import { testAttrs } from "../../lib/testAttrs";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface FileToolbarProps {
  path: string;
  loading: boolean;
  uploading: boolean;
  archiveTasks: ArchiveTaskView[];
  archiveOpen: boolean;
  archiveButtonRef: RefObject<HTMLButtonElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onPathChange: (value: string) => void;
  onPathSubmit: () => void;
  onRefresh: () => void;
  onCreateDirectory: () => void;
  onUploadClick: () => void;
  onCreateFile: () => void;
  onArchiveClick: () => void;
  onUploadSelected: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function FileToolbar({
  path,
  loading,
  uploading,
  archiveTasks,
  archiveOpen,
  archiveButtonRef,
  fileInputRef,
  onPathChange,
  onPathSubmit,
  onRefresh,
  onCreateDirectory,
  onUploadClick,
  onCreateFile,
  onArchiveClick,
  onUploadSelected,
}: FileToolbarProps) {
  const activeCount = archiveTasks.filter((task) =>
    ["queued", "running", "canceling", "failed"].includes(task.status),
  ).length;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <Input
        value={path}
        onChange={(event) => onPathChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onPathSubmit();
        }}
        className="min-w-[200px] flex-1 h-9"
      />
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
        刷新
      </Button>
      <Button variant="outline" size="sm" onClick={onCreateDirectory}>
        新建目录
      </Button>
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onUploadSelected} />
      <Button variant="outline" size="sm" disabled={uploading} onClick={onUploadClick}>
        {uploading ? "上传中..." : "上传文件"}
      </Button>
      <Button variant="outline" size="sm" onClick={onCreateFile}>
        新建文件
      </Button>
      <Button
        ref={archiveButtonRef}
        variant={archiveOpen || activeCount > 0 ? "default" : "outline"}
        size="sm"
        {...testAttrs("archive-manager-button")}
        className={
          activeCount > 0
            ? "relative animate-[archive-manager-pulse_1.6s_ease-in-out_infinite] shadow-[0_0_16px_rgba(249,115,22,0.35)]"
            : "relative"
        }
        onClick={onArchiveClick}
      >
        压缩管理器
        {activeCount > 0 ? (
          <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs">
            {activeCount}
          </span>
        ) : null}
      </Button>
    </div>
  );
}
