import {
  buildServerPath,
  buildWebSocketUrl,
  getApiBase,
  getServerId,
  getBearerToken,
} from "./panel";
import { sha256Hex } from "./lib/sha256";

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

export interface AutoRestartStatus {
  enabled: boolean;
  fail_count: number;
  max_failures: number;
  blocked: boolean;
  observing: boolean;
  observing_since?: string | null;
  last_started_at?: string | null;
  last_failure_at?: string | null;
  last_success_at?: string | null;
  block_reason?: string | null;
}

export interface Fs2UploadInitResponse {
  upload_id: string;
  part_size: number;
}

export interface ArchiveTaskView {
  id: string;
  kind: "compress" | "decompress";
  status: "queued" | "running" | "canceling" | "success" | "failed" | "canceled";
  source_items: string[];
  target_path: string;
  created_at: number;
  started_at?: number | null;
  finished_at?: number | null;
  current_item?: string | null;
  items_total: number;
  items_done: number;
  bytes_total: number;
  bytes_done: number;
  message?: string | null;
  can_cancel: boolean;
}

export function formatUploadError(error: unknown): string {
  const raw = String((error as { message?: unknown } | null)?.message ?? error ?? "未知错误");
  if (raw.includes("413") || raw.includes("Request Entity Too Large")) {
    return "上传分片过大，入口网关拒绝了当前请求体大小（HTTP 413）";
  }
  if (raw.includes("Failed to fetch")) {
    return "上传请求未成功送达服务端，常见原因是入口网关限制了分片大小，或错误响应未带跨域头";
  }
  return raw;
}

function unwrapPayload<T>(value: unknown): T {
  if (value && typeof value === "object" && "payload" in value) {
    const payload = (value as { payload?: unknown }).payload;
    return (payload ?? value) as T;
  }
  return value as T;
}

function unwrapRpcPayload<T>(value: unknown): T {
  if (value && typeof value === "object" && "status" in value) {
    const rpc = value as {
      status?: unknown;
      payload?: unknown;
      error?: { message?: unknown } | null;
    };
    if (rpc.status === "error") {
      const message =
        rpc.error && typeof rpc.error === "object" && "message" in rpc.error
          ? String(rpc.error.message || "")
          : "";
      throw new Error(message || "request failed");
    }
  }
  return unwrapPayload<T>(value);
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
  const raw = await response.text();
  let body: ApiEnvelope<T> | T | null = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as ApiEnvelope<T> | T;
    } catch {
      if (!response.ok) {
        throw new Error(raw || `request failed: ${response.status}`);
      }
      throw new Error("response is not valid JSON");
    }
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as ApiEnvelope<T>).message || "")
        : "";
    throw new Error(message || raw || `request failed: ${response.status}`);
  }
  if (body && typeof body === "object" && "code" in body) {
    const envelope = body as ApiEnvelope<T>;
    if (envelope.code !== 0) {
      throw new Error(envelope.message || `request failed: ${response.status}`);
    }
    return envelope.data as T;
  }
  return (body ?? ({} as T)) as T;
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

function toBlob(content: string | Blob | ArrayBuffer | Uint8Array): Blob {
  if (content instanceof Blob) return content;
  if (typeof content === "string") return new Blob([content], { type: "text/plain;charset=utf-8" });
  if (content instanceof Uint8Array) return new Blob([content]);
  return new Blob([content]);
}

