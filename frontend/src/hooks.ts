import { useEffect, useMemo, useRef, useState } from "react";

import {
  createGamePanelApi,
  type ConsoleLine,
  type LogSessionItem,
  type MetricsFrame,
} from "./gamePanelApi";

const api = createGamePanelApi();

export function useConsoleStream(initialLimit = 120, maxItems = 300) {
  const [items, setItems] = useState<ConsoleLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latestTsRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getConsoleBacklog<{ items: ConsoleLine[] }>(initialLimit)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        latestTsRef.current = result.items.at(-1)?.ts ?? null;
      })
      .catch((value) => {
        if (!cancelled) {
          setError(value instanceof Error ? value.message : "failed to load console backlog");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialLimit]);

  useEffect(() => {
    const ws = api.openConsoleSocket(
      (line) => {
        latestTsRef.current = line.ts;
        setItems((prev) => [...prev, line].slice(-maxItems));
      },
      latestTsRef.current,
    );
    ws.onerror = () => setError("console websocket error");
    return () => ws.close();
  }, [maxItems]);

  return { items, setItems, error, setError };
}

export function useLogTail(initialLimit = 300, maxItems = 500) {
  const [items, setItems] = useState<ConsoleLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latestTsRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.queryLogs<{ items: ConsoleLine[] }>("", initialLimit)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        latestTsRef.current = result.items.at(-1)?.ts ?? null;
      })
      .catch((value) => {
        if (!cancelled) {
          setError(value instanceof Error ? value.message : "failed to load logs");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialLimit]);

  useEffect(() => {
    const ws = api.openLogsSocket(
      (line) => {
        latestTsRef.current = line.ts;
        setItems((prev) => [...prev, line].slice(-maxItems));
      },
      latestTsRef.current,
    );
    ws.onerror = () => setError("logs websocket error");
    return () => ws.close();
  }, [maxItems]);

  return { items, error, setError };
}

export function useMetricsStream() {
  const [frame, setFrame] = useState<MetricsFrame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getMetrics<MetricsFrame>()
      .then((result) => {
        if (!cancelled) setFrame(result);
      })
      .catch((value) => {
        if (!cancelled) {
          setError(value instanceof Error ? value.message : "failed to load metrics");
        }
      });
    const ws = api.openMetricsSocket((result) => setFrame(result));
    ws.onerror = () => setError("metrics websocket error");
    return () => {
      cancelled = true;
      ws.close();
    };
  }, []);

  return { frame, error, setError };
}

type ProcessStatus = {
  installed?: boolean;
  running?: boolean;
  taskKind?: string | null;
  taskStatus?: string | null;
  launch_command?: string | null;
};

type ServerMeta = {
  public_ip?: string | null;
  ports?: unknown;
  runtime_state?: string | null;
};

export function useMergedError(...errors: Array<string | null | undefined>) {
  return useMemo(() => errors.find(Boolean) ?? null, [errors]);
}

export function useLogSessions() {
  const [items, setItems] = useState<LogSessionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async (range?: { startNs?: string; endNs?: string }) => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.listLogSessions(range));
    } catch (value) {
      setError(value instanceof Error ? value.message : "failed to load log sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return { items, error, loading, refresh };
}

interface HistoricalLogQuery {
  sessionName: string;
  searchText?: string;
  pageStartNs: string;
  rangeStartNs?: string;
  rangeEndNs?: string;
}

export async function loadHistoricalLogs({
  sessionName,
  searchText,
  pageStartNs,
  rangeStartNs,
  rangeEndNs,
}: HistoricalLogQuery) {
  const limit = 800;
  const escaped = api.escapeLokiString(sessionName);
  const trimmed = String(searchText || "").trim();
  const pipe = trimmed ? ` |= "${api.escapeLokiString(trimmed)}"` : "";
  const byName = `{name="${escaped}"}${pipe}`;
  const byTag = `{tag="${escaped}"}${pipe}`;

  let items = await api.queryLogsDetailed({
    q: byName,
    startNs: pageStartNs,
    endNs: rangeEndNs,
    limit,
    direction: "forward",
  });
  if (!items.length) {
    items = await api.queryLogsDetailed({
      q: byTag,
      startNs: pageStartNs,
      endNs: rangeEndNs,
      limit,
      direction: "forward",
    });
  }

  const lastNs = items.length ? items[items.length - 1].tsNs ?? items[items.length - 1].ts * 1_000_000 : null;
  if (!lastNs || !Number.isFinite(Number(lastNs))) {
    return { items, hasNext: false };
  }

  const nextStart = String(Number(lastNs) + 1);
  let probe = await api.queryLogsDetailed({
    q: byName,
    startNs: nextStart,
    endNs: rangeEndNs,
    limit: 1,
    direction: "forward",
  });
  if (!probe.length) {
    probe = await api.queryLogsDetailed({
      q: byTag,
      startNs: nextStart,
      endNs: rangeEndNs,
      limit: 1,
      direction: "forward",
    });
  }

  return { items, hasNext: Boolean(probe.length) };
}

export function useGrafanaPublicDashboard() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(false);
      try {
        const meta = await api.getServerMeta<Record<string, unknown>>();
        const metaUrl =
          typeof meta?.grafana_public_url === "string" ? meta.grafana_public_url.trim() : "";
        if (!cancelled && metaUrl) {
          setUrl(metaUrl);
          setLoading(false);
          return;
        }
      } catch {
        // keep trying ensure endpoint
      }

      try {
        const response = await api.ensureGrafanaPublicDashboard<Record<string, unknown>>();
        const ensuredUrl =
          typeof response?.grafana_public_url === "string"
            ? response.grafana_public_url.trim()
            : "";
        if (!cancelled) {
          setUrl(ensuredUrl);
          setError(!ensuredUrl);
        }
      } catch (value) {
        if (!cancelled) {
          const message = value instanceof Error ? value.message : "";
          if (!message.includes("HTTP 403") && !message.includes("缺少 server_token")) {
            setError(true);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return { url, error, loading, setLoading };
}

export function useRuntimeSummary() {
  const [status, setStatus] = useState<ProcessStatus | null>(null);
  const [serverMeta, setServerMeta] = useState<ServerMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const [nextStatus, nextMeta] = await Promise.all([
        api.getProcessStatus<ProcessStatus>(),
        api.getServerMeta<ServerMeta>().catch(() => null),
      ]);
      setStatus(nextStatus);
      if (nextMeta) setServerMeta(nextMeta);
      return nextStatus;
    } catch (value) {
      const message =
        value instanceof Error ? value.message : "failed to load runtime summary";
      setError(message);
      throw value instanceof Error ? value : new Error(message);
    }
  };

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 10000);
    return () => window.clearInterval(interval);
  }, []);

  return { status, serverMeta, error, setError, refresh: load };
}

export function formatBytes(value?: number) {
  if (!value) return "0 B";
  if (value > 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MiB`;
  if (value > 1024) return `${(value / 1024).toFixed(2)} KiB`;
  return `${value} B`;
}
