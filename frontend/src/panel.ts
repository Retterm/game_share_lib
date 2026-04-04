export interface SharedPanelProps {
  serverId?: string;
  apiBase?: string;
  serverToken?: string;
  adminToken?: string;
  context?: string;
}

export type PanelLayoutMode = "admin" | "user";

export function getPanelProps(): SharedPanelProps | null {
  if (typeof window === "undefined") return null;
  return ((window as any).__PANEL_PROPS__ as SharedPanelProps) || null;
}

export function getApiBase(): string {
  const props = getPanelProps();
  const explicit = props?.apiBase?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  throw new Error("missing panel apiBase");
}

export function getServerId(): string | undefined {
  return getPanelProps()?.serverId?.trim() || undefined;
}

export function getServerToken(): string | null {
  return getPanelProps()?.serverToken?.trim() || null;
}

export function getAdminToken(): string | null {
  return getPanelProps()?.adminToken?.trim() || null;
}

export function getBearerToken(mode: "server" | "admin" = "server"): string | null {
  if (mode === "admin") {
    return getAdminToken();
  }
  return getServerToken();
}

export function getPanelLayoutMode(): PanelLayoutMode {
  const context = getPanelProps()?.context?.trim().toLowerCase();
  if (context === "admin" || context === "user") {
    return context;
  }
  if (typeof window === "undefined") {
    throw new Error("missing panel context");
  }
  const path = window.location.pathname || "/";
  if (/^\/my\/servers\/view\/[^/]+/.test(path)) return "user";
  if (/^\/servers\/[^/]+/.test(path) || /^\/games\/[^/]+/.test(path)) return "admin";
  throw new Error(`unsupported panel route: ${path}`);
}

export function buildServerPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const serverId = getServerId();
  if (!serverId) return normalized;
  return `/api/servers/${serverId}${normalized}`;
}

export function buildWebSocketUrl(
  path: string,
  search?: Record<string, string | number | null | undefined>,
  tokenMode: "server" | "admin" = "server",
): string {
  const url = new URL(`${getApiBase()}${path}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const token = getBearerToken(tokenMode);
  if (token) {
    url.searchParams.set("access_token", token);
  }
  if (search) {
    for (const [key, value] of Object.entries(search)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}
