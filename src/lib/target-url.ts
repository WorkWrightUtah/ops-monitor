// Turning what someone typed into a URL the checker can request.
//
// Kept out of the server action and free of Next imports so it can be tested
// directly — this is the code that meets typos, and the database's
// targets_url_is_http constraint is the backstop, not the first line.

export type NormalizedUrl = { value: string } | { error: string };

// The scheme of a raw string, or undefined if it hasn't got one.
//
// The wrinkle is that "workwright.co:8080" and "mailto:ryan" are the same shape
// to a naive regex. A real scheme is either followed by "//", or by something
// that isn't a port number.
function schemeOf(raw: string): string | undefined {
  const match = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(raw);
  if (!match) return undefined;

  const hasSlashes = Boolean(match[2]);
  const rest = raw.slice(match[0].length);
  const looksLikePort = /^\d+(?:[/?#]|$)/.test(rest);

  if (!hasSlashes && looksLikePort) return undefined;
  return match[1].toLowerCase();
}

export function normalizeUrl(raw: string): NormalizedUrl {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "Enter the address you want watched." };

  // Ryan will paste "workwright.co" at least as often as a full URL. Assume
  // https rather than making a missing scheme his problem — but decide whether
  // there is a scheme *before* prepending one. Blindly gluing "https://" onto
  // "mailto:ryan@workwright.co" produces a URL that parses cleanly, with
  // "mailto:ryan" read as credentials and workwright.co as the host. The input
  // is rejected here rather than silently becoming a different address.
  const scheme = schemeOf(trimmed);
  if (scheme && scheme !== "http" && scheme !== "https") {
    return { error: "Only http and https addresses can be checked." };
  }

  const withScheme = scheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: `"${trimmed}" doesn't look like a web address.` };
  }

  // user:pass@host is never needed to GET a health check, and it is the shape
  // that makes "https://workwright.co@evil.com" read as ours at a glance. The
  // dashboard and every alert print this string, so it has to mean what it says.
  if (parsed.username || parsed.password) {
    return { error: "Leave out the username@ part — the checker just makes a plain request." };
  }

  // "https://workwright" parses fine and would fail every check forever.
  if (!parsed.hostname.includes(".")) {
    return { error: `"${parsed.hostname}" isn't a full domain name.` };
  }

  // Keep bare domains tidy: the URL parser turns "https://workwright.co" into
  // ".../" and a stray trailing slash is noise in an alert subject line.
  const value =
    parsed.pathname === "/" && !parsed.search && !parsed.hash
      ? parsed.origin
      : parsed.toString();

  return { value };
}
