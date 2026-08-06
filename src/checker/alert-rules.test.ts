import assert from "node:assert/strict";
import { test } from "node:test";

import { consecutiveFailures, decide } from "./alert-rules";

// The spec calls alerting "the feature this tool exists for" and says to test
// it early. These run in milliseconds against the pure rules, so the five
// minute cron loop is never the thing standing between a change and knowing
// whether it broke the contract.
//
// `recentOk` is newest-first, matching the `order(checked_at desc)` the checker
// reads with. false = a failed check.

test("consecutiveFailures counts only the unbroken run at the newest end", () => {
  assert.equal(consecutiveFailures([]), 0);
  assert.equal(consecutiveFailures([true, false, false]), 0);
  assert.equal(consecutiveFailures([false, true, false]), 1);
  assert.equal(consecutiveFailures([false, false, true]), 2);
  assert.equal(consecutiveFailures([false, false, false]), 3);
});

test("one failed check is not enough to alert", () => {
  assert.equal(
    decide({ active: true, alerting: false, recentOk: [false, true, true] }),
    "none",
    "a single blip must stay quiet — that is what the threshold is for",
  );
});

test("two consecutive failures fire exactly one alert", () => {
  assert.equal(
    decide({ active: true, alerting: false, recentOk: [false, false, true] }),
    "alert",
  );
});

test("no repeat alerts while the target stays down", () => {
  for (const history of [
    [false, false, false],
    [false, false, false, false, false],
  ]) {
    assert.equal(
      decide({ active: true, alerting: true, recentOk: history }),
      "none",
      "one outage must produce one alert, not one every five minutes",
    );
  }
});

test("recovery fires once, for a target that actually alerted", () => {
  assert.equal(
    decide({ active: true, alerting: true, recentOk: [true, false, false] }),
    "recover",
  );
});

test("a target that never alerted produces no recovery notice", () => {
  assert.equal(
    decide({ active: true, alerting: false, recentOk: [true, false, true] }),
    "none",
    "it blipped once, nobody was told, so there is nothing to take back",
  );
});

test("recovery is not repeated after the flag clears", () => {
  assert.equal(
    decide({ active: true, alerting: false, recentOk: [true, true, false] }),
    "none",
  );
});

test("deactivating a target with an open alert closes it out, once", () => {
  assert.equal(
    decide({ active: false, alerting: true, recentOk: [] }),
    "recover",
    "the spec's acceptance test: flipping the broken target off sends one recovery notice",
  );
  // And after that send clears the flag, the next run must stay silent.
  assert.equal(decide({ active: false, alerting: false, recentOk: [] }), "none");
});

test("deactivating a healthy target says nothing", () => {
  assert.equal(decide({ active: false, alerting: false, recentOk: [] }), "none");
});

test("a brand new target with no history says nothing", () => {
  assert.equal(decide({ active: true, alerting: false, recentOk: [] }), "none");
});

test("a missed cycle still alerts rather than staying silent", () => {
  // If the checker misses runs, or a send failed and left the flag clear, the
  // failure run can jump past the threshold. An outage nobody was told about
  // is worse than an alert that arrives a cycle late.
  assert.equal(
    decide({ active: true, alerting: false, recentOk: [false, false, false, false] }),
    "alert",
  );
});

test("the full outage lifecycle, cycle by cycle", () => {
  // Walks one target through a real outage the way the checker would, carrying
  // the alerting flag forward exactly as the database would.
  let alerting = false;
  const sent: string[] = [];

  const cycle = (history: boolean[], active = true) => {
    const action = decide({ active, alerting, recentOk: history });
    if (action === "alert") {
      sent.push("down");
      alerting = true;
    } else if (action === "recover") {
      sent.push("recovered");
      alerting = false;
    }
  };

  cycle([true]);                                   // healthy
  cycle([false, true]);                            // first failure — quiet
  cycle([false, false, true]);                     // second — alert
  cycle([false, false, false, true]);              // still down — quiet
  cycle([false, false, false, false, true]);       // still down — quiet
  cycle([true, false, false, false, false]);       // back up — recovery
  cycle([true, true, false, false, false]);        // healthy — quiet

  assert.deepEqual(sent, ["down", "recovered"], "one outage, one alert, one recovery");
});
