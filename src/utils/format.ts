export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000) % 24;
  const days = Math.floor(ms / 86_400_000);
  const parts: string[] = [];

  if (days > 0) parts.push(`${days}j`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

export function formatBoolean(value: boolean): string {
  return value ? "oui" : "non";
}

export function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("fr-FR") : "n/a";
}

export function formatRelativeTimestamp(value: string | Date | null): string {
  if (!value) return "n/a";
  const seconds = Math.floor(new Date(value).getTime() / 1000);
  return `<t:${seconds}:R>`;
}
