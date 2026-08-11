import { outcomeOf } from "@/lib/check-outcome";
import { formatClock } from "@/lib/format";

export type ChartPoint = {
  checked_at: string;
  response_ms: number;
  ok: boolean;
  status_code: number | null;
};

// Plain inline SVG rather than a charting library: one line and a few dots do
// not justify a dependency, and this renders on the server with no client JS.
const WIDTH = 600;
const HEIGHT = 96;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;

export function ResponseChart({ points }: { points: ChartPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="py-4 text-xs text-muted">
        No checks recorded in the last 24 hours.
      </p>
    );
  }

  // A single point has no line to draw, but the reading is still worth showing.
  const times = points.map((p) => new Date(p.checked_at).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeSpan = Math.max(maxTime - minTime, 1);

  const plotted = points.map((p, i) => ({
    p,
    t: times[i],
    outcome: outcomeOf(p.status_code),
  }));

  // A refusal's timing measures how fast we were turned away, not how fast the
  // site serves — they come back in ~50ms, which would drag the line down and
  // make a blocked site look like its best day all week. Keep them off it.
  const measured = plotted.filter(({ outcome }) => outcome !== "blocked");

  const slowest = Math.max(...measured.map(({ p }) => p.response_ms), 1);
  // Head-room above the peak so the busiest point is not welded to the top edge.
  const ceiling = slowest * 1.15;

  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (t: number) => ((t - minTime) / timeSpan) * WIDTH;
  const y = (ms: number) =>
    PAD_TOP + plotHeight - (Math.min(ms, ceiling) / ceiling) * plotHeight;

  const line = measured
    .map(
      ({ p, t }, i) =>
        `${i === 0 ? "M" : "L"}${x(t).toFixed(1)},${y(p.response_ms).toFixed(1)}`,
    )
    .join(" ");

  const failures = plotted.filter(({ outcome }) => outcome === "down");
  const blocked = plotted.filter(({ outcome }) => outcome === "blocked");

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-24 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          `Response time over the last 24 hours. ${points.length} checks, ` +
          `slowest ${slowest} milliseconds, ${failures.length} failed` +
          (blocked.length ? `, ${blocked.length} refused by the site` : "") +
          "."
        }
      >
        {/* Baseline, so an empty-looking chart still reads as a chart. */}
        <line
          x1={0}
          y1={PAD_TOP + plotHeight}
          x2={WIDTH}
          y2={PAD_TOP + plotHeight}
          stroke="var(--border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        <path
          d={line}
          fill="none"
          stroke="var(--copper)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Checks the site refused. Grey, not red: this chart sits directly
            under a tile saying "probably fine, we just can't confirm it", and
            a row of red dots would argue with it. Drawn on the baseline
            because there is no response time to plot — nothing was served. */}
        {blocked.map(({ p, t }) => (
          <circle
            key={p.checked_at}
            cx={x(t)}
            cy={PAD_TOP + plotHeight}
            r={2}
            fill="var(--muted)"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Failed checks called out individually — an outage is the one thing
            on this chart nobody should have to squint for. */}
        {failures.map(({ p, t }) => (
          <circle
            key={p.checked_at}
            cx={x(t)}
            cy={y(p.response_ms)}
            r={2.5}
            fill="var(--down)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <figcaption className="mt-1 flex justify-between font-mono text-[11px] text-muted">
        <span>{formatClock(points[0].checked_at)}</span>
        <span>peak {slowest} ms</span>
        <span>{formatClock(points[points.length - 1].checked_at)}</span>
      </figcaption>
    </figure>
  );
}
