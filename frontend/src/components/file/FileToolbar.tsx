import type { ChangeEvent, RefObject } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface FileToolbarProps {
  path: string;
  loading: boolean;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onPathChange: (value: string) => void;
  onPathSubmit: () => void;
  onRefresh: () => void;
  onCreateDirectory: () => void;
  onUploadClick: () => void;
  onCreateFile: () => void;
  onUploadSelected: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function FileToolbar({
  path,
  loading,
  uploading,
  fileInputRef,
  onPathChange,
  onPathSubmit,
  onRefresh,
  onCreateDirectory,
  onUploadClick,
  onCreateFile,
  onUploadSelected,
}: FileToolbarProps) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Input
        value={path}
        onChange={(event) => onPathChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onPathSubmit();
        }}
        className="min-w-[200px] flex-1"
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
    </div>
  );
}
