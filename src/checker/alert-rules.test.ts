import assert from "node:assert/strict";
import { test } from "node:test";

import type { CheckOutcome } from "../lib/check-outcome";
import { consecutiveFailures, consecutiveSuccesses, decide } from "./alert-rules";

// The spec calls alerting "the feature this tool exists for" and says to test
// it early. These run in milliseconds against the pure rules, so the five
// minute cron loop is never the thing standing between a change and knowing
// whether it broke the contract.
//
// `recent` is newest-first, matching the `order(checked_at desc)` the checker
// reads with.

const up: CheckOutcome = "up";
const down: CheckOutcome = "down";
const blocked: CheckOutcome = "blocked";

/**
 * Walk a target through checks in the order they happened, carrying the
 * alerting flag forward exactly as the database would, and return the notices
 * that went out. Input is oldest-first, because that is how time works;
 * `decide` gets it newest-first, because that is how the query returns it.
 */
function replay(
  outcomes: CheckOutcome[],
  { active = true }: { active?: boolean } = {},
): string[] {
  let alerting = false;
  const sent: string[] = [];
  const history: CheckOutcome[] = [];

  for (const outcome of outcomes) {
    history.unshift(outcome);
    const action = decide({ active, alerting, recent: history.slice(0, 12) });
    if (action === "alert") {
      sent.push("down");
      alerting = true;
    } else if (action === "recover") {
      sent.push("recovered");
      alerting = false;
    }
  }

  return sent;
}

test("consecutiveFailures counts only the unbroken run at the newest end", () => {
  assert.equal(consecutiveFailures([]), 0);
  assert.equal(consecutiveFailures([up, down, down]), 0);
  assert.equal(consecutiveFailures([down, up, down]), 1);
  assert.equal(consecutiveFailures([down, down, up]), 2);
  assert.equal(consecutiveFailures([down, down, down]), 3);
});

test("refusals are skipped when counting runs, not treated as failures", () => {
  // The whole point: a block tells us nothing, so it must not build toward an
  // alert — but it must not break a genuine run of failures either.
  assert.equal(consecutiveFailures([blocked, blocked, blocked]), 0);
  assert.equal(consecutiveFailures([blocked, down, down]), 2);
  assert.equal(consecutiveFailures([down, blocked, down]), 2);
  assert.equal(consecutiveSuccesses([blocked, up, up]), 2);
  assert.equal(consecutiveSuccesses([blocked, up, down]), 1);
});

test("one failed check is not enough to alert", () => {
  assert.equal(
    decide({ active: true, alerting: false, recent: [down, up, up] }),
    "none",
    "a single blip must stay quiet — that is what the threshold is for",
  );
});

test("two consecutive failures fire exactly one alert", () => {
  assert.equal(
    decide({ active: true, alerting: false, recent: [down, down, up] }),
    "alert",
  );
});

test("no repeat alerts while the target stays down", () => {
  for (const history of [
    [down, down, down],
    [down, down, down, down, down],
  ]) {
    assert.equal(
      decide({ active: true, alerting: true, recent: history }),
      "none",
      "one outage must produce one alert, not one every five minutes",
    );
  }
});

test("recovery needs two good checks, not one", () => {
  // 2026-08-11: one good check inside a long block fired "Recovered", and the
  // next two refusals fired "DOWN" again. Recovery carries the same burden of
  // proof as the outage did.
  assert.equal(
    decide({ active: true, alerting: true, recent: [up, down, down] }),
    "none",
    "a single good check is not proof the outage ended",
  );
  assert.equal(
    decide({ active: true, alerting: true, recent: [up, up, down, down] }),
    "recover",
  );
});

test("a target that never alerted produces no recovery notice", () => {
  assert.equal(
    decide({ active: true, alerting: false, recent: [up, down, up] }),
    "none",
    "it blipped once, nobody was told, so there is nothing to take back",
  );
});

test("recovery is not repeated after the flag clears", () => {
  assert.equal(
    decide({ active: true, alerting: false, recent: [up, up, down] }),
    "none",
  );
});

test("a blocked target is never reported down", () => {
  // The regression this whole change exists for. However long the block runs,
  // and however it is interleaved, nobody gets paged.
  assert.equal(
    decide({ active: true, alerting: false, recent: [blocked, blocked] }),
    "none",
  );
  assert.equal(
    decide({
      active: true,
      alerting: false,
      recent: Array<CheckOutcome>(12).fill(blocked),
    }),
    "none",
    "two hours of refusals is still not an outage",
  );
});

test("a block does not close an outage that was real", () => {
  // Site went down, we said so, and then the CDN started refusing us. We no
  // longer know anything — so the open alert stays open rather than being
  // quietly retracted on no evidence.
  assert.equal(
    decide({ active: true, alerting: true, recent: [blocked, blocked, down, down] }),
    "none",
  );
});

test("deactivating a target with an open alert closes it out, once", () => {
  assert.equal(
    decide({ active: false, alerting: true, recent: [] }),
    "recover",
    "the spec's acceptance test: flipping the broken target off sends one recovery notice",
  );
  // And after that send clears the flag, the next run must stay silent.
  assert.equal(decide({ active: false, alerting: false, recent: [] }), "none");
});

test("deactivating a healthy target says nothing", () => {
  assert.equal(decide({ active: false, alerting: false, recent: [] }), "none");
});

test("a brand new target with no history says nothing", () => {
  assert.equal(decide({ active: true, alerting: false, recent: [] }), "none");
});

test("a missed cycle still alerts rather than staying silent", () => {
  // If the checker misses runs, or a send failed and left the flag clear, the
  // failure run can jump past the threshold. An outage nobody was told about
  // is worse than an alert that arrives a cycle late.
  assert.equal(
    decide({ active: true, alerting: false, recent: [down, down, down, down] }),
    "alert",
  );
});

test("the full outage lifecycle, cycle by cycle", () => {
  assert.deepEqual(
    replay([up, down, down, down, down, up, up, up]),
    ["down", "recovered"],
    "one outage, one alert, one recovery",
  );
});

test("replaying 2026-08-11 sends nothing at all", () => {
  // The morning that started this. Red Rock Bicycle served every real visitor
  // normally while its CDN refused our checker with 403s: nineteen clean hours,
  // then 28 refusals, one 200 that slipped through, then more refusals.
  //
  // What actually went out that day: DOWN at 08:15, Recovered at 10:30, DOWN
  // again at 10:40. What should have gone out is nothing, because nothing
  // happened to the site.
  const morning: CheckOutcome[] = [
    up,
    ...Array<CheckOutcome>(28).fill(blocked),
    up,
    ...Array<CheckOutcome>(2).fill(blocked),
  ];

  assert.deepEqual(replay(morning), [], "a blocked checker is not an outage");
});

test("a real outage during a block is still caught", () => {
  // The failure mode to guard against while fixing the other one: if refusals
  // made us blind, a genuine outage inside a blocked stretch would go unheard.
  // Two real failures alert no matter how much noise surrounds them.
  assert.deepEqual(
    replay([up, blocked, blocked, down, blocked, down, blocked, up, up]),
    ["down", "recovered"],
  );
});
