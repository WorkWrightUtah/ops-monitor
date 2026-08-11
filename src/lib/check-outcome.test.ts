import assert from "node:assert/strict";
import { test } from "node:test";

import { isHealthyStatus, isRefusal, outcomeOf, reconcile } from "./check-outcome";

test("2xx and 3xx are healthy, everything else is not", () => {
  for (const status of [200, 201, 204, 301, 302, 307, 399]) {
    assert.equal(isHealthyStatus(status), true, `${status} should be healthy`);
  }
  for (const status of [400, 403, 404, 429, 500, 502, 503]) {
    assert.equal(isHealthyStatus(status), false, `${status} should not be healthy`);
  }
});

test("only access decisions and rate limits count as refusals", () => {
  assert.equal(isRefusal(401), true);
  assert.equal(isRefusal(403), true);
  assert.equal(isRefusal(429), true);
  assert.equal(isRefusal(404), false, "a missing page is a real problem");
  assert.equal(isRefusal(503), false, "a broken server is a real problem");
  assert.equal(isRefusal(null), false, "nothing answered at all");
});

test("outcomeOf separates refused from broken", () => {
  assert.equal(outcomeOf(200), "up");
  assert.equal(outcomeOf(301), "up");
  assert.equal(outcomeOf(403), "blocked");
  assert.equal(outcomeOf(429), "blocked");
  assert.equal(outcomeOf(500), "down");
  assert.equal(outcomeOf(502), "down");
});

test("a 404 still counts as down", () => {
  // The spec seeds a deliberately broken route and expects it to alert. If a
  // 404 ever drifted into the refusal list that acceptance test would pass by
  // going silent, which is the opposite of what it checks.
  assert.equal(outcomeOf(404), "down");
});

test("no response at all is down, not blocked", () => {
  // DNS failure, refused connection, TLS error, timeout. Nothing answered, so
  // there is no one to have refused us — this is the real thing.
  assert.equal(outcomeOf(null), "down");
});

test("a healthy check never asks for, or is changed by, a second opinion", () => {
  assert.equal(reconcile("up", "unavailable"), "up");
  assert.equal(reconcile("up", "down"), "up");
});

test("a second vantage seeing the site fine means our vantage is the problem", () => {
  // The false alarm this whole thing exists to prevent: we could not reach it,
  // somebody else could, so nobody gets paged over our own network.
  assert.equal(reconcile("down", "up"), "blocked");
  assert.equal(reconcile("blocked", "up"), "blocked");
});

test("a corroborated failure is a real outage", () => {
  assert.equal(reconcile("down", "down"), "down");
  assert.equal(reconcile("down", "blocked"), "down");
  assert.equal(reconcile("blocked", "down"), "down");
});

test("both networks refused means nobody can reach the site", () => {
  // The row that buys back what we gave up by not paging on refusals. If a
  // WAF rule is broken badly enough to turn away two unrelated networks, it is
  // turning away customers too, whatever the status code says.
  assert.equal(reconcile("blocked", "blocked"), "down");
});

test("an unreachable second vantage changes nothing", () => {
  // The second opinion is an improvement to lean on, never a dependency to
  // fail on. Not configured, rate limited, or broken must all behave as though
  // it was never there — including still reporting a real outage.
  assert.equal(reconcile("down", "unavailable"), "down");
  assert.equal(reconcile("blocked", "unavailable"), "blocked");
});
