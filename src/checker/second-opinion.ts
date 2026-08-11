// Ask an independent network what it sees.
//
// The checker runs from one Railway container in one datacenter. That vantage
// is enough to notice that something is wrong and nowhere near enough to say
// what — on 2026-08-11 it reported a healthy bike shop down for two hours and
// twenty minutes because that site's CDN had decided it disliked our IP.
//
// This asks a Cloudflare Worker (workers/vantage) for a second reading, from a
// network with no relationship to ours. reconcile() in lib/check-outcome.ts
// decides what the pair of readings means together.

import { outcomeOf, type SecondOpinion } from "../lib/check-outcome";

/**
 * A little longer than the Worker's own 10s fetch timeout, so a target that is
 * merely slow produces a real answer from the Worker rather than a timeout
 * here — those mean different things and we would rather have the real one.
 */
const TIMEOUT_MS = 13_000;

type VantageBody = { status_code?: number | null };

/**
 * Returns "unavailable" for every failure mode, deliberately and without
 * throwing.
 *
 * Not configured, unreachable, rate limited, rejecting our token, returning
 * nonsense — all the same answer, because they all mean the same thing: no new
 * information. A monitoring tool must not be able to fall over because the
 * thing that makes it *better* stopped working.
 */
export async function askSecondVantage(url: string): Promise<SecondOpinion> {
  const endpoint = process.env.VANTAGE_URL;
  const token = process.env.VANTAGE_TOKEN;

  // The normal state until someone finishes the setup in the README, and the
  // monitor works exactly as it did before until they do.
  if (!endpoint || !token) return "unavailable";

  try {
    const response = await fetch(
      `${endpoint}?url=${encodeURIComponent(url)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );

    if (!response.ok) return "unavailable";

    const body = (await response.json()) as VantageBody;

    // `null` is a real answer here — the Worker reached nothing, same as our
    // own no-response case. `undefined` means the body was not what we expect,
    // which is not an answer at all.
    if (body.status_code === undefined) return "unavailable";

    return outcomeOf(body.status_code);
  } catch {
    return "unavailable";
  }
}
