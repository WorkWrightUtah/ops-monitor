import assert from "node:assert/strict";
import { test } from "node:test";

import { isHealthyStatus, isRefusal, outcomeOf } from "./check-outcome";

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
