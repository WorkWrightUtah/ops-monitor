// Refusals that happened to several targets at once.
//
// One site refusing us says something about that site. Several sites refusing
// us in the same five-minute run, from behind the same edge, says something
// about the edge. On 2026-11-10 that was the whole story: Railway's edge turned
// away traffic to all three of our Railway-hosted targets for half an hour, and
// the alert blamed one site for it.
//
// This only changes what an alert SAYS. It never stops one going out. A host
// refusing everyone is still an outage from a visitor's chair, and a monitor
// that talks itself out of alerting is worse than one that over-explains. The
// alert rules in alert-rules.ts are untouched.

/** One target's reading from this run, as much as grouping needs. */
export type RunReading = {
  targetId: string;
  name: string;
  /** Our own checker was refused (401/403/429). The second vantage plays no part. */
  refused: boolean;
  /** The edge that answered, from lib/edge.ts; null when unknown. */
  edge: string | null;
};

export type SharedRefusal = {
  /** The edge the refusals have in common, or null when we can't tell. */
  host: string | null;
  /** The other targets refused in this run, by name. Never empty. */
  others: string[];
};

/**
 * Who else was refused alongside `target` in this run, or null if nobody was,
 * or if `target` itself wasn't refused.
 *
 * When the target's edge is known, only refusals from that same edge count,
 * because a Cloudflare 403 on one site and a Railway 429 on another are two
 * separate stories. When it is unknown, any other refusal in the run counts,
 * but no host is named, because we can't say whose it was.
 */
export function sharedRefusal(
  target: RunReading,
  run: readonly RunReading[],
): SharedRefusal | null {
  if (!target.refused) return null;

  const others = run.filter(
    (r) =>
      r.targetId !== target.targetId &&
      r.refused &&
      (target.edge === null || r.edge === target.edge),
  );

  if (others.length === 0) return null;

  return {
    host: target.edge,
    others: others.map((r) => r.name).sort(),
  };
}
