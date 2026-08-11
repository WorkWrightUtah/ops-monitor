import type { ReactNode } from "react";
import { ResponseChart, type ChartPoint } from "@/components/response-chart";
import { outcomeOf, type CheckOutcome } from "@/lib/check-outcome";
import {
  formatMs,
  formatRelative,
  formatTimestamp,
  formatUptime,
} from "@/lib/format";

export type TargetStatus = {
  id: string;
  name: string;
  url: string;
  active: boolean;
  alerting: boolean;
  last_checked_at: string | null;
  last_status_code: number | null;
  last_response_ms: number | null;
  last_ok: boolean | null;
  /** The recorded verdict. Null only for rows written before it was stored. */
  last_outcome: CheckOutcome | null;
  uptime_24h: number | null;
  checks_24h: number;
  uptime_7d: number | null;
  checks_7d: number;
};

type State = "up" | "down" | "blocked" | "paused" | "unknown";

function stateOf(target: TargetStatus): State {
  if (!target.active) return "paused";
  if (target.last_ok === null) return "unknown";
  // The recorded verdict, not the status code. A 403 that a second vantage
  // point also received is a real outage, and a tile showing amber "Blocked"
  // beside an email saying DOWN is how a board stops being believed.
  // outcomeOf() only covers rows written before the verdict was stored.
  const outcome = target.last_outcome ?? outcomeOf(target.last_status_code);
  if (outcome === "up") return "up";
  return outcome === "blocked" ? "blocked" : "down";
}

const STATE_COPY: Record<State, { label: string; dot: string; text: string }> = {
  up: { label: "Up", dot: "bg-up", text: "text-up" },
  down: { label: "Down", dot: "bg-down", text: "text-down" },
  // Copper rather than a fourth colour: the palette carries two accents on
  // purpose, and "we couldn't tell" belongs with emphasis, not with alarm.
  blocked: { label: "Blocked", dot: "bg-copper", text: "text-copper" },
  // Not being checked is not the same as being broken, and the board should
  // never imply an inactive target is healthy.
  paused: { label: "Not checked", dot: "bg-muted", text: "text-muted" },
  unknown: { label: "No checks yet", dot: "bg-muted", text: "text-muted" },
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm">{value}</dd>
    </div>
  );
}

export function StatusTile({
  target,
  history,
  action,
}: {
  target: TargetStatus;
  history: ChartPoint[];
  // Rendered under the status pill. A slot rather than a baked-in delete button
  // so this component stays a display component and the page decides who is
  // allowed to see controls.
  action?: ReactNode;
}) {
  const state = stateOf(target);
  const copy = STATE_COPY[state];

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{target.name}</h2>
          <p className="truncate font-mono text-xs text-muted">{target.url}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${copy.dot}`}
              aria-hidden
            />
            <span className={`text-sm font-medium ${copy.text}`}>
              {copy.label}
            </span>
          </div>
          {action}
        </div>
      </header>

      {state === "blocked" ? (
        // Say the whole thing here. The one question this state provokes is
        // "so is my site working or not?", and making someone go and find out
        // for themselves is how the board loses their trust.
        <p className="mt-3 rounded border border-copper/30 bg-copper/10 px-2 py-1 text-xs text-copper">
          This site refused our checker (HTTP {target.last_status_code}) rather
          than failing to answer. Something is there and responding, so it is
          probably serving visitors normally — we just can&rsquo;t confirm it
          from here. Nobody has been alerted.
        </p>
      ) : null}

      {target.alerting ? (
        <p className="mt-3 rounded border border-down/30 bg-down/10 px-2 py-1 text-xs text-down">
          Alert sent — waiting on recovery.
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Metric
          label="Last check"
          value={
            target.last_checked_at ? formatRelative(target.last_checked_at) : "—"
          }
        />
        <Metric label="Response" value={formatMs(target.last_response_ms)} />
        <Metric label="24h uptime" value={formatUptime(target.uptime_24h)} />
        <Metric label="7d uptime" value={formatUptime(target.uptime_7d)} />
      </dl>

      <ResponseChart points={history} />

      <footer className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted">
        {target.last_checked_at ? (
          <span>Checked {formatTimestamp(target.last_checked_at)} MT</span>
        ) : null}
        {target.last_status_code !== null ? (
          <span>HTTP {target.last_status_code}</span>
        ) : target.last_ok === false ? (
          <span>No response</span>
        ) : null}
        <span>
          {target.checks_24h} check{target.checks_24h === 1 ? "" : "s"} in 24h
        </span>
      </footer>
    </section>
  );
}
