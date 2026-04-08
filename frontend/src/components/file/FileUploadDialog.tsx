import { Button } from "../ui/button";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type UploadItem = {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  uploadedBytes: number;
  startTime: number;
  lastUpdateTime: number;
  error?: string;
};

interface FileUploadDialogProps {
  open: boolean;
  items: UploadItem[];
  uploading: boolean;
  onClose: () => void;
  onStart: () => void;
  onCancel: () => void;
}

function formatSpeed(item: UploadItem): string {
  if (!item.startTime || !item.uploadedBytes) return "0 B/s";
  const seconds = Math.max(1, item.lastUpdateTime - item.startTime) / 1000;
  const bytesPerSecond = item.uploadedBytes / seconds;
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
}

function formatEta(item: UploadItem): string {
  if (!item.startTime || !item.uploadedBytes || !item.file.size) return "—";
  const seconds = Math.max(1, item.lastUpdateTime - item.startTime) / 1000;
  const bytesPerSecond = item.uploadedBytes / seconds;
  if (bytesPerSecond <= 0) return "—";
  const remain = Math.ceil((item.file.size - item.uploadedBytes) / bytesPerSecond);
  if (remain < 60) return `${remain}s`;
  const minutes = Math.floor(remain / 60);
  return `${minutes}m ${remain % 60}s`;
}

export function FileUploadDialog({
  open,
  items,
  uploading,
  onClose,
  onStart,
  onCancel,
}: FileUploadDialogProps) {
  return (
    <Dialog open={open} onClose={uploading ? () => undefined : onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>上传文件</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无待上传文件</div>
        ) : (
          items.map((item) => (
            <div key={`${item.file.name}-${item.file.size}`} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{item.file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.status === "pending" ? "等待上传" : item.status === "uploading" ? "上传中" : item.status === "done" ? "已完成" : item.error || "上传失败"}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{item.progress}%</div>
                  <div>{item.status === "uploading" ? `${formatSpeed(item)} · 剩余 ${formatEta(item)}` : " "}</div>
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full transition-all ${item.status === "error" ? "bg-red-500" : item.status === "done" ? "bg-emerald-500" : "bg-blue-500"}`}
                  style={{ width: `${Math.max(2, item.progress)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </DialogBody>
      <DialogFooter>
        {uploading ? (
          <Button variant="outline" onClick={onCancel}>
            取消上传
          </Button>
        ) : (
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        )}
        <Button onClick={onStart} disabled={uploading || items.length === 0}>
          开始上传
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
