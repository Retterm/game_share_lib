import { FileGlyph } from "./FileGlyph";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  formatFileSize,
  formatFileTimestamp,
  getFileGlyph,
  getFileType,
  isCompressed,
  isEditableFile,
  parentDirectory,
} from "../../lib/fileManager";

type FsEntry = {
  name: string;
  is_directory: boolean;
  size: string;
  modified: number;
  permissions: string;
};

type SortBy = "name" | "size" | "modified" | "type";

interface FileTableProps {
  path: string;
  entries: FsEntry[];
  allEntriesCount: number;
  loading: boolean;
  error: string | null;
  filterType: string;
  selectedFiles: Set<string>;
  onSelectAll: () => void;
  onToggleSelection: (name: string) => void;
  onSort: (column: SortBy) => void;
  onOpen: (entry: FsEntry) => void;
  onEdit: (name: string) => void;
  onRename: (name: string) => void;
  onCopy: (name: string) => void;
  onMove: (name: string) => void;
  onCompress: (name: string) => void;
  onDecompress: (name: string) => void;
  onDelete: (entry: FsEntry) => void;
  onNavigateParent: (path: string) => void;
}

export function FileTable({
  path,
  entries,
  allEntriesCount,
  loading,
  error,
  filterType,
  selectedFiles,
  onSelectAll,
  onToggleSelection,
  onSort,
  onOpen,
  onEdit,
  onRename,
  onCopy,
  onMove,
  onCompress,
  onDecompress,
  onDelete,
  onNavigateParent,
}: FileTableProps) {
  return (
    <div className="min-h-0 flex-1">
      <Card className="flex h-full flex-col">
        <CardHeader className="flex-shrink-0">
          <CardTitle className="text-base">文件列表 {filterType ? `(${entries.length}/${allEntriesCount})` : ""}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto">
          {error ? <div className="mb-2 text-sm text-red-500">{error}</div> : null}
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[hsl(var(--tw-card))]">
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={selectedFiles.size === entries.length && entries.length > 0}
                    onChange={onSelectAll}
                  />
                </th>
                <th className="cursor-pointer py-2 pr-2 hover:bg-muted" onClick={() => onSort("name")}>
                  名称
                </th>
                <th className="cursor-pointer py-2 pr-2 hover:bg-muted" onClick={() => onSort("size")}>
                  大小
                </th>
                <th className="cursor-pointer py-2 pr-2 hover:bg-muted" onClick={() => onSort("modified")}>
                  修改时间
                </th>
                <th className="cursor-pointer py-2 pr-2 hover:bg-muted" onClick={() => onSort("type")}>
                  类型
                </th>
                <th className="py-2 pr-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {path !== "/" ? (
                <tr className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onNavigateParent(parentDirectory(path))}>
                  <td />
                  <td colSpan={5} className="py-2">
                    <span className="text-blue-600 hover:underline">返回上一级</span>
                  </td>
                </tr>
              ) : null}
              {entries.map((entry) => {
                const { label, className } = getFileGlyph(entry);
                return (
                  <tr key={entry.name} className="border-t hover:bg-muted/40">
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(entry.name)}
                        onChange={() => onToggleSelection(entry.name)}
                      />
                    </td>
                    <td className="py-2 pr-2 font-mono text-xs">
                      {entry.is_directory ? (
                        <span className="inline-flex items-center gap-2">
                          <FileGlyph label={label} className={className} />
                          <button className="underline hover:no-underline" onClick={() => onOpen(entry)}>
                            {entry.name}
                          </button>
                        </span>
                      ) : isEditableFile(entry.name) ? (
                        <span className="inline-flex items-center gap-2">
                          <FileGlyph label={label} className={className} />
                          <button className="underline hover:no-underline" onClick={() => onEdit(entry.name)}>
                            {entry.name}
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <FileGlyph label={label} className={className} />
                          <span>{entry.name}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-xs">{entry.is_directory ? "-" : formatFileSize(entry.size)}</td>
                    <td className="py-2 pr-2 text-xs">{formatFileTimestamp(entry.modified)}</td>
                    <td className="py-2 pr-2">{getFileType(entry)}</td>
                    <td className="space-x-1 py-2 pr-2 text-right">
                      {entry.is_directory ? (
                        <Button size="sm" variant="outline" onClick={() => onOpen(entry)}>
                          进入
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => onOpen(entry)}>
                            下载
                          </Button>
                          {isEditableFile(entry.name) ? (
                            <Button size="sm" variant="ghost" onClick={() => onEdit(entry.name)}>
                              编辑
                            </Button>
                          ) : null}
                        </>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => onRename(entry.name)}>
                        重命名
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onCopy(entry.name)}>
                        复制
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onMove(entry.name)}>
                        移动
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onCompress(entry.name)}>
                        压缩
                      </Button>
                      {!entry.is_directory && isCompressed(entry.name) ? (
                        <Button size="sm" variant="ghost" onClick={() => onDecompress(entry.name)}>
                          解压
                        </Button>
                      ) : null}
                      <Button size="sm" variant="destructive" onClick={() => onDelete(entry)}>
                        删除
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!allEntriesCount && !loading ? (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-sm text-muted-foreground">
                    空
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
