import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type FileDialogKind =
  | "rename"
  | "copy"
  | "move"
  | "multi-copy"
  | "multi-move"
  | "mkdir"
  | "new-file"
  | "compress"
  | null;

interface FileActionDialogProps {
  open: boolean;
  kind: FileDialogKind;
  value: string;
  selectedCount?: number;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function FileActionDialog({
  open,
  kind,
  value,
  selectedCount = 0,
  onValueChange,
  onSubmit,
  onClose,
}: FileActionDialogProps) {
  if (!kind) return null;

  const title =
    kind === "rename"
      ? "重命名"
      : kind === "copy"
        ? "复制"
        : kind === "move"
          ? "移动"
          : kind === "multi-copy"
            ? "复制到目录"
            : kind === "multi-move"
              ? "移动到目录"
              : kind === "mkdir"
                ? "新建目录"
                : kind === "new-file"
                  ? "新建文件"
                  : "压缩";

  const description =
    kind === "multi-copy" || kind === "multi-move"
      ? `已选择 ${selectedCount} 项`
      : kind === "move"
        ? "请输入完整目标路径"
        : kind === "mkdir"
          ? "输入要创建的目录名"
          : kind === "new-file"
            ? "输入要创建的文件名"
            : kind === "compress"
              ? selectedCount > 0
                ? `已选择 ${selectedCount} 项`
                : "输入压缩文件输出路径"
            : undefined;

  const placeholder =
    kind === "move" || kind === "multi-copy" || kind === "multi-move" || kind === "compress"
      ? "目标路径"
      : kind === "mkdir"
        ? "目录名"
        : kind === "new-file"
          ? "文件名"
          : "";

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <DialogBody>
        <Input
          autoFocus
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
          }}
          placeholder={placeholder}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button onClick={onSubmit}>确定</Button>
      </DialogFooter>
    </Dialog>
  );
}
