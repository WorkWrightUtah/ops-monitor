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

export type SecondOpinionResult = {
  outcome: SecondOpinion;
  /** Why, in words, for the log. Empty when the answer is a real reading. */
  detail: string;
};

/**
 * Returns "unavailable" for every failure mode, deliberately and without
 * throwing.
 *
 * Not configured, unreachable, rate limited, rejecting our token, returning
 * nonsense — all the same *answer*, because they all mean the same thing: no
 * new information. A monitoring tool must not be able to fall over because the
 * thing that makes it *better* stopped working.
 *
 * They are emphatically not the same *diagnosis*, though, and the first
 * version of this collapsed them into one indistinguishable log line. The
 * result: the Worker was live, the token was set, the checker said
 * "unavailable", and nothing on the box could say which of four things was
 * wrong. Silent degradation is the right runtime behaviour and a terrible
 * debugging experience — so the answer stays uniform and the reason comes
 * with it.
 */
export async function askSecondVantage(
  url: string,
): Promise<SecondOpinionResult> {
  const endpoint = process.env.VANTAGE_URL;
  const token = process.env.VANTAGE_TOKEN;

  // The normal state until someone finishes the setup in the README, and the
  // monitor works exactly as it did before until they do.
  if (!endpoint && !token) {
    return { outcome: "unavailable", detail: "not configured" };
  }
  if (!endpoint) {
    return { outcome: "unavailable", detail: "VANTAGE_URL is not set" };
  }
  if (!token) {
    return { outcome: "unavailable", detail: "VANTAGE_TOKEN is not set" };
  }

  try {
    const response = await fetch(
      `${endpoint}?url=${encodeURIComponent(url)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      // 401 is worth naming outright: it is overwhelmingly a copy-paste that
      // picked up a trailing newline, and "unauthorized" alone sends people
      // hunting through Cloudflare's dashboard for a problem that is in a
      // Railway text box.
      const hint =
        response.status === 401
          ? " — VANTAGE_TOKEN does not match the Worker's secret (check for a trailing space or newline)"
          : "";
      return {
        outcome: "unavailable",
        detail: `worker returned HTTP ${response.status}${hint}`,
      };
    }

    const body = (await response.json()) as VantageBody;

    // `null` is a real answer here — the Worker reached nothing, same as our
    // own no-response case. `undefined` means the body was not what we expect,
    // which is not an answer at all.
    if (body.status_code === undefined) {
      return { outcome: "unavailable", detail: "worker sent an unexpected body" };
    }

    return { outcome: outcomeOf(body.status_code), detail: "" };
  } catch (error) {
    return { outcome: "unavailable", detail: `unreachable: ${String(error)}` };
  }
}
