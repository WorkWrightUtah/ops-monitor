// Relative, not "@/lib/...": this module runs under plain tsx on the checker
// service, not through the Next.js bundler that resolves the alias.
import { type CheckOutcome, isHealthyStatus, outcomeOf } from "../lib/check-outcome";

/** One HTTP GET against one target, shaped like a row of `checks`. */
export type CheckResult = {
  status_code: number | null;
  response_ms: number;
  ok: boolean;
  /** up / down / blocked — see lib/check-outcome.ts. */
  outcome: CheckOutcome;
  /** How many requests it took. 2 means the first attempt failed and we retried. */
  attempts: number;
};

/**
 * How long we wait before calling a target down. Ten seconds is well past the
 * point a healthy site has answered, and well inside the five-minute cadence.
 */
export const TIMEOUT_MS = 10_000;

/**
 * How long to wait before a second attempt.
 *
 * Long enough to outlast a dropped connection or a single unlucky packet,
 * short enough that two attempts plus two timeouts still finish inside the
 * five-minute window with room to spare.
 */
export const RETRY_DELAY_MS = 3_000;

const USER_AGENT =
  "WorkWright-OpsMonitor/1.0 (+https://status.workwright.co; ops@workwright.co)";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt(url: string, timeoutMs: number): Promise<CheckResult> {
  const started = performance.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      // Follow redirects: a site that 301s to its canonical host is up, and
      // recording the redirect rather than the destination would call a
      // healthy site unhealthy.
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      // Identify ourselves. An unlabelled poller hitting a site every five
      // minutes is what a bot filter is built to block.
      //
      // Worth knowing: being honest here is also what gets us blocked, and
      // dressing the checker up as Chrome would probably walk straight past
      // most bot filters. We don't. A monitor that lies about who it is can't
      // be allowlisted by the people whose sites it watches, and the contact
      // details in this string are the whole point.
      headers: { "user-agent": USER_AGENT },
      cache: "no-store",
    });

    const response_ms = Math.round(performance.now() - started);

    // We only need the status line, but an unread body holds the socket open
    // until GC gets to it. Discard it explicitly.
    await response.body?.cancel().catch(() => {});

    return {
      status_code: response.status,
      ok: isHealthyStatus(response.status),
      outcome: outcomeOf(response.status),
      response_ms,
      attempts: 1,
    };
  } catch {
    // DNS failure, connection refused, TLS error, or our own timeout. There is
    // no HTTP status because no HTTP response arrived — status_code stays null
    // rather than becoming a number we invented. The elapsed time is still
    // real and still worth recording.
    return {
      status_code: null,
      ok: false,
      outcome: "down",
      response_ms: Math.round(performance.now() - started),
      attempts: 1,
    };
  }
}

export async function checkUrl(
  url: string,
  timeoutMs: number = TIMEOUT_MS,
  retryDelayMs: number = RETRY_DELAY_MS,
): Promise<CheckResult> {
  const first = await attempt(url, timeoutMs);

  // A single failed request is thin evidence. Networks drop connections, load
  // balancers cycle, and one unlucky moment should not enter the history as a
  // fact — the threshold protects the alert, but nothing protected the record.
  //
  // We retry "down" and not "blocked" on purpose. A site that just refused us
  // will refuse us again, so a retry buys no information; what it does buy is
  // double the request rate against a WAF that already dislikes our traffic,
  // which is how a temporary block becomes a permanent one.
  if (first.outcome !== "down") return first;

  await sleep(retryDelayMs);
  const second = await attempt(url, timeoutMs);

  return { ...second, attempts: 2 };
}
