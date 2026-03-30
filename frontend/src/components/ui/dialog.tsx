import type { PropsWithChildren, ReactNode } from "react";

import { cn } from "../../lib/utils";

interface DialogProps extends PropsWithChildren {
  open: boolean;
  onClose: () => void;
  className?: string;
}

export function Dialog({ open, onClose, className, children }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000]">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          className={cn(
            "w-full max-w-lg rounded-xl border border-border bg-background text-foreground shadow-2xl",
            className,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function DialogHeader({ children }: PropsWithChildren) {
  return <div className="border-b border-border px-6 py-4">{children}</div>;
}

export function DialogTitle({ children }: PropsWithChildren) {
  return <div className="text-lg font-semibold">{children}</div>;
}

export function DialogDescription({ children }: PropsWithChildren) {
  return <div className="mt-1 text-sm text-muted-foreground">{children}</div>;
}

export function DialogBody({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn("px-6 py-4", className)}>{children}</div>;
}

export function DialogFooter({ children }: PropsWithChildren<{ children?: ReactNode }>) {
  return <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">{children}</div>;
}
