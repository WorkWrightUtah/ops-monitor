// The address the browser actually used to reach us.
//
// Behind Railway's proxy, `new URL(request.url).origin` inside a route handler
// resolves to the container's own bind address — https://0.0.0.0:8080 — not the
// public hostname. Redirecting to that sends the browser somewhere that cannot
// be reached, which is exactly how a confirmation link kept dying one hop after
// it had already succeeded.
//
// The forwarded headers carry the real host. Middleware gets this right on its
// own via nextUrl; route handlers and server actions do not, so they use this.

type HeaderBag = { get(name: string): string | null };

export function originFromHeaders(headers: HeaderBag): string | undefined {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return undefined;

  // A request through more than one proxy carries a comma-separated list; the
  // first entry is the scheme the browser used.
  const proto = (headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();

  return `${proto}://${host}`;
}
