import {
  buildServerPath,
  buildWebSocketUrl,
  getApiBase,
  getServerId,
  getBearerToken,
} from "./panel";

type ApiEnvelope<T> = {
  code: number;
  message: string;
  data?: T;
};

export interface ConsoleLine {
  ts: number;
  stream: string;
  text: string;
}

export interface LogSessionItem {
  name: string;
  type: "install" | "run" | string;
}

export interface MetricsSnapshot {
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  netRxBytesTotal: number;
  netTxBytesTotal: number;
  diskUsedBytes: number;
}

export interface MetricsFrame {
  metrics: MetricsSnapshot;
  ts: number;
}

type LokiRangeResponse = {
  status?: string;
  data?: {
    result?: Array<{
      values?: Array<[string, string]>;
      stream?: Record<string, string>;
    }>;
  };
};

async function request<T>(
  path: string,
  init?: RequestInit,
  authMode: "server" | "admin" = "server",
): Promise<T> {
  const token = getBearerToken(authMode);
  const response = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json()) as ApiEnvelope<T> | T;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as ApiEnvelope<T>).message || "")
        : "";
    throw new Error(message || `request failed: ${response.status}`);
  }
  if (body && typeof body === "object" && "code" in body) {
    const envelope = body as ApiEnvelope<T>;
    if (envelope.code !== 0) {
      throw new Error(envelope.message || `request failed: ${response.status}`);
    }
    return envelope.data as T;
  }
  return body as T;
}

function decodeBase64(value?: string | null): string {
  if (!value) return "";
  if (typeof window !== "undefined" && typeof window.atob === "function") {
    return decodeURIComponent(
      Array.from(window.atob(value))
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
  }
  return value;
}

function escapeLokiString(value: string): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function encodeBase64(value: string | Blob | ArrayBuffer | Uint8Array): Promise<string> {
  if (typeof value === "string") {
    if (typeof window !== "undefined" && typeof window.btoa === "function") {
      return window.btoa(unescape(encodeURIComponent(value)));
    }
    return value;
  }
  if (value instanceof Blob) {
    return encodeBase64(await value.arrayBuffer());
  }
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(binary);
  }
  return binary;
}

