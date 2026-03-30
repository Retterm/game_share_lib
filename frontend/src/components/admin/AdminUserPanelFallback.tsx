interface AdminUserPanelFallbackProps {
  title?: string;
  message: string;
  rows: Array<{ label: string; value: string }>;
}

export function AdminUserPanelFallback({
  title = "用户面板暂未加载",
  message,
  rows,
}: AdminUserPanelFallbackProps) {
  return (
    <div className="flex h-full min-h-[360px] items-center justify-center p-6">
      <div className="max-w-2xl rounded-xl border bg-[hsl(var(--tw-card))] p-6 text-sm">
        <div className="text-base font-semibold">{title}</div>
        <div className="mt-2 text-muted-foreground">{message}</div>
        <div className="mt-4 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label}>
              {row.label}: {row.value}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
