/**
 * Tell the WorkWright Portal that a watched site changed state.
 *
 * The portal keeps `monitors` and `incidents` for hosted client projects, and
 * §8b of its spec asks that downtime be traceable to the support work it
 * generated and the hours that work consumed. It cannot derive any of that from
 * here: this tool's `targets` and `checks` live in a different Supabase project,
 * and the portal deliberately holds no credentials for it. So we tell it.
 *
 * THIS MUST NEVER BE ABLE TO BREAK AN ALERT. The alert email and the Teams
 * notice are what this tool exists for; the incident report is bookkeeping for a
 * different app. Every failure here is caught and logged, the function never
 * throws, and the caller does not check its result. A portal that is redeploying
 * must not turn into a missed page.
 *
 * INERT WITHOUT CONFIGURATION, and silent about it after the first line. A
 * checker running without the portal variables set is the normal state for
 * anyone testing locally, and warning about it every five minutes would train
 * everyone to ignore the log.
 */
export type IncidentTransition = "down" | "recovered";

/** How long we will wait for the portal before giving up and moving on. */
const TIMEOUT_MS = 5_000;

export async function reportIncident(args: {
  targetId: string;
  targetName: string;
  transition: IncidentTransition;
  /**
   * When the CURRENT state began — the oldest check in the run, not now. The
   * portal records this as the outage's start or end and shows the duration to
   * the client. See `stateBeganAt` in alert-rules.ts.
   */
  since: string;
  statusCode: number | null;
  detail: string | null;
  log: (message: string) => void;
}): Promise<void> {
  const url = process.env.PORTAL_INCIDENT_URL;
  const secret = process.env.PORTAL_INCIDENT_SECRET;

  if (!url || !secret) return;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        targetId: args.targetId,
        targetName: args.targetName,
        transition: args.transition,
        since: args.since,
        statusCode: args.statusCode,
        detail: args.detail,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body = await response.text();

    if (!response.ok) {
      // A 404 here is the portal's way of saying "no secret, or the wrong one" —
      // it answers 404 rather than 401 so an unconfigured endpoint gives nothing
      // away. Worth naming, because the alternative reading is a wrong URL.
      args.log(
        `    portal: HTTP ${response.status}${response.status === 404 ? " (secret missing or mismatched)" : ""} — ${body.slice(0, 200)}`,
      );
      return;
    }

    /*
      `matched: false` means no project in the portal is registered to this
      target. For WorkWright's own sites that is correct and permanent. For a
      hosted client project it means the monitor was never registered and that
      project's downtime is going unrecorded — so it is logged either way and
      read by a person, rather than guessed at here.
    */
    let recorded = "unknown";
    let matched = true;
    try {
      const parsed = JSON.parse(body) as {
        matched?: boolean;
        recorded?: string;
      };
      matched = parsed.matched !== false;
      recorded = parsed.recorded ?? "unknown";
    } catch {
      args.log(`    portal: expected JSON, got ${body.slice(0, 120)}`);
      return;
    }

    args.log(
      matched
        ? `    portal: ${recorded}`
        : `    portal: no project registered for this target`,
    );
  } catch (error) {
    args.log(
      `    portal: report failed — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