export function createGamePanelApi() {
  return {
    request,
    getServerMeta<T>() {
      return request<T>(buildServerPath("/meta"));
    },
    getProcessStatus<T>() {
      return request<T>(buildServerPath("/process/status"));
    },
    getConfig<T>() {
      return request<T>(buildServerPath("/config"));
    },
    getSettingsPreview<T>() {
      return request<T>(buildServerPath("/settings/preview"));
    },
    listRegions<T>() {
      return request<T>(buildServerPath("/regions"));
    },
    deploy<T>(body: { region_id?: string; node_id?: string; package_uuid?: string }) {
      return request<T>(buildServerPath("/deploy"), {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    getMetrics<T extends MetricsFrame>() {
      return request<T>(buildServerPath("/metrics"));
    },
    getDiskUsage<T>() {
      return request<T>(buildServerPath("/disk"));
    },
    getConsoleBacklog<T>(limit = 100) {
      return request<T>(`${buildServerPath("/console/recent")}?limit=${limit}`);
    },
    executeConsole(command: string) {
      return request(buildServerPath("/console/execute"), {
        method: "POST",
        body: JSON.stringify({ command }),
      });
    },
    lifecycle(action: "install" | "reinstall" | "start" | "stop" | "restart" | "kill") {
      return request(buildServerPath(`/lifecycle/${action}`), {
        method: "POST",
      });
    },
    listFiles<T>(path = "") {
      return request<T>(buildServerPath("/fs/list"), {
        method: "POST",
        body: JSON.stringify({ path }),
      });
    },
    async readFile(path: string) {
      const payload = await request<{ content_base64: string; size: number }>(buildServerPath("/fs/read"), {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      return { content: decodeBase64(payload.content_base64), size: payload.size };
    },
    async writeFile(path: string, content: string | Blob | ArrayBuffer | Uint8Array) {
      const content_base64 = await encodeBase64(content);
      return request(buildServerPath("/fs/write"), {
        method: "POST",
        body: JSON.stringify({ path, content_base64 }),
      });
    },
    mkdir(path: string) {
      return request(buildServerPath("/fs/mkdir"), {
        method: "POST",
        body: JSON.stringify({ path }),
      });
    },
    rename(from: string, to: string) {
      return request(buildServerPath("/fs/rename"), {
        method: "POST",
        body: JSON.stringify({ from, to }),
      });
    },
    copy(from: string, to: string) {
      return request(buildServerPath("/fs/copy"), {
        method: "POST",
        body: JSON.stringify({ from, to }),
      });
    },
    delete(path: string, recursive = false) {
      return request(buildServerPath("/fs/delete"), {
        method: "POST",
        body: JSON.stringify({ path, recursive }),
      });
    },
    compress(src: string, dst: string) {
      return request(buildServerPath("/fs/compress"), {
        method: "POST",
        body: JSON.stringify({ src, dst }),
      });
    },
    decompress(src: string, dst: string) {
      return request(buildServerPath("/fs/decompress"), {
        method: "POST",
        body: JSON.stringify({ src, dst }),
      });
    },
    getLogSessions<T>() {
      return request<T>(buildServerPath("/logs/sessions"));
    },
    async listLogSessions() {
      const payload = await request<{ sessions?: LogSessionItem[] } | LogSessionItem[]>(buildServerPath("/logs/sessions"));
      if (Array.isArray(payload)) return payload;
      return Array.isArray(payload.sessions) ? payload.sessions : [];
    },
    escapeLokiString,
    async queryLogsDetailed(opts: {
      q: string;
      startNs?: string;
      endNs?: string;
      limit?: number;
      direction?: "forward" | "backward";
    }) {
      const params = new URLSearchParams({ q: opts.q });
      if (opts.startNs) params.set("start", String(opts.startNs));
      if (opts.endNs) params.set("end", String(opts.endNs));
      if (opts.limit) params.set("limit", String(opts.limit));
      if (opts.direction) params.set("direction", opts.direction);
      const payload = await request<LokiRangeResponse>(`${buildServerPath("/logs")}?${params.toString()}`);
      const items: Array<{ ts: number; tsNs?: number; text: string; stream?: string }> = [];
      for (const stream of payload.data?.result || []) {
        const tag = stream.stream?.stream || stream.stream?.tag || stream.stream?.level;
        for (const tuple of stream.values || []) {
          const tsNs = Number(tuple[0]);
          items.push({
            ts: Number.isFinite(tsNs) ? Math.floor(tsNs / 1_000_000) : Date.now(),
            tsNs: Number.isFinite(tsNs) ? tsNs : undefined,
            text: tuple[1] || "",
            stream: tag,
          });
        }
      }
      items.sort((left, right) => {
        const leftNs =
          typeof left.tsNs === "number" && Number.isFinite(left.tsNs)
            ? left.tsNs
            : left.ts * 1_000_000;
        const rightNs =
          typeof right.tsNs === "number" && Number.isFinite(right.tsNs)
            ? right.tsNs
            : right.ts * 1_000_000;
        return leftNs - rightNs;
      });
      return items;
    },
    queryLogs<T>(queryString = "", limit = 300) {
      const params = new URLSearchParams();
      if (queryString) params.set("query", queryString);
      params.set("limit", String(limit));
      return request<T | LokiRangeResponse>(`${buildServerPath("/logs")}?${params.toString()}`).then((payload) => {
        if (payload && typeof payload === "object" && "data" in payload) {
          const loki = payload as LokiRangeResponse;
          const items: ConsoleLine[] = [];
          for (const stream of loki.data?.result || []) {
            const streamName = stream.stream?.stream || stream.stream?.source || "stdout";
            for (const tuple of stream.values || []) {
              const tsNs = Number(tuple[0]);
              items.push({
                ts: Number.isFinite(tsNs) ? Math.floor(tsNs / 1_000_000) : Date.now(),
                stream: streamName,
                text: tuple[1] || "",
              });
            }
          }
          return { items } as T;
        }
        return payload as T;
      });
    },
    ensureGrafanaPublicDashboard<T>() {
      return request<T>(buildServerPath("/grafana/public"), {
        method: "POST",
      }, "server");
    },
    openConsoleSocket(onLine: (line: ConsoleLine) => void, since?: number | null) {
      const ws = new WebSocket(
        buildWebSocketUrl(buildServerPath("/ws/console"), {
          since: since ?? undefined,
        }, "server"),
      );
      ws.onmessage = (event) => {
        onLine(JSON.parse(String(event.data)) as ConsoleLine);
      };
      return ws;
    },
    openLogsSocket(onLine: (line: ConsoleLine) => void, since?: number | null) {
      const ws = new WebSocket(
        buildWebSocketUrl(buildServerPath("/logs/tail"), {
          since: since ?? undefined,
        }, "server"),
      );
      ws.onmessage = (event) => {
        onLine(JSON.parse(String(event.data)) as ConsoleLine);
      };
      return ws;
    },
    openMetricsSocket(onFrame: (frame: MetricsFrame) => void) {
      const ws = new WebSocket(buildWebSocketUrl(buildServerPath("/ws/metrics"), undefined, "server"));
      ws.onmessage = (event) => {
        const payload = JSON.parse(String(event.data)) as MetricsFrame;
        onFrame(payload);
      };
      return ws;
    },
    openInstallSocket(onFrame: (frame: unknown) => void) {
      const ws = new WebSocket(buildWebSocketUrl(buildServerPath("/ws/install"), undefined, "server"));
      ws.onmessage = (event) => {
        onFrame(JSON.parse(String(event.data)));
      };
      return ws;
    },
    downloadUrl(path: string) {
      const base = getApiBase();
      const token = getBearerToken("server");
      const url = new URL(`${base}${buildServerPath("/fs2/download")}`);
      url.searchParams.set("path", path);
      if (token) {
        url.searchParams.set("access_token", token);
      }
      return url.toString();
    },
    getManagerConfig<T>() {
      return request<T>("/api/manager/config", undefined, "admin");
    },
    listManagerRules<T>() {
      return request<T>("/api/manager/rules", undefined, "admin");
    },
    createManagerRule<T>(rule: unknown) {
      return request<T>("/api/manager/rules", {
        method: "POST",
        body: JSON.stringify(rule),
      }, "admin");
    },
    updateManagerRule<T>(ruleId: number, rule: unknown) {
      return request<T>(`/api/manager/rules/${ruleId}`, {
        method: "PUT",
        body: JSON.stringify(rule),
      }, "admin");
    },
    listManagerRuleRevisions<T>(ruleId: number) {
      return request<T>(`/api/manager/rules/${ruleId}/revisions`, undefined, "admin");
    },
    rollbackManagerRule<T>(ruleId: number, revisionId: number) {
      return request<T>(`/api/manager/rules/${ruleId}/rollback/${revisionId}`, {
        method: "POST",
      }, "admin");
    },
    listManagerRuleHits<T>() {
      return request<T>("/api/manager/rules/hits", undefined, "admin");
    },
    adminRecreateInstance<T = unknown>() {
      const serverId = getServerId();
      if (!serverId) throw new Error("missing server id");
      return request<T>(`/api/admin/instances/${serverId}/recreate`, { method: "POST" }, "admin");
    },
    adminReinstallInstance<T = unknown>() {
      const serverId = getServerId();
      if (!serverId) throw new Error("missing server id");
      return request<T>(`/api/admin/instances/${serverId}/reinstall`, { method: "POST" }, "admin");
    },
  };
}
