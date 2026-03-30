import { Button } from "../ui/button";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

interface FileEditorDialogProps {
  open: boolean;
  path: string;
  content: string;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function FileEditorDialog({
  open,
  path,
  content,
  onContentChange,
  onSave,
  onClose,
}: FileEditorDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-[70vw]">
      <DialogHeader>
        <DialogTitle>编辑：{path}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="flex max-h-[70vh] min-h-[400px] flex-col overflow-hidden rounded-lg border border-border">
          <textarea
            className="h-full min-h-[320px] w-full resize-none bg-transparent p-3 font-mono text-sm outline-none"
            value={content}
            onChange={(event) => onContentChange(event.target.value)}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button onClick={onSave}>保存</Button>
      </DialogFooter>
    </Dialog>
  );
}
