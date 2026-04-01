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
  const [rangeStartInput, setRangeStartInput] = useState("");
  const [rangeEndInput, setRangeEndInput] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const rangeRef = useRef<{ startNs?: string; endNs?: string }>({});
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

  const rangeError = useMemo(() => validateRangeInputs(rangeStartInput, rangeEndInput), [rangeStartInput, rangeEndInput]);

  const loadSessions = async (range?: { startNs?: string; endNs?: string }) => {
    await refreshSessions(range);
  };

  const loadPage = async (
    sessionName: string,
    pageStartNs: string,
    range?: { startNs?: string; endNs?: string },
  ) => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadHistoricalLogs({
        sessionName,
        searchText: search,
        pageStartNs,
        rangeStartNs: range?.startNs,
        rangeEndNs: range?.endNs,
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

  const resetAndLoad = async (
    sessionName: string,
    range: { startNs?: string; endNs?: string },
  ) => {
    const startNs =
      range.startNs ??
      String((parseUnixMsFromSessionName(sessionName) ?? Date.now() - 30 * 24 * 3600 * 1000) * 1_000_000);
    setPageStarts([startNs]);
    setPageIndex(0);
    await loadPage(sessionName, startNs, range);
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
        void resetAndLoad(first, rangeRef.current);
      }, 0);
    }
  }, [selected, sessions]);

  const executeQuery = async () => {
    if (rangeError) {
      setError(rangeError);
      return;
    }
    const nextRange = buildRangeNs(rangeStartInput, rangeEndInput);
    rangeRef.current = nextRange;
    setError(null);
    await loadSessions(nextRange);
    if (selected) {
      await resetAndLoad(selected, nextRange);
    }
  };

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => session.name.toLowerCase().includes(query));
  }, [sessionSearch, sessions]);

  const searchQuery = search.trim();

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
    const query = searchQuery.toLowerCase();
    return mapped.filter((item) => {
      const byTab = tab === "all" ? true : item.type === tab;
      const bySearch = query ? item.text.toLowerCase().includes(query) : true;
      return byTab && bySearch;
    });
  }, [pageItems, searchQuery, tab]);

  const displayLines = useMemo(
    () =>
      items.map((item) => {
        const prefix = formatLogPrefix(item.ts, showDate, showTime);
        const stream = item.stream || item.type;
        return {
          key: `${item.tsNs ?? item.ts}-${stream}-${item.text}`,
          prefix,
          stream,
          type: item.type,
          text: item.text,
        };
      }),
    [items, showDate, showTime],
  );

  return (
    <PanelScaffold
      className="min-h-[420px]"
      asidePosition="start"
      asideClassName="w-full 2xl:w-[calc(18rem+6ch)]"
      scrollY
      header={
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-[14rem] flex-1 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Session 搜索</div>
              <Input
                placeholder="输入 session 名称"
                value={sessionSearch}
                onChange={(event) => setSessionSearch(event.target.value)}
              />
            </div>
            <div className="min-w-[15rem] flex-1 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">开始时间</div>
              <Input
                type="datetime-local"
                value={rangeStartInput}
                onChange={(event) => {
                  setRangeStartInput(event.target.value);
                }}
              />
            </div>
            <div className="min-w-[15rem] flex-1 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">结束时间</div>
              <Input
                type="datetime-local"
                value={rangeEndInput}
                onChange={(event) => {
                  setRangeEndInput(event.target.value);
                }}
              />
            </div>
            <div className="flex min-h-[78px] items-center self-stretch">
              <Button
                className="h-10 px-5"
                onClick={() => void executeQuery()}
                disabled={sessionsLoading || loading}
              >
                查询
              </Button>
            </div>
          </div>
        </div>
      }
      aside={
        <Card className="h-full flex flex-col min-h-0">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">日志会话</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadSessions(rangeRef.current)}
              disabled={sessionsLoading}
            >
              刷新
            </Button>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-auto p-3">
            {sessionsLoading ? (
              <div className="space-y-3 p-1">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-5/6" />
                <Skeleton className="h-6 w-4/6" />
                <Skeleton className="h-6 w-3/6" />
              </div>
            ) : (
              <ul className="space-y-3">
                {filteredSessions.map((session) => (
                  <li key={session.name}>
                    <button
                      className={
                        "group relative w-full text-left rounded-xl border px-4 py-3 transition-all " +
                        "bg-white/[0.02] border-white/10 hover:bg-white/[0.06] hover:border-white/25 hover:shadow-sm " +
                        "active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                        "focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
                        (selected === session.name
                          ? "ring-2 ring-primary/60 border-primary/40 bg-white/[0.07] shadow-sm before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-primary/70 before:rounded-l-xl"
                          : "")
                      }
                      onClick={() => {
                        setSelected(session.name);
                        void resetAndLoad(session.name, rangeRef.current);
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
                {!filteredSessions.length ? (
                  <li className="px-2 py-1 text-xs text-muted-foreground">暂无会话</li>
                ) : null}
              </ul>
            )}
          </CardContent>
        </Card>
      }
    >
      <PanelSurface>
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-white/10 px-4 pb-4 pt-3">
            <div className="space-y-2">
              <div className="text-base font-semibold text-foreground">日志详情</div>
              {selected ? (
                <div className="border-l border-white/15 pl-3 text-sm text-foreground/90">
                  <div className="break-all">{selected}</div>
                  {selectedHumanTime ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      开始时间 {selectedHumanTime}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
              <div className="flex items-center gap-2">
                <Button variant={tab === "all" ? "default" : "outline"} size="sm" onClick={() => setTab("all")}>全部</Button>
                <Button variant={tab === "input" ? "default" : "outline"} size="sm" onClick={() => setTab("input")}>输入</Button>
                <Button variant={tab === "output" ? "default" : "outline"} size="sm" onClick={() => setTab("output")}>输出</Button>
                <Button variant={tab === "error" ? "default" : "outline"} size="sm" onClick={() => setTab("error")}>错误</Button>
              </div>
              <div className="mx-2 flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-black/10 px-3">
                <span className="text-xs text-muted-foreground">显示日期</span>
                <Switch checked={showDate} onCheckedChange={(value) => setShowDate(Boolean(value))} />
                <span className="text-xs text-muted-foreground">显示时间</span>
                <Switch checked={showTime} onCheckedChange={(value) => setShowTime(Boolean(value))} />
              </div>
              <Input className="h-10 w-64" placeholder="搜索日志内容..." value={search} onChange={(event) => setSearch(event.target.value)} />
              <Button
                variant="outline"
                size="sm"
                className="min-h-10 px-4"
                onClick={() => {
                  if (selected) void resetAndLoad(selected, rangeRef.current);
                }}
                disabled={loading || !selected}
              >
                {loading ? "搜索中..." : "搜索/刷新"}
              </Button>
              <div className="ml-2 flex min-h-10 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!selected || pageIndex <= 0) return;
                    const nextIndex = pageIndex - 1;
                    setPageIndex(nextIndex);
                    void loadPage(selected, pageStarts[nextIndex], rangeRef.current);
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
                    void loadPage(selected, nextStart, rangeRef.current);
                  }}
                  disabled={loading || !hasNext || !selected}
                >
                  下一页
                </Button>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {error ? (
              <Alert className="mx-4 mt-4" variant="destructive">
                {error}
              </Alert>
            ) : null}
            <div ref={listRef} className="h-full overflow-auto px-4 pb-4 pt-3">
              <div className="min-h-full border border-white/10 bg-background/40 text-xs leading-5 text-slate-100">
                {displayLines.length ? (
                  <div className="divide-y divide-white/8">
                    {displayLines.map((line) => (
                      <div key={line.key} className={logLineClassName(line.type)}>
                        <span aria-hidden="true" className={logLineAccentClassName(line.type)} />
                        <div className="flex items-start gap-3 font-mono">
                          {line.prefix ? (
                            <span
                              className={`${prefixWidthClass(showDate, showTime)} shrink-0 cursor-default select-none text-slate-400 group-hover:text-slate-200`}
                            >
                              {line.prefix}
                            </span>
                          ) : null}
                          <span className="w-[10ch] shrink-0 cursor-default select-none text-sky-300/80 group-hover:text-sky-100">
                            [{line.stream}]
                          </span>
                          <span className="min-w-0 flex-1 cursor-text whitespace-pre-wrap break-words text-slate-100/95">
                            {renderHighlightedText(line.text, searchQuery)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-2.5 font-mono whitespace-pre-wrap">
                    {loading ? "日志加载中..." : "暂无日志"}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </PanelSurface>
    </PanelScaffold>
  );
}

function parseUnixMsFromSessionName(sessionName: string) {
  const match = String(sessionName).match(/-(\d{10,13})(?:-|$)/);
  if (!match) return null;
  const raw = match[1];
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (raw.length === 10) return value * 1000;
  if (raw.length === 13) return value;
  return null;
}

function validateRangeInputs(startInput: string, endInput: string) {
  const start = startInput ? new Date(startInput).getTime() : null;
  const end = endInput ? new Date(endInput).getTime() : null;
  if ((startInput && !Number.isFinite(start || NaN)) || (endInput && !Number.isFinite(end || NaN))) {
    return "时间格式无效";
  }
  if (start !== null && end !== null && start > end) {
    return "开始时间不能晚于结束时间";
  }
  return null;
}

function buildRangeNs(startInput: string, endInput: string) {
  const startMs = startInput ? new Date(startInput).getTime() : null;
  const endMs = endInput ? new Date(endInput).getTime() : null;
  return {
    startNs: startMs !== null && Number.isFinite(startMs) ? String(startMs * 1_000_000) : undefined,
    endNs: endMs !== null && Number.isFinite(endMs) ? String(endMs * 1_000_000) : undefined,
  };
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

function prefixWidthClass(showDate: boolean, showTime: boolean) {
  if (showDate && showTime) return "w-[19ch]";
  if (showDate) return "w-[10ch]";
  if (showTime) return "w-[8ch]";
  return "w-0";
}

function logLineClassName(type: "input" | "output" | "error") {
  const tone =
    type === "error"
      ? "bg-red-500/[0.08] text-red-50 border-l border-red-400/15 hover:bg-red-500/28"
      : type === "input"
        ? "hover:bg-amber-400/28"
        : "hover:bg-sky-400/28";
  return "group relative cursor-text px-4 py-3 transition-colors duration-150 " + tone;
}

function logLineAccentClassName(type: "input" | "output" | "error") {
  const color =
    type === "error"
      ? "bg-red-400 opacity-100"
      : type === "input"
        ? "bg-amber-300 opacity-0 group-hover:opacity-100"
        : "bg-sky-300 opacity-0 group-hover:opacity-100";
  return "pointer-events-none absolute left-0 top-[3px] bottom-[3px] w-[3px] rounded-r-full transition-opacity duration-150 " + color;
}

function renderHighlightedText(text: string, query: string) {
  const parts = splitHighlightParts(text, query);
  return parts.map((part, index) =>
    part.match ? (
      <mark
        key={`${part.text}-${index}`}
        className="rounded bg-yellow-300/20 px-1 text-yellow-100"
      >
        {part.text}
      </mark>
    ) : (
      <span key={`${part.text}-${index}`}>{part.text}</span>
    ),
  );
}

function splitHighlightParts(text: string, query: string) {
  if (!query) return [{ text, match: false }];
  const escapedQuery = escapeRegExp(query);
  if (!escapedQuery) return [{ text, match: false }];
  const matcher = new RegExp(`(${escapedQuery})`, "gi");
  return text
    .split(matcher)
    .filter(Boolean)
    .map((part) => ({ text: part, match: part.toLowerCase() === query.toLowerCase() }));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
