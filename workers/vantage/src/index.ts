/**
 * Second vantage point.
 *
 * A Cloudflare Worker that does one thing: fetch a URL and report the status
 * code it got. The checker calls it when its own request to a target fails.
 *
 * Why this exists: on 2026-08-11 Red Rock Bicycle's CDN refused our checker
 * with 403s for two hours and twenty minutes while serving every real visitor
 * normally, and the monitor reported the site down. One checker in one
 * datacenter cannot tell "the site is refusing everyone" from "the site is
 * refusing us" — and those two need opposite responses. Two networks can.
 *
 * Deliberately tiny. It holds no state, reads no database, and knows nothing
 * about targets or alerts; it is a second pair of eyes, not a second checker.
 * Everything it returns is advisory — see reconcile() in
 * src/lib/check-outcome.ts for how the two readings are combined, and note
 * that the checker treats this Worker being unreachable as a normal outcome
 * rather than an error. A monitoring tool must not acquire a dependency that
 * can take it down.
 */

export interface Env {
  /**
   * Shared secret, set with `wrangler secret put`. The checker sends it as a
   * bearer token. Without it this endpoint is an open fetch relay attributable
   * to Ryan's Cloudflare account, which is somebody else's problem waiting to
   * happen — so a missing secret fails closed rather than open.
   */
  VANTAGE_TOKEN?: string;
}

/** Matches the checker's own timeout, so the two readings are comparable. */
const TIMEOUT_MS = 10_000;

/**
 * Identify ourselves, and say plainly that this is the same monitor arriving
 * by a different road. If someone is deciding whether to allowlist the
 * checker, they should not have to work out that these two are related.
 */
const USER_AGENT =
  "WorkWright-OpsMonitor/1.0 (second vantage; +https://status.workwright.co; ops@workwright.co)";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // Nothing here is for a browser, and none of it should be cached or
      // reachable from a page.
      "cache-control": "no-store",
    },
  });
}

/**
 * Compare without leaking the answer through timing.
 *
 * The early length return is fine — the length of a token is not the secret,
 * and a mismatch there means the value could not have been right anyway.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Deliberately not annotated `satisfies ExportedHandler<Env>`: that would pull
// in @cloudflare/workers-types, and every type this file actually uses is a
// web standard already in the project's lib. Skipping the dependency keeps
// this Worker inside the same `npm run build` typecheck as everything else,
// which is worth more than the annotation.
const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return json({ error: "GET only" }, 405);
    }

    // Fail closed. An unconfigured Worker that cheerfully fetches anything is
    // worse than no Worker: the checker degrades gracefully when this is
    // unreachable, so refusing costs us nothing we cannot afford.
    if (!env.VANTAGE_TOKEN) {
      return json({ error: "not configured" }, 503);
    }

    const presented = (request.headers.get("authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    if (!safeEqual(presented, env.VANTAGE_TOKEN)) {
      // No detail. An error that explains itself here is an error that helps
      // somebody guess.
      return json({ error: "unauthorized" }, 401);
    }

    const raw = new URL(request.url).searchParams.get("url");
    if (!raw) return json({ error: "missing url" }, 400);

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return json({ error: "unparseable url" }, 400);
    }

    // http/https only. Without this the token becomes a key to a general
    // purpose fetch relay rather than to a status checker.
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return json({ error: "only http and https" }, 400);
    }

    const started = Date.now();

    try {
      const response = await fetch(target.toString(), {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT },
      });

      // We want the status line, not the page. Dropping the body keeps this
      // well inside the free tier's CPU budget on a large homepage.
      await response.body?.cancel().catch(() => {});

      return json({
        status_code: response.status,
        response_ms: Date.now() - started,
      });
    } catch {
      // Same convention as the checker: no HTTP response arrived, so there is
      // no status code to report and we do not invent one.
      //
      // In practice this branch is rarer than it looks. Cloudflare's fetch
      // synthesises a status for most network-level failures rather than
      // throwing — an unresolvable host comes back as 530, not an exception.
      // That still classifies as "down", so the verdict is right either way,
      // but do not read a shortage of nulls here as the path being untested.
      return json({
        status_code: null,
        response_ms: Date.now() - started,
      });
    }
  },
};

export default handler;
