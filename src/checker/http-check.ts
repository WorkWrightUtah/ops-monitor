/** One HTTP GET against one target, shaped like a row of `checks`. */
export type CheckResult = {
  status_code: number | null;
  response_ms: number;
  ok: boolean;
};

/**
 * How long we wait before calling a target down. Ten seconds is well past the
 * point a healthy site has answered, and well inside the five-minute cadence.
 */
export const TIMEOUT_MS = 10_000;

const USER_AGENT =
  "WorkWright-OpsMonitor/1.0 (+https://status.workwright.co; ops@workwright.co)";

/**
 * Which HTTP statuses count as healthy.
 *
 * 2xx and 3xx are up. Redirects are followed, so a 3xx here means the final
 * response was itself a redirect — still a server that answered. 4xx and 5xx
 * are down, including the 404 the deliberately-broken seed target returns,
 * which is the whole point of that target.
 *
 * Split out from checkUrl so the rule can be tested without a network call.
 */
export function isHealthyStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

export async function checkUrl(
  url: string,
  timeoutMs: number = TIMEOUT_MS,
): Promise<CheckResult> {
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
      response_ms,
    };
  } catch {
    // DNS failure, connection refused, TLS error, or our own timeout. There is
    // no HTTP status because no HTTP response arrived — status_code stays null
    // rather than becoming a number we invented. The elapsed time is still
    // real and still worth recording.
    return {
      status_code: null,
      ok: false,
      response_ms: Math.round(performance.now() - started),
    };
  }
}
