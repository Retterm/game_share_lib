import type { ReactNode } from "react";
import { getPanelLayoutMode, type PanelLayoutMode } from "../../panel";

type AsidePosition = "start" | "end";

interface PanelScaffoldProps {
  header?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  asidePosition?: AsidePosition;
  className?: string;
  bodyClassName?: string;
  mainClassName?: string;
  asideClassName?: string;
  mode?: PanelLayoutMode | "auto";
  scrollY?: boolean;
}

function joinClasses(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

export function PanelScaffold({
  header,
  children,
  aside,
  asidePosition = "end",
  className,
  bodyClassName,
  mainClassName,
  asideClassName,
  mode = "auto",
  scrollY = false,
}: PanelScaffoldProps) {
  const resolvedMode = mode === "auto" ? getPanelLayoutMode() : mode;
  const rootModeClass =
    resolvedMode === "admin"
      ? "h-full max-h-full"
      : resolvedMode === "user"
        ? "flex-1"
        : "h-full";
  const bodyModeClass =
    resolvedMode === "admin"
      ? "h-full max-h-full"
      : resolvedMode === "user"
        ? "flex-1"
        : "h-full";
  const overflowClass =
    scrollY && resolvedMode !== "admin" ? "overflow-x-hidden overflow-y-auto" : "overflow-hidden";
  const main = (
    <div className={joinClasses("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", mainClassName)}>
      {children}
    </div>
  );
  const side = aside ? (
    <div
      className={joinClasses(
        "flex min-h-0 w-full flex-none flex-col overflow-hidden 2xl:w-[380px] 2xl:shrink-0",
        asideClassName,
      )}
    >
      {aside}
    </div>
  ) : null;

  return (
    <div
      className={joinClasses(
        "flex min-h-0 min-w-0 flex-col gap-4",
        rootModeClass,
        overflowClass,
        className,
      )}
    >
      {header ? <div className="shrink-0">{header}</div> : null}
      <div
        className={joinClasses(
          "flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden 2xl:flex-row",
          bodyModeClass,
          bodyClassName,
        )}
      >
        {asidePosition === "start" ? side : null}
        {main}
        {asidePosition === "end" ? side : null}
      </div>
    </div>
  );
}
