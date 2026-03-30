import type { ReactNode } from "react";

import { Alert } from "../ui/alert";

interface AdminServerActionPanelProps {
  title: string;
  description: string;
  serverId?: string;
  deployState: string;
  runtimeState: string;
  installed: string;
  summaryRows: Array<{ label: string; value: string }>;
  detailRows: Array<{ label: string; value: string }>;
  runtimeError?: string | null;
  footer?: ReactNode;
  actions?: ReactNode;
}

export function AdminServerActionPanel({
  title,
  description,
  serverId,
  deployState,
  runtimeState,
  installed,
  summaryRows,
  detailRows,
  runtimeError,
  footer,
  actions,
}: AdminServerActionPanelProps) {
  return (
    <section className="rounded-xl border bg-[hsl(var(--tw-card))] p-4">
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{description}</div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>serverId: {serverId || "-"}</div>
            <div>部署状态: {deployState}</div>
            <div>运行状态: {runtimeState}</div>
            <div>安装: {installed}</div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold">运行摘要</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {summaryRows.map((item) => (
              <div key={item.label} className="rounded-md border px-3 py-2 text-sm">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="mt-1 break-all font-medium">{item.value}</div>
              </div>
            ))}
          </div>
          {runtimeError ? <Alert>{runtimeError}</Alert> : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold">服务器详情</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {detailRows.map((item) => (
              <div key={item.label} className="rounded-md border px-3 py-2 text-sm">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="mt-1 break-all font-medium">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        {actions ? (
          <div className="flex flex-col gap-3">
            <div className="text-sm font-semibold">管理员操作</div>
            {actions}
          </div>
        ) : null}

        {footer ? <div className="flex flex-col gap-3">{footer}</div> : null}
      </div>
    </section>
  );
}
