import { useCallback, useEffect, useMemo, useState } from "react";

import { ConsoleInputBar } from "../components/console/ConsoleInputBar";
import { type LogItem, ConsoleLogList } from "../components/console/ConsoleLogList";
import { type ConsoleTab } from "../components/console/ConsoleTabs";
import { PanelScaffold } from "../components/page/PanelScaffold";
import { PanelSurface } from "../components/page/PanelSurface";
import { ConsoleToolbar } from "../components/console/ConsoleToolbar";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { createGamePanelApi } from "../gamePanelApi";
import {
  formatBytes,
  useConsoleStream,
  useMergedError,
  useMetricsStream,
  useRuntimeSummary,
} from "../hooks";
import { statusText } from "../lib/statusText";

const api = createGamePanelApi();
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function SharedConsolePage() {
  const [tab, setTab] = useState<ConsoleTab>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(true);
  const [search, setSearch] = useState("");
  const { items: logs, setItems: setLogs, error: streamError, setError: setStreamError } = useConsoleStream(120, 300);
  const { frame: metricsFrame, error: metricsError } = useMetricsStream();
  const {
    status,
    serverMeta,
    error: statusError,
    setError: setStatusError,
    refresh: loadStatus,
  } = useRuntimeSummary();
  const error = useMergedError(statusError, streamError, metricsError);
  const [autoRestart, setAutoRestart] = useState<import("../gamePanelApi").AutoRestartStatus | null>(null);
  const [autoRestartSaving, setAutoRestartSaving] = useState(false);

  const loadAutoRestart = useCallback(async () => {
    try {
      setAutoRestart(await api.getAutoRestart());
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "unknown error");
    }
  }, [setStatusError]);

  const refreshWithRetry = async (attempts = 4, delayMs = 1500) => {
    let lastError: unknown = null;
    for (let index = 0; index < attempts; index += 1) {
      try {
        await loadStatus();
        await loadAutoRestart();
        return;
      } catch (error) {
        lastError = error;
        if (index < attempts - 1) await sleep(delayMs);
      }
    }
    if (lastError) {
      setStatusError(lastError instanceof Error ? lastError.message : "unknown error");
    }
  };

  useEffect(() => {
    void loadAutoRestart();
  }, [loadAutoRestart]);

  const runLifecycle = async (action: "start" | "stop" | "restart" | "reinstall") => {
    let actionError: string | null = null;
    try {
      setStatusError(null);
      await api.lifecycle(action);
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
      setStatusError(actionError);
    }
    try {
      await refreshWithRetry();
    } catch {
      if (actionError) setStatusError(actionError);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const logItems = useMemo<LogItem[]>(
    () =>
      logs.map((line, index) => ({
        id: `${line.ts}-${index}`,
        type: line.stream === "stderr" ? "error" : line.stream === "stdin" ? "input" : "output",
        level: line.stream === "stderr" ? "error" : "info",
        text: line.text,
        ts: line.ts,
      })),
    [logs],
  );

  const gameAddress = useMemo(() => {
    const ip = serverMeta?.public_ip;
    if (!ip) return "";
    const ports = serverMeta?.ports;
    let port: number | string | undefined;
    if (Array.isArray(ports) && ports.length > 0) {
      port = ports[0] as number | string | undefined;
    } else if (ports && typeof ports === "object") {
      port = (ports as Record<string, unknown>).game as number | string | undefined;
      if (typeof port === "undefined") {
        port = Object.values(ports as Record<string, unknown>)[0] as number | string | undefined;
      }
    }
    return port ? `${ip}:${port}` : ip;
  }, [serverMeta]);

  const isRunning = status?.running;
  const metrics = metricsFrame?.metrics;

  const updateAutoRestart = async (checked: boolean) => {
    setAutoRestartSaving(true);
    try {
      const next = await api.putAutoRestart({
        enabled: checked,
        trigger_now: checked && !isRunning,
      });
      setAutoRestart(next);
      await refreshWithRetry();
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "unknown error");
    } finally {
      setAutoRestartSaving(false);
    }
  };

  return (
    <PanelScaffold
      className="console-scrollbar"
      scrollY
      header={error ? <Alert variant="destructive">{error}</Alert> : null}
      aside={
        <div className="console-scrollbar flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      isRunning ? "bg-green-500" : "bg-gray-400"
                    }`}
                  />
                  <span className="text-sm text-muted-foreground">服务器状态</span>
                  <span className="text-sm">
                    {statusText(status?.running ? "running" : status?.taskStatus || serverMeta?.runtime_state || "stopped")}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isRunning ? (
                  <>
                    <Button variant="destructive" onClick={() => void runLifecycle("stop")}>
                      停止
                    </Button>
                    <Button variant="outline" onClick={() => void runLifecycle("restart")}>
                      重启
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => void runLifecycle("start")}>启动</Button>
                )}
              </div>
              <div className="rounded border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">自动自启</span>
                  <Switch
                    checked={Boolean(autoRestart?.enabled)}
                    disabled={autoRestartSaving}
                    onCheckedChange={(checked) => void updateAutoRestart(checked)}
                  />
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {autoRestart?.blocked
                    ? "已暂停"
                    : autoRestart?.observing
                      ? "启动观察中"
                      : autoRestart?.enabled
                        ? "已开启"
                        : "已关闭"}
                  {" "}
                  {autoRestart ? `${autoRestart.fail_count}/${autoRestart.max_failures}` : "0/5"}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6">
              <div>
                <div className="mb-1 text-sm text-muted-foreground">游戏连接地址</div>
                <div className="select-all rounded-md border bg-background px-3 py-2 font-mono text-sm">
                  {gameAddress || "未分配"}
                </div>
              </div>
              <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-y-2 text-sm">
                <div className="text-muted-foreground">installed</div>
                <div>{String(status?.installed ?? false)}</div>
                <div className="text-muted-foreground">task</div>
                <div>{status?.taskKind || "-"}</div>
                <div className="text-muted-foreground">task_status</div>
                <div>{status?.taskStatus || "-"}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 rounded border p-3 text-sm">
                  <div className="text-xs text-muted-foreground">CPU</div>
                  <div className="text-lg font-semibold">{metrics?.cpuPercent?.toFixed(1) ?? "0.0"}%</div>
                </div>
                <div className="col-span-2 rounded border p-3 text-sm">
                  <div className="text-xs text-muted-foreground">内存</div>
                  <div className="text-lg font-semibold">
                    {formatBytes(metrics?.memUsedBytes)} / {formatBytes(metrics?.memTotalBytes)}
                  </div>
                </div>
                <div className="col-span-2 rounded border p-3 text-sm">
                  <div className="text-xs text-muted-foreground">磁盘占用</div>
                  <div className="text-lg font-semibold">{formatBytes(metrics?.diskUsedBytes)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      }
    >
      <PanelSurface className="min-h-[55vh] sm:min-h-[32rem]">
        <CardHeader className="space-y-2">
          <ConsoleToolbar
            showDate={showDate}
            showTime={showTime}
            autoScroll={autoScroll}
            onToggleDate={setShowDate}
            onToggleTime={setShowTime}
            onToggleAutoScroll={setAutoScroll}
            totalCount={logItems.length}
            visibleCount={logItems.length}
            search={search}
            onSearchChange={setSearch}
            onClear={clearLogs}
            onScrollBottom={() => setAutoScroll(true)}
            tab={tab}
            onTabChange={setTab}
          />
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <ConsoleLogList
            items={logItems}
            filter={tab}
            search={search}
            showDate={showDate}
            showTime={showTime}
            autoScroll={autoScroll}
            className="flex-1 min-h-0"
          />
          <ConsoleInputBar
            onSend={(command) => {
              api.executeConsole(command)
                .then(() => loadStatus())
                .catch((error) => setStreamError(String(error)));
            }}
          />
        </CardContent>
      </PanelSurface>
    </PanelScaffold>
  );
}
