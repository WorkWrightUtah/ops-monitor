import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUrl } from "./target-url";

function value(raw: string): string {
  const result = normalizeUrl(raw);
  assert.ok("value" in result, `expected ${raw} to be accepted, got ${JSON.stringify(result)}`);
  return result.value;
}

function error(raw: string): string {
  const result = normalizeUrl(raw);
  assert.ok("error" in result, `expected ${raw} to be rejected, got ${JSON.stringify(result)}`);
  return result.error;
}

test("a bare domain becomes an https URL with no trailing slash", () => {
  assert.equal(value("workwright.co"), "https://workwright.co");
  assert.equal(value("  workwright.co  "), "https://workwright.co");
});

test("an existing scheme is left alone, including plain http", () => {
  assert.equal(value("http://workwright.co"), "http://workwright.co");
  assert.equal(value("https://status.workwright.co"), "https://status.workwright.co");
});

test("paths, queries and ports survive", () => {
  assert.equal(
    value("workwright.co/status/deliberately-broken"),
    "https://workwright.co/status/deliberately-broken",
  );
  assert.equal(value("workwright.co/health?deep=1"), "https://workwright.co/health?deep=1");
  assert.equal(value("workwright.co:8080"), "https://workwright.co:8080");
});

test("hostnames are lowercased, so case alone cannot duplicate a target", () => {
  // The unique index on url is exact-match; this is what makes it sufficient.
  assert.equal(value("WorkWright.CO"), "https://workwright.co");
});

test("a path's case is preserved, because paths are case-sensitive", () => {
  assert.equal(value("workwright.co/Status"), "https://workwright.co/Status");
});

test("empty input is refused with a plain instruction", () => {
  assert.match(error(""), /Enter the address/);
  assert.match(error("   "), /Enter the address/);
});

test("a hostname with no dot is refused rather than watched forever", () => {
  assert.match(error("workwright"), /isn't a full domain name/);
});

test("non-web schemes are refused", () => {
  assert.match(error("mailto:ryan@workwright.co"), /Only http and https/);
  assert.match(error("ftp://workwright.co"), /Only http and https/);
});

test("input that cannot parse at all is refused, not thrown", () => {
  assert.match(error("http://"), /doesn't look like a web address/);
});

// A URL carrying credentials reads as one host and resolves to another. Since
// the dashboard and every alert print this string verbatim, accepting one would
// mean the board could confidently show a site we are not actually checking.
test("credentials in a URL are refused rather than hiding the real host", () => {
  assert.match(error("https://workwright.co@example.com"), /Leave out the username/);
  assert.match(error("https://user:pass@workwright.co"), /Leave out the username/);
});