export function createGamePanelApi() {
  const authHeader = (authMode: "server" | "admin" = "server") => {
    const token = getBearerToken(authMode);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const toRelativePath = (path: string) => String(path || "").replace(/^\/+/, "");

  const parseFetchError = async (response: Response) => {
    const text = await response.text().catch(() => "");
    try {
      const parsed = JSON.parse(text) as ApiEnvelope<unknown> | { error?: { message?: string } };
      const message =
        typeof parsed === "object" && parsed
          ? "message" in parsed
            ? String(parsed.message || "")
            : String(parsed.error?.message || "")
          : "";
      return message || text || `request failed: ${response.status}`;
    } catch {
      return text || `request failed: ${response.status}`;
    }
  };

  return {
    request,
    getServerMeta<T>() {
      return request<T>(buildServerPath("/meta"));
    },
    async getProcessStatus<T>() {
      const payload = await request<unknown>(buildServerPath("/process/status"));
      return unwrapPayload<T>(payload);
    },
    getAutoRestart<T extends AutoRestartStatus>() {
      return request<T>(buildServerPath("/auto-restart"));
    },
    putAutoRestart<T extends AutoRestartStatus>(body: { enabled: boolean; trigger_now?: boolean }) {
      return request<T>(buildServerPath("/auto-restart"), {
        method: "PUT",
        body: JSON.stringify(body),
      });
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
      return request<unknown>(buildServerPath("/fs/list"), {
        method: "POST",
        body: JSON.stringify({ path }),
      }).then((payload) => unwrapRpcPayload<T>(payload));
    },
    async readFile(path: string) {
      const payload = await request<unknown>(buildServerPath("/fs/read"), {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      const unwrapped = unwrapRpcPayload<{ content_base64: string; size: number }>(payload);
      return { content: decodeBase64(unwrapped.content_base64), size: unwrapped.size };
    },
    async writeFile(path: string, content: string | Blob | ArrayBuffer | Uint8Array) {
      const target = toRelativePath(path);
      const blob = toBlob(content);
      const defaultPartSize = 2 * 1024 * 1024;
      let uploadId = "";
      let committed = false;
      const uploadMode = blob.size === 0 ? "stream" : "multipart";

      try {
        const init = await fetch(`${getApiBase()}${buildServerPath("/fs2/upload/init")}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader("server"),
          },
          body: JSON.stringify({
            path: target,
            size: blob.size,
            mode: uploadMode,
            part_size: defaultPartSize,
          }),
        });
        if (!init.ok) throw new Error(await parseFetchError(init));
        const initJson = (await init.json()) as Fs2UploadInitResponse;
        uploadId = initJson.upload_id;
        const partSize = initJson.part_size || defaultPartSize;

        if (uploadMode === "multipart") {
          for (let offset = 0, partNo = 1; offset < blob.size; offset += partSize, partNo += 1) {
            const chunk = blob.slice(offset, Math.min(offset + partSize, blob.size));
            const partBuffer = await chunk.arrayBuffer();
            const partSha = await sha256Hex(partBuffer);
            const partResp = await fetch(
              `${getApiBase()}${buildServerPath(`/fs2/upload/${uploadId}/parts/${partNo}`)}`,
              {
                method: "PUT",
                headers: {
                  "Content-Type": "application/octet-stream",
                  "X-Part-Sha256": partSha,
                  ...authHeader("server"),
                },
                body: new Uint8Array(partBuffer),
              },
            );
            if (!partResp.ok) throw new Error(await parseFetchError(partResp));
          }
        }

        const commit = await fetch(`${getApiBase()}${buildServerPath(`/fs2/upload/${uploadId}/commit`)}`, {
          method: "POST",
          headers: authHeader("server"),
        });
        if (!commit.ok) throw new Error(await parseFetchError(commit));
        committed = true;
        return { ok: true };
      } finally {
        if (uploadId && !committed) {
          await fetch(`${getApiBase()}${buildServerPath(`/fs2/upload/${uploadId}/abort`)}`, {
            method: "POST",
            headers: authHeader("server"),
          }).catch(() => undefined);
        }
      }
    },
    mkdir(path: string) {
      return request<unknown>(buildServerPath("/fs/mkdir"), {
        method: "POST",
        body: JSON.stringify({ path }),
      }).then((payload) => unwrapRpcPayload(payload));
    },
    rename(from: string, to: string) {
      return request<unknown>(buildServerPath("/fs/rename"), {
        method: "POST",
        body: JSON.stringify({ from, to }),
      }).then((payload) => unwrapRpcPayload(payload));
    },
    copy(from: string, to: string) {
      return request<unknown>(buildServerPath("/fs/copy"), {
        method: "POST",
        body: JSON.stringify({ from, to }),
      }).then((payload) => unwrapRpcPayload(payload));
    },
    delete(path: string, recursive = false) {
      return request<unknown>(buildServerPath("/fs/delete"), {
        method: "POST",
        body: JSON.stringify({ path, recursive }),
      }).then((payload) => unwrapRpcPayload(payload));
    },
    compress(src: string, dst: string) {
      return request<unknown>(buildServerPath("/fs/compress"), {
        method: "POST",
        body: JSON.stringify({ src, dst }),
      }).then((payload) => unwrapRpcPayload(payload));
    },
    decompress(src: string, dst: string) {
      return request<unknown>(buildServerPath("/fs/decompress"), {
        method: "POST",
        body: JSON.stringify({ src, dst }),
      }).then((payload) => unwrapRpcPayload(payload));
    },
    async createCompressTask(root: string, sources: string[], dst: string) {
      const payload = await request<unknown>(buildServerPath("/fs/compress"), {
        method: "POST",
        body: JSON.stringify({ root, sources, dst }),
      });
      return unwrapRpcPayload<ArchiveTaskView>(payload);
    },
    async createDecompressTask(src: string, dst: string) {
      const payload = await request<unknown>(buildServerPath("/fs/decompress"), {
        method: "POST",
        body: JSON.stringify({ src, dst }),
      });
      return unwrapRpcPayload<ArchiveTaskView>(payload);
    },
    async listArchiveTasks() {
      const payload = await request<unknown>(buildServerPath("/fs/tasks"));
      return unwrapRpcPayload<{ items: ArchiveTaskView[] }>(payload);
    },
    async cancelArchiveTask(taskId: string) {
      const payload = await request<unknown>(buildServerPath(`/fs/tasks/${taskId}/cancel`), {
        method: "POST",
      });
      return unwrapRpcPayload<ArchiveTaskView>(payload);
    },
    openArchiveTaskSocket(
      onMessage: (payload: { items: ArchiveTaskView[] }) => void,
      onError?: (message: string) => void,
    ) {
      if (typeof window === "undefined") return null;
      const socket = new WebSocket(buildWebSocketUrl(buildServerPath("/ws/fs/tasks")));
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as { items?: ArchiveTaskView[] };
          onMessage({ items: parsed.items || [] });
        } catch (error) {
          onError?.(error instanceof Error ? error.message : "invalid archive task frame");
        }
      };
      socket.onerror = () => {
        onError?.("archive task websocket error");
      };
      return socket;
    },
    async fs2UploadInit(path: string, size: number, opts?: { mode?: "stream" | "multipart"; partSize?: number }) {
      const response = await fetch(`${getApiBase()}${buildServerPath("/fs2/upload/init")}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader("server"),
        },
        body: JSON.stringify({
          path: toRelativePath(path),
          size,
          mode: opts?.mode,
          part_size: opts?.partSize,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseFetchError(response));
      }
      return response.json() as Promise<Fs2UploadInitResponse>;
    },
    async fs2UploadPart(
      uploadId: string,
      partNo: number,
      data: Uint8Array,
      sha256?: string,
      signal?: AbortSignal,
    ) {
      const response = await fetch(`${getApiBase()}${buildServerPath(`/fs2/upload/${uploadId}/parts/${partNo}`)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          ...(sha256 ? { "X-Part-SHA256": sha256 } : {}),
          ...authHeader("server"),
        },
        body: data,
        signal,
      });
      if (!response.ok) {
        throw new Error(await parseFetchError(response));
      }
    },
    async fs2UploadCommit(uploadId: string) {
      const response = await fetch(`${getApiBase()}${buildServerPath(`/fs2/upload/${uploadId}/commit`)}`, {
        method: "POST",
        headers: authHeader("server"),
      });
      if (!response.ok) {
        throw new Error(await parseFetchError(response));
      }
    },
    async fs2UploadAbort(uploadId: string) {
      const response = await fetch(`${getApiBase()}${buildServerPath(`/fs2/upload/${uploadId}/abort`)}`, {
        method: "POST",
        headers: authHeader("server"),
      });
      if (!response.ok) {
        throw new Error(await parseFetchError(response));
      }
    },
    async fs2UploadStatus<T = { bytes_received: number }>(uploadId: string) {
      const response = await fetch(`${getApiBase()}${buildServerPath(`/fs2/upload/${uploadId}/status`)}`, {
        method: "GET",
        headers: authHeader("server"),
      });
      if (!response.ok) {
        throw new Error(await parseFetchError(response));
      }
      return response.json() as Promise<T>;
    },
    getLogSessions<T>(range?: { startNs?: string; endNs?: string }) {
      const params = new URLSearchParams();
      if (range?.startNs) params.set("start", range.startNs);
      if (range?.endNs) params.set("end", range.endNs);
      const suffix = params.size ? `?${params.toString()}` : "";
      return request<T>(`${buildServerPath("/logs/sessions")}${suffix}`);
    },
    async listLogSessions(range?: { startNs?: string; endNs?: string }) {
      const params = new URLSearchParams();
      if (range?.startNs) params.set("start", range.startNs);
      if (range?.endNs) params.set("end", range.endNs);
      const suffix = params.size ? `?${params.toString()}` : "";
      const payload = await request<{ sessions?: LogSessionItem[] } | LogSessionItem[]>(
        `${buildServerPath("/logs/sessions")}${suffix}`,
      );
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
      url.searchParams.set("path", toRelativePath(path));
      if (token) {
        url.searchParams.set("access_token", token);
        url.searchParams.set("token", token);
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
      return request<T>(`/api/admin/instances/${serverId}/recreate`, {
        method: "POST",
        body: JSON.stringify({}),
      }, "admin");
    },
    adminReinstallInstance<T = unknown>() {
      const serverId = getServerId();
      if (!serverId) throw new Error("missing server id");
      return request<T>(`/api/admin/instances/${serverId}/reinstall`, {
        method: "POST",
        body: JSON.stringify({}),
      }, "admin");
    },
  };
}
