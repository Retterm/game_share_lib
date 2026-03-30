import type { ReactNode } from "react";
import { getPanelLayoutMode, type PanelLayoutMode } from "../../panel";

function joinClasses(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

export function PanelSurface({
  children,
  className,
  mode = "auto",
}: {
  children: ReactNode;
  className?: string;
  mode?: PanelLayoutMode | "auto";
}) {
  const resolvedMode = mode === "auto" ? getPanelLayoutMode() : mode;
  return (
    <div
      className={joinClasses(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        resolvedMode === "user" ? "flex-1" : "h-full max-h-full",
        className,
      )}
    >
      {children}
    </div>
  );
}
