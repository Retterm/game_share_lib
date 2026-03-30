import { Button } from "../ui/button";

interface FileSelectionBarProps {
  count: number;
  currentPath: string;
  onDelete: () => void;
  onCopy: (path: string) => void;
  onMove: (path: string) => void;
  onClear: () => void;
}

export function FileSelectionBar({
  count,
  currentPath,
  onDelete,
  onCopy,
  onMove,
  onClear,
}: FileSelectionBarProps) {
  if (count <= 0) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-muted p-2">
      <span className="text-sm">已选择 {count} 项</span>
      <Button variant="destructive" size="sm" onClick={onDelete}>
        删除选中
      </Button>
      <Button variant="outline" size="sm" onClick={() => onCopy(currentPath)}>
        复制到...
      </Button>
      <Button variant="outline" size="sm" onClick={() => onMove(currentPath)}>
        移动到...
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        清空选择
      </Button>
    </div>
  );
}
