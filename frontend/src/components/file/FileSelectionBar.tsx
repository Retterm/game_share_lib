import { Button } from "../ui/button";
import { testAttrs } from "../../lib/testAttrs";

interface FileSelectionBarProps {
  count: number;
  currentPath: string;
  onCompress: () => void;
  onDelete: () => void;
  onCopy: (path: string) => void;
  onMove: (path: string) => void;
  onClear: () => void;
}

export function FileSelectionBar({
  count,
  currentPath,
  onCompress,
  onDelete,
  onCopy,
  onMove,
  onClear,
}: FileSelectionBarProps) {
  if (count <= 0) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-muted px-2.5 py-2">
      <span className="text-sm">已选择 {count} 项</span>
      <Button {...testAttrs("compress-selected-button")} variant="outline" size="sm" onClick={onCompress}>
        压缩选中
      </Button>
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
