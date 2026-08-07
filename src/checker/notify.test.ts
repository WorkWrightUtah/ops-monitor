import assert from "node:assert/strict";
import { test } from "node:test";

import { bodyFor, reason, subjectFor } from "./notify";
import { isHealthyStatus } from "./http-check";

// The alert rules decide *whether* to speak; these decide *what gets said*.
// A wrong message is a silent failure — nothing throws, the send succeeds, and
// somebody is woken up by a notice that doesn't tell them which site is down
// or why. Worth pinning.

const TARGET = {
  id: "t1",
  name: "WorkWright marketing site",
  url: "https://workwright.co",
};

const CHECKED_AT = "2026-08-07T01:15:00.000Z";

test("isHealthyStatus: 2xx and 3xx are up, 4xx and 5xx are down", () => {
  for (const up of [200, 201, 204, 301, 302, 307, 399]) {
    assert.equal(isHealthyStatus(up), true, `${up} should be healthy`);
  }
  for (const down of [400, 401, 403, 404, 429, 500, 502, 503]) {
    assert.equal(isHealthyStatus(down), false, `${down} should be unhealthy`);
  }
});

test("the broken seed target's 404 counts as down", () => {
  // This is the target the whole alert acceptance test rides on. If 404 ever
  // reads as healthy, the test target stops testing anything.
  assert.equal(isHealthyStatus(404), false);
});

test("reason: an HTTP status is reported verbatim", () => {
  assert.equal(
    reason({ status_code: 503, response_ms: 120, ok: false }),
    "HTTP 503",
  );
});

test("reason: a missing status says no response arrived, not 'HTTP null'", () => {
  const text = reason({ status_code: null, response_ms: 10_000, ok: false });
  assert.match(text, /no response/i);
  assert.doesNotMatch(text, /null|undefined|NaN/, "must not leak a JS value");
});

test("reason: a deactivation explains itself", () => {
  const text = reason(null);
  assert.match(text, /switched off/i);
  assert.doesNotMatch(text, /null|undefined/);
});

test("subject lines name the target and its direction", () => {
  assert.equal(subjectFor("down", TARGET), "DOWN: WorkWright marketing site");
  assert.equal(
    subjectFor("recovered", TARGET),
    "Recovered: WorkWright marketing site",
  );
});

test("an outage body carries url, reason, and the no-repeat promise", () => {
  const body = bodyFor(
    "down",
    TARGET,
    { status_code: 500, response_ms: 84, ok: false },
    CHECKED_AT,
  );

  assert.match(body, /https:\/\/workwright\.co/, "must say which URL");
  assert.match(body, /HTTP 500/, "must say why");
  assert.match(body, /two checks in a row/i, "must say why it is alerting now");
  // Someone woken by this needs to know silence afterwards is expected, not a
  // second outage going unreported.
  assert.match(body, /one more message when it comes back/i);
  assert.doesNotMatch(body, /undefined|null|NaN/);
});

test("a recovery body says it is back and reports the successful status", () => {
  const body = bodyFor(
    "recovered",
    TARGET,
    { status_code: 200, response_ms: 91, ok: true },
    CHECKED_AT,
  );

  assert.match(body, /responding again/i);
  assert.match(body, /HTTP 200/);
  assert.match(body, /91 ms/);
  assert.doesNotMatch(body, /undefined|null|NaN/);
});

test("a deactivation recovery does not invent a status line", () => {
  // There is no check result, so there is no status or timing to report.
  // Claiming one would be fabricating data.
  const body = bodyFor("recovered", TARGET, null, CHECKED_AT);

  assert.match(body, /switched off while an alert was open/i);
  assert.doesNotMatch(body, /HTTP/, "no status code exists to report");
  assert.doesNotMatch(body, /\bms\b/, "no timing exists to report");
  assert.doesNotMatch(body, /undefined|null|NaN/);
});

test("every message names the target, whatever the shape", () => {
  const cases = [
    bodyFor("down", TARGET, { status_code: 404, response_ms: 12, ok: false }, CHECKED_AT),
    bodyFor("down", TARGET, { status_code: null, response_ms: 10_000, ok: false }, CHECKED_AT),
    bodyFor("recovered", TARGET, { status_code: 200, response_ms: 50, ok: true }, CHECKED_AT),
    bodyFor("recovered", TARGET, null, CHECKED_AT),
  ];

  for (const body of cases) {
    assert.match(body, /WorkWright marketing site/, "must name the target");
    assert.match(body, /https:\/\/workwright\.co/, "must include the URL");
  }
});
