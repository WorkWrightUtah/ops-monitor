// The alert contract, as a pure function.
//
// Kept free of network and database calls on purpose: these are the rules the
// whole tool exists for, and they should be readable — and testable — without
// standing up Supabase or waiting five minutes for a cron tick.

import type { CheckOutcome } from "../lib/check-outcome";

/** Consecutive failed checks before we tell anyone. From the spec. */
export const FAILURE_THRESHOLD = 2;

/**
 * Consecutive good checks before we announce a recovery.
 *
 * Two, not one, and it was one until 2026-08-11. That morning a single good
 * check slipped through a two-hour block, fired "Recovered", and ten minutes
 * later two more refusals fired "DOWN" again. Three emails, none of them true,
 * and the last one arrived looking exactly like a fresh outage.
 *
 * Recovery deserves the same burden of proof as the outage did. Symmetry here
 * is not tidiness — it is what stops the alert channel from flapping.
 */
export const RECOVERY_THRESHOLD = 2;

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
  recent: CheckOutcome[];
};

/** How many entries at the newest end of the history match `want`. */
function leadingRun(recent: CheckOutcome[], want: CheckOutcome): number {
  let run = 0;
  for (const outcome of recent) {
    if (outcome !== want) break;
    run += 1;
  }
  return run;
}

/**
 * How many refusals in a row we will look past before giving up on the history
 * behind them.
 *
 * Checks run every five minutes, so three is about fifteen minutes of not
 * knowing. Beyond that, whatever we saw on the far side is no longer evidence
 * about *now* — the site had a quarter of an hour to change while we weren't
 * being allowed to look.
 */
export const MAX_BLOCKED_GAP = 3;

/**
 * Drop the checks that told us nothing — but do not pretend the gap they leave
 * behind never happened.
 *
 * A refusal is not evidence for either side of the question "is this site
 * serving customers?", so it neither builds toward an alert nor counts as a
 * recovery. The practical effect is that a blocked target holds whatever state
 * it was already in: if it was healthy it stays healthy, and if we had already
 * reported it down, that report stays open until real checks contradict it.
 *
 * The subtlety, learned the hard way an hour after this function was written:
 * simply filtering refusals out welds the two sides of a long block together.
 * On 2026-08-11 that made a check at 11:10 and a check at 10:30 read as two
 * consecutive successes — 2h20m apart, with 28 refusals between them — which
 * satisfied the recovery threshold and sent a notice on the strength of a
 * reading that was two hours stale. Had those two checks been failures instead,
 * the same arithmetic would have paged someone.
 *
 * So a long enough run of refusals stops the walk entirely. Two checks either
 * side of a fifteen-minute blind spot are not consecutive in any sense worth
 * acting on.
 */
function informative(recent: CheckOutcome[]): CheckOutcome[] {
  const known: CheckOutcome[] = [];
  let gap = 0;

  for (const outcome of recent) {
    if (outcome === "blocked") {
      gap += 1;
      // Everything older than this blind spot is out of reach, not merely
      // skipped. Stop rather than continue.
      if (gap > MAX_BLOCKED_GAP) break;
      continue;
    }
    gap = 0;
    known.push(outcome);
  }

  return known;
}

/** How many checks at the newest end of the history failed in a row. */
export function consecutiveFailures(recent: CheckOutcome[]): number {
  return leadingRun(informative(recent), "down");
}

/** How many checks at the newest end of the history succeeded in a row. */
export function consecutiveSuccesses(recent: CheckOutcome[]): number {
  return leadingRun(informative(recent), "up");
}

export function decide({ active, alerting, recent }: AlertInput): AlertAction {
  // A target that has been switched off is no longer being watched. If we told
  // someone it was down, we owe them a close-out — otherwise the last thing
  // they heard about it is "down" and nothing ever contradicts that. If we
  // never alerted, switching it off is nobody's business.
  if (!active) {
    return alerting ? "recover" : "none";
  }

  const known = informative(recent);

  // No history yet (a brand new target whose first check has not landed), or
  // nothing but refusals — in which case we genuinely do not know, and saying
  // nothing is the only honest move.
  if (known.length === 0) return "none";

  if (known[0] === "up") {
    // Recovery notices only go out to targets that actually alerted, so a
    // target that blipped once and recovered stays silent.
    if (!alerting) return "none";
    return consecutiveSuccesses(known) >= RECOVERY_THRESHOLD ? "recover" : "none";
  }

  // Still failing. Alert on crossing the threshold, but only once: `alerting`
  // is what makes one outage produce one alert instead of one every 5 minutes.
  //
  // Note this is >= rather than == threshold. If the checker misses a cycle,
  // or a send failed and left the flag clear, the run length can jump straight
  // past 2 — and an outage nobody was told about is worse than an alert that
  // arrives a cycle late.
  if (!alerting && consecutiveFailures(known) >= FAILURE_THRESHOLD) {
    return "alert";
  }

  return "none";
}
