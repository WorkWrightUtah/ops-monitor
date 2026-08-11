/**
 * What one check actually told us.
 *
 * The monitor used to answer a yes/no question — did we get a good response? —
 * and treat every "no" as an outage. That is one distinction short.
 *
 * On 2026-08-11 Red Rock Bicycle's CDN began refusing our checker with 403s
 * while serving every real visitor normally. The checker reported the site down
 * for two hours and twenty minutes. Ryan looked, saw a working bike shop, and
 * stopped trusting the tool — which is the expensive part. A monitor nobody
 * believes is worse than no monitor, because it costs the same and still gets
 * ignored on the day it is right.
 *
 * So there are three answers, not two:
 *
 *   up       we asked and got a good response
 *   down     nothing answered, or what answered was broken
 *   blocked  something answered, and turned us away
 *
 * "blocked" is not a softer "down". It is the absence of information: a 403
 * from an edge network proves that edge is alive and serving, which is nearly
 * the opposite of an outage. A genuinely broken site gives 5xx, or nothing.
 *
 * Shared by the checker and the dashboard so both words mean the same thing.
 * (The dashboard must not import the checker's Supabase client — see CLAUDE.md
 * — but this module is pure, so it is safe on both sides.)
 */

export type CheckOutcome = "up" | "down" | "blocked";

/**
 * Statuses that mean "we were refused", not "the site is broken".
 *
 * 401 and 403 are an access decision — someone chose to say no. 429 is a rate
 * limit, which is a healthy server defending itself and is arguably a sign the
 * site is up rather than down.
 *
 * Deliberately narrow. Every other 4xx stays "down": a 404 on the URL we were
 * told to watch means the page a customer would visit is missing, and the
 * spec's broken-route seed target depends on that still alerting.
 */
export const REFUSAL_STATUSES: readonly number[] = [401, 403, 429];

/**
 * Which HTTP statuses count as healthy.
 *
 * 2xx and 3xx are up. Redirects are followed, so a 3xx here means the final
 * response was itself a redirect — still a server that answered.
 */
export function isHealthyStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

export function isRefusal(status: number | null): boolean {
  return status !== null && REFUSAL_STATUSES.includes(status);
}

/** Classify a recorded check. `null` means no HTTP response arrived at all. */
export function outcomeOf(status: number | null): CheckOutcome {
  if (status === null) return "down";
  if (isHealthyStatus(status)) return "up";
  return isRefusal(status) ? "blocked" : "down";
}
