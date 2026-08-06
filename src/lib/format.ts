// WorkWright is in Utah. Rendering timestamps in the server's timezone would
// mean a status board that disagrees with the wall clock of everyone reading it.
const TIME_ZONE = "America/Denver";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

export function formatTimestamp(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function formatClock(iso: string): string {
  return clockFormat.format(new Date(iso));
}

/** "4 minutes ago" — the number that actually matters on a status board. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);

  if (seconds < 0) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

/**
 * ISO timestamp N hours in the past, for range queries.
 *
 * Lives here rather than inline in the dashboard because React's purity lint
 * (correctly) refuses to let a component body call Date.now() — a component
 * that returns something different on every render is not safe to re-run or
 * memoize. Reading the clock is a data-fetching concern, so it moves out here.
 */
export function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** Uptime is NULL when a window holds no checks — say so rather than showing 0%. */
export function formatUptime(pct: number | null): string {
  return pct === null ? "—" : `${Number(pct)}%`;
}

export function formatMs(ms: number | null): string {
  return ms === null ? "—" : `${ms} ms`;
}
