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

/**
 * What a second vantage point said, or that we couldn't reach it.
 *
 * "unavailable" is a first-class answer rather than an error: the second
 * opinion is an improvement to lean on, never a dependency to fail on. If the
 * Worker is down, misconfigured, or simply not set up yet, the monitor must
 * carry on doing what it did before.
 */
export type SecondOpinion = CheckOutcome | "unavailable";

/**
 * Combine what we saw with what an independent network saw.
 *
 * This is the whole point of the second vantage: one checker in one datacenter
 * cannot tell "the site is refusing everyone" from "the site is refusing us",
 * and those need opposite responses. Two vantages can, and the answer moves in
 * both directions:
 *
 *   local    second      final     why
 *   ------   ---------   -------   ----------------------------------------
 *   up       (not asked) up        nothing to corroborate
 *   down     up          blocked   the site is fine; our vantage is the
 *                                  problem. Do not page someone over our own
 *                                  network.
 *   down     down|block  down      corroborated. A real outage.
 *   blocked  up          blocked   confirmed: it is us being refused.
 *   blocked  blocked     DOWN      both networks refused. Nobody can reach
 *                                  this site — that is an outage from a
 *                                  visitor's chair, whatever the status code.
 *   blocked  down        down      it is broken for them; the 403 we got is
 *                                  not the interesting part.
 *   *        unavailable local     no new information, so no new conclusion.
 *
 * The `blocked + blocked -> down` row is the one that buys back the coverage
 * we gave up by not paging on refusals at all. It is also the row most likely
 * to be wrong, because Cloudflare's egress is still a datacenter and a filter
 * strict enough to refuse us might refuse it too. Two independent networks
 * both being turned away for FAILURE_THRESHOLD consecutive checks is decent
 * evidence, but it is evidence, not proof — if this ever pages falsely, this
 * row is the first thing to reconsider.
 */
export function reconcile(
  local: CheckOutcome,
  second: SecondOpinion,
): CheckOutcome {
  if (local === "up") return "up";
  if (second === "unavailable") return local;
  if (second === "up") return "blocked";
  if (local === "blocked" && second === "blocked") return "down";
  return "down";
}
