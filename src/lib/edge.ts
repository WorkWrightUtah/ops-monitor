/**
 * Which hosting edge answered a request, read from the response headers.
 *
 * Why this exists: on 2026-11-10 every target on Railway got intermittent 429s
 * for half an hour. The refusals came from Railway's edge, not from any one
 * site, and the portal behind it never served a single 429. Each target was
 * judged alone, so the alert said "the staff portal looks down" when the
 * evidence said "Railway is refusing our traffic to everything it hosts".
 *
 * A refusal carries the refuser's fingerprints in its headers. Naming the edge
 * lets the alert group refusals by who issued them, instead of guessing from
 * domain names. Three hostnames on one Railway edge share nothing visible in
 * their URLs.
 *
 * Unverified, and worth knowing: Railway documents the `X-Railway-Edge`
 * response header, but not whether its edge adds it to the 429s it generates
 * itself. The checker logs the edge on every non-up check, so the next
 * refusal settles it. If the header turns out to be missing, this returns null,
 * and shared-refusal grouping falls back to "refused in the same run" without
 * naming a host. That still holds, just more weakly. It never makes a claim it
 * can't back.
 *
 * Pure, so the checker and its tests agree on one rule.
 */

/** Signatures checked in order. The first match wins. */
const SIGNATURES: ReadonlyArray<{ edge: string; match: (h: Headers) => boolean }> = [
  {
    edge: "Railway",
    match: (h) =>
      h.has("x-railway-edge") ||
      h.has("x-railway-request-id") ||
      /railway/i.test(h.get("server") ?? ""),
  },
  // Checked after Railway on purpose. A Railway app behind a Cloudflare proxy
  // carries both. When both are present, Railway answered (Cloudflare just
  // passed the response through), so it is the more specific answer.
  { edge: "Cloudflare", match: (h) => h.has("cf-ray") },
  { edge: "Vercel", match: (h) => h.has("x-vercel-id") },
];

/** The edge that answered, or null when the headers do not say. */
export function edgeOf(headers: Headers): string | null {
  for (const { edge, match } of SIGNATURES) {
    if (match(headers)) return edge;
  }
  return null;
}
