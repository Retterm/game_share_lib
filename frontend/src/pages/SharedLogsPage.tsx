import { useEffect, useMemo, useRef, useState } from "react";

import { PanelScaffold } from "../components/page/PanelScaffold";
import { PanelSurface } from "../components/page/PanelSurface";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { loadHistoricalLogs, useLogSessions } from "../hooks";

export function SharedLogsPage() {
  const [selected, setSelected] = useState("");
  const [pageItems, setPageItems] = useState<
    Array<{ ts: number; tsNs?: number; text: string; stream?: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "input" | "output" | "error">("all");
  const [search, setSearch] = useState("");
  const [showDate, setShowDate] = useState(true);
  const [showTime, setShowTime] = useState(true);
  const [pageStarts, setPageStarts] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const {
    items: sessions,
    error: sessionsError,
    loading: sessionsLoading,
    refresh: refreshSessions,
  } = useLogSessions();

  const selectedHumanTime = useMemo(() => {
    if (!selected) return "";
    const ms = parseUnixMsFromSessionName(selected);
    if (!ms) return "";
    return formatTsNoMs(ms);
  }, [selected]);

  const loadSessions = async () => {
    await refreshSessions();
  };

  const loadPage = async (sessionName: string, startNs: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadHistoricalLogs({
        sessionName,
        searchText: search,
        startNs,
      });
      setPageItems(result.items);
      setHasNext(result.hasNext);
    } catch (e) {
      setError(errorText(e, "加载日志失败"));
      setPageItems([]);
      setHasNext(false);
    } finally {
      setLoading(false);
      if (listRef.current) {
        listRef.current.scrollTop = 0;
      }
    }
  };

  const resetAndLoad = async (sessionName: string) => {
    const startMs =
      parseUnixMsFromSessionName(sessionName) ?? Date.now() - 30 * 24 * 3600 * 1000;
    const startNs = String(startMs * 1_000_000);
    setPageStarts([startNs]);
    setPageIndex(0);
    await loadPage(sessionName, startNs);
  };

  useEffect(() => {
    if (sessionsError) {
      setError(errorText(new Error(sessionsError), "加载日志会话失败"));
    }
  }, [sessionsError]);

  useEffect(() => {
    if (sessions.length && !selected) {
      const first = sessions[0].name;
      setSelected(first);
      setTimeout(() => {
        void resetAndLoad(first);
      }, 0);
    }
  }, [selected, sessions]);

  const items = useMemo(() => {
    const mapped = pageItems.map((item) => ({
      ...item,
      type: classifyLogType(item.stream, item.text),
    }));
    mapped.sort((a, b) => {
      const an =
        typeof a.tsNs === "number" && Number.isFinite(a.tsNs) ? a.tsNs : a.ts * 1_000_000;
      const bn =
        typeof b.tsNs === "number" && Number.isFinite(b.tsNs) ? b.tsNs : b.ts * 1_000_000;
      return an - bn;
    });
    const query = search.trim().toLowerCase();
    return mapped.filter((item) => {
      const byTab = tab === "all" ? true : item.type === tab;
      const bySearch = query ? item.text.toLowerCase().includes(query) : true;
      return byTab && bySearch;
    });
  }, [pageItems, search, tab]);

  return (
    <PanelScaffold
      className="min-h-[420px]"
      asidePosition="start"
      asideClassName="w-full 2xl:w-[calc(18rem+6ch)]"
      scrollY
      aside={
        <Card className="h-full flex flex-col min-h-0">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">日志会话</CardTitle>
            <Button variant="outline" size="sm" onClick={() => void loadSessions()} disabled={sessionsLoading}>
              刷新
            </Button>
          </CardHeader>
          <CardContent className="p-2 flex-1 min-h-0 overflow-auto">
            {sessionsLoading ? (
              <div className="space-y-2 p-1">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-5/6" />
                <Skeleton className="h-6 w-4/6" />
                <Skeleton className="h-6 w-3/6" />
              </div>
            ) : (
              <ul className="space-y-2">
                {sessions.map((session) => (
                  <li key={session.name}>
                    <button
                      className={
                        "group relative w-full text-left rounded-lg border px-3 py-2.5 transition-all " +
                        "bg-white/[0.02] border-white/10 hover:bg-white/[0.05] hover:border-white/25 hover:shadow-sm " +
                        "active:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                        "focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
                        (selected === session.name
                          ? "ring-2 ring-primary/60 border-primary/40 bg-white/[0.06] shadow-sm before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-primary/70 before:rounded-l-lg"
                          : "")
                      }
                      onClick={() => {
                        setSelected(session.name);
                        void resetAndLoad(session.name);
                      }}
                      title={session.name}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={
                            "mt-0.5 inline-flex shrink-0 px-1.5 py-0.5 rounded text-xs border " +
                            (session.type === "install"
                              ? "border-green-500/30 bg-green-500/10 text-green-300"
                              : "border-blue-500/30 bg-blue-500/10 text-blue-300")
                          }
                        >
                          {session.type === "install" ? "安装" : "运行"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm leading-5 break-all line-clamp-2">{session.name}</div>
                          <div className="mt-1 text-[12px] text-gray-300/80 tabular-nums">
                            {(() => {
                              const ms = parseUnixMsFromSessionName(session.name);
                              return ms ? `开始时间 ${formatTsNoMs(ms)}` : "开始时间 —";
                            })()}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
                {!sessions.length ? (
                  <li className="px-2 py-1 text-xs text-muted-foreground">暂无会话</li>
                ) : null}
              </ul>
            )}
          </CardContent>
        </Card>
      }
    >
      <PanelSurface>
        <Card className="h-full flex flex-col border-0 shadow-none">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              日志详情
              {selected ? (
                <span className="ml-2 align-middle text-xs text-muted-foreground">
                  {selected}
                  {selectedHumanTime ? <span className="ml-2">（开始时间 {selectedHumanTime}）</span> : null}
                </span>
              ) : null}
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <Button variant={tab === "all" ? "default" : "outline"} size="sm" onClick={() => setTab("all")}>全部</Button>
                <Button variant={tab === "input" ? "default" : "outline"} size="sm" onClick={() => setTab("input")}>输入</Button>
                <Button variant={tab === "output" ? "default" : "outline"} size="sm" onClick={() => setTab("output")}>输出</Button>
                <Button variant={tab === "error" ? "default" : "outline"} size="sm" onClick={() => setTab("error")}>错误</Button>
              </div>
              <div className="mx-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">显示日期</span>
                <Switch checked={showDate} onCheckedChange={(value) => setShowDate(Boolean(value))} />
                <span className="text-xs text-muted-foreground">显示时间</span>
                <Switch checked={showTime} onCheckedChange={(value) => setShowTime(Boolean(value))} />
              </div>
              <Input className="w-64" placeholder="搜索日志内容..." value={search} onChange={(event) => setSearch(event.target.value)} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selected) void resetAndLoad(selected);
                }}
                disabled={loading || !selected}
              >
                {loading ? "搜索中..." : "搜索/刷新"}
              </Button>
              <div className="ml-2 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!selected || pageIndex <= 0) return;
                    const nextIndex = pageIndex - 1;
                    setPageIndex(nextIndex);
                    void loadPage(selected, pageStarts[nextIndex]);
                  }}
                  disabled={loading || pageIndex <= 0 || !selected}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!selected || !pageItems.length) return;
                    const lastNs =
                      pageItems[pageItems.length - 1].tsNs ??
                      pageItems[pageItems.length - 1].ts * 1_000_000;
                    const nextStart = String(Number(lastNs) + 1);
                    const nextIndex = pageIndex + 1;
                    const nextPageStarts = pageStarts.slice(0, nextIndex);
                    nextPageStarts.push(nextStart);
                    setPageStarts(nextPageStarts);
                    setPageIndex(nextIndex);
                    void loadPage(selected, nextStart);
                  }}
                  disabled={loading || !hasNext || !selected}
                >
                  下一页
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-hidden p-0">
            {error ? (
              <Alert className="mx-4 mt-4" variant="destructive">
                {error}
              </Alert>
            ) : null}
            <div ref={listRef} className="h-full overflow-auto px-4 pb-4">
              <pre className="min-h-full rounded-md border border-border bg-background px-4 py-3 text-xs leading-5 text-slate-100">
                {items.length
                  ? items
                      .map((item) => {
                        const prefix = formatLogPrefix(item.ts, showDate, showTime);
                        return `${prefix}${prefix ? " " : ""}[${item.stream || item.type}] ${item.text}`;
                      })
                      .join("\n")
                  : loading
                    ? "日志加载中..."
                    : "暂无日志"}
              </pre>
            </div>
          </CardContent>
        </Card>
      </PanelSurface>
    </PanelScaffold>
  );
}

function parseUnixMsFromSessionName(sessionName: string) {
  const match = String(sessionName).match(/(\d{13})/);
  if (match) return Number(match[1]);
  return null;
}

function formatTsNoMs(ts: number) {
  const date = new Date(ts);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function formatLogPrefix(ts: number, showDate: boolean, showTime: boolean) {
  if (!showDate && !showTime) return "";
  const date = new Date(ts);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  if (showDate && showTime) return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  if (showDate) return `${yyyy}-${mm}-${dd}`;
  return `${hh}:${mi}:${ss}`;
}

function classifyLogType(stream?: string, text?: string): "input" | "output" | "error" {
  if (stream === "stdin") return "input";
  if (stream === "stderr") return "error";
  const lower = String(text || "").toLowerCase();
  if (lower.includes("error") || lower.includes("fail")) return "error";
  return "output";
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof Error) {
    if (error.message.includes("offline")) return "服务器离线，暂时无法读取日志";
    return error.message || fallback;
  }
  return fallback;
}
