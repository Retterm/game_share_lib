import type { ArchiveTaskView } from "../../gamePanelApi";
import { testAttrs } from "../../lib/testAttrs";
import { Button } from "../ui/button";

function formatPercent(done: number, total: number) {
  if (!total) return "0%";
  return `${Math.min(100, Math.round((done / total) * 100))}%`;
}

function statusLabel(status: ArchiveTaskView["status"]) {
  switch (status) {
    case "queued":
      return "等待中";
    case "running":
      return "执行中";
    case "canceling":
      return "取消中";
    case "success":
      return "已完成";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    default:
      return status;
  }
}

interface FileArchiveTasksDropdownProps {
  open: boolean;
  tasks: ArchiveTaskView[];
  onRefresh: () => void;
  onCancel: (taskId: string) => void;
}

export function FileArchiveTasksDropdown({
  open,
  tasks,
  onRefresh,
  onCancel,
}: FileArchiveTasksDropdownProps) {
  if (!open) return null;

  return (
    <div
      {...testAttrs("archive-manager-dropdown")}
      className="absolute right-0 top-full z-[380] mt-2 w-[400px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background/95 p-2.5 shadow-2xl backdrop-blur"
    >
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">压缩管理器</div>
          <div className="text-xs text-muted-foreground">{tasks.length} 个任务</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          刷新
        </Button>
      </div>

      <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            当前没有任务
          </div>
        ) : (
          tasks.map((task) => {
            const progressTotal = task.bytes_total > 0 ? task.bytes_total : task.items_total;
            const progressDone = task.bytes_total > 0 ? task.bytes_done : task.items_done;
            return (
              <div
                key={task.id}
                {...testAttrs(`archive-task-${task.id}`)}
                className="rounded-lg border border-border p-2.5"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {task.kind === "compress" ? "压缩" : "解压"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{task.target_path}</div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">{statusLabel(task.status)}</div>
                </div>

                <div className="mb-2 text-xs text-muted-foreground">
                  {task.source_items.join("，")}
                </div>

                <div className="mb-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-orange-500 transition-[width] duration-300"
                    style={{ width: formatPercent(progressDone, progressTotal) }}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>
                    {task.items_done}/{task.items_total || 0}
                  </span>
                  <span>{formatPercent(progressDone, progressTotal)}</span>
                </div>

                {task.current_item ? (
                  <div className="mt-2 truncate text-xs text-muted-foreground">{task.current_item}</div>
                ) : null}
                {task.message ? <div className="mt-2 text-xs text-red-500">{task.message}</div> : null}

                {task.can_cancel ? (
                  <div className="mt-3 flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => onCancel(task.id)}>
                      中断
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
