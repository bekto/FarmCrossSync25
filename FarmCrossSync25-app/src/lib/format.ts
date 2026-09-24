// Small presentation formatters shared by the farm UI.

/** "2m ago" style relative time; falls back to the raw string when unparseable. */
export function relativeTime(at: string | null | undefined): string {
  if (!at) return "never";
  const time = Date.parse(at);
  if (Number.isNaN(time)) return at;
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(time).toLocaleDateString();
}

/** 1536 -> "1.5 KB"; B/KB/MB/GB, clamped at the top unit. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log2(bytes) / 10));
  const value = bytes / 2 ** (index * 10);
  const rounded = index === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[index]}`;
}

/** Up to two leading initials for avatar chips; "?" for empty names. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return "?";
  return words.map((word) => word[0]!.toUpperCase()).join("");
}
