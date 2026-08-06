// The alert contract, as a pure function.
//
// Kept free of network and database calls on purpose: these are the rules the
// whole tool exists for, and they should be readable — and testable — without
// standing up Supabase or waiting five minutes for a cron tick.

/** Consecutive failed checks before we tell anyone. From the spec. */
export const FAILURE_THRESHOLD = 2;

export type AlertAction =
  /** Say nothing. */
  | "none"
  /** Target has just crossed the threshold: send the outage notice. */
  | "alert"
  /** Target was alerting and is now resolved: send the recovery notice. */
  | "recover";

export type AlertInput = {
  /** Whether the target is currently being checked. */
  active: boolean;
  /** Whether an outage notice is outstanding for this target. */
  alerting: boolean;
  /**
   * Recent check outcomes, newest first, including the check just recorded.
   * Only meaningful for active targets; inactive targets have no new checks.
   */
  recentOk: boolean[];
};

/** How many checks at the newest end of the history failed in a row. */
export function consecutiveFailures(recentOk: boolean[]): number {
  let run = 0;
  for (const ok of recentOk) {
    if (ok) break;
    run += 1;
  }
  return run;
}

export function decide({ active, alerting, recentOk }: AlertInput): AlertAction {
  // A target that has been switched off is no longer being watched. If we told
  // someone it was down, we owe them a close-out — otherwise the last thing
  // they heard about it is "down" and nothing ever contradicts that. If we
  // never alerted, switching it off is nobody's business.
  if (!active) {
    return alerting ? "recover" : "none";
  }

  // No history yet (a brand new target whose first check has not landed).
  if (recentOk.length === 0) return "none";

  const latestOk = recentOk[0];

  if (latestOk) {
    // Back up. Recovery notices only go out to targets that actually alerted,
    // so a target that blipped once and recovered stays silent.
    return alerting ? "recover" : "none";
  }

  // Still failing. Alert on crossing the threshold, but only once: `alerting`
  // is what makes one outage produce one alert instead of one every 5 minutes.
  //
  // Note this is >= rather than == threshold. If the checker misses a cycle,
  // or a send failed and left the flag clear, the run length can jump straight
  // past 2 — and an outage nobody was told about is worse than an alert that
  // arrives a cycle late.
  if (!alerting && consecutiveFailures(recentOk) >= FAILURE_THRESHOLD) {
    return "alert";
  }

  return "none";
}
