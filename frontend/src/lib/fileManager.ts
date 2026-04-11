export type FsEntryLike = {
  name: string;
  is_directory: boolean;
  size: string;
  modified: number;
};

export function joinPath(base: string, name: string) {
  if (!base || base === "/") return `/${name}`;
  return `${base.replace(/\/$/, "")}/${name}`;
}

export function parentDirectory(path: string) {
  return path.split("/").slice(0, -1).join("/") || "/";
}

export function isEditableFile(name: string): boolean {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (!ext) return false;
  return [
    "txt", "md", "log", "json", "yaml", "yml", "toml", "ini", "conf", "cfg", "env", "properties",
    "js", "jsx", "ts", "tsx", "css", "scss", "less", "html", "xml",
    "py", "go", "rs", "java", "php", "sql", "lua", "rb", "cs", "kt", "sh", "bash", "zsh", "ps1", "bat", "cmd",
  ].includes(ext);
}

export function isCompressed(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
}

export function getFileType(entry: Pick<FsEntryLike, "is_directory" | "name">): string {
  if (entry.is_directory) return "目录";
  const parts = entry.name.split(".");
  const ext = (parts.length > 1 ? parts.pop() : "")?.toLowerCase();
  if (!ext) return "文件";
  return `${ext.toUpperCase()}文件`;
}

export function getFileGlyph(entry: Pick<FsEntryLike, "is_directory" | "name">) {
  if (entry.is_directory) return { label: "D", className: "bg-amber-500/15 text-amber-600" };
  const parts = entry.name.split(".");
  const ext = (parts.length > 1 ? parts.pop() : "")?.toLowerCase() || "";
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) return { label: "AR", className: "bg-orange-500/15 text-orange-600" };
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "ico", "avif"].includes(ext)) return { label: "IM", className: "bg-rose-500/15 text-rose-600" };
  if (["mp4", "mkv", "mov", "webm", "avi"].includes(ext)) return { label: "VD", className: "bg-violet-500/15 text-violet-600" };
  if (["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext)) return { label: "AU", className: "bg-emerald-500/15 text-emerald-600" };
  if (["js", "ts", "jsx", "tsx", "c", "cpp", "h", "hpp", "rs", "go", "py", "rb", "php", "java", "cs", "lua", "kt", "swift"].includes(ext)) return { label: "CD", className: "bg-blue-500/15 text-blue-600" };
  if (["sh", "bash", "zsh", "ps1", "bat", "cmd"].includes(ext)) return { label: "SH", className: "bg-cyan-500/15 text-cyan-600" };
  if (["json", "yaml", "yml", "toml", "ini", "conf", "cfg", "env", "properties"].includes(ext)) return { label: "CF", className: "bg-teal-500/15 text-teal-600" };
  if (["sql", "sqlite", "db", "dump"].includes(ext)) return { label: "DB", className: "bg-lime-500/15 text-lime-700" };
  if (["url", "link", "desktop", "lnk"].includes(ext)) return { label: "LK", className: "bg-indigo-500/15 text-indigo-600" };
  if (["txt", "md", "rtf", "log", "pdf", "doc", "docx", "odt", "rtfd"].includes(ext)) return { label: "TX", className: "bg-slate-500/15 text-slate-700" };
  return { label: "F", className: "bg-slate-500/15 text-slate-600" };
}

export function formatFileSize(size?: string): string {
  const n = Number(size);
  if (!Number.isFinite(n) || n < 0) return size || "-";
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (n < kb) return `${n} B`;
  if (n < mb) return `${(n / kb).toFixed(1)} KB`;
  if (n < gb) return `${(n / mb).toFixed(1)} MB`;
  return `${(n / gb).toFixed(1)} GB`;
}

export function formatFileTimestamp(ts?: number) {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}
