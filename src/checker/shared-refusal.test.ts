import assert from "node:assert/strict";
import { test } from "node:test";

import { sharedRefusal, type RunReading } from "./shared-refusal";

const reading = (
  name: string,
  refused: boolean,
  edge: string | null,
): RunReading => ({ targetId: name, name, refused, edge });

// The 14:35 UTC run on 2026-11-10: Railway's edge refused all three targets.
const STAFF = reading("WorkWright Portal (staff)", true, "Railway");
const CLIENTS = reading("WorkWright Portal (clients)", true, "Railway");
const SITE = reading("WorkWright site", true, "Railway");

test("2026-11-10: three Railway targets refused together name Railway and each other", () => {
  assert.deepEqual(sharedRefusal(STAFF, [STAFF, CLIENTS, SITE]), {
    host: "Railway",
    others: ["WorkWright Portal (clients)", "WorkWright site"],
  });
});

test("a refusal nobody else shared says nothing", () => {
  assert.equal(
    sharedRefusal(STAFF, [STAFF, reading("WorkWright site", false, "Railway")]),
    null,
  );
});

test("a target that wasn't refused is never grouped, however many others were", () => {
  const up = reading("WorkWright Portal (staff)", false, "Railway");
  assert.equal(sharedRefusal(up, [up, CLIENTS, SITE]), null);
});

test("refusals from different edges are separate stories and are not grouped", () => {
  const cloudflare = reading("Red Rock Bicycle", true, "Cloudflare");
  assert.equal(sharedRefusal(STAFF, [STAFF, cloudflare]), null);
  assert.equal(sharedRefusal(cloudflare, [STAFF, cloudflare]), null);
});

test("with the edge unknown, any shared refusal is reported, but no host is named", () => {
  // Guards the unverified case: if a host's own 429s turn out to carry no
  // identifying headers, the grouping still works, more weakly and honestly.
  const a = reading("A", true, null);
  const b = reading("B", true, null);
  const c = reading("C", true, "Cloudflare");
  assert.deepEqual(sharedRefusal(a, [a, b, c]), { host: null, others: ["B", "C"] });
});

test("a known edge does not borrow refusals whose edge is unknown", () => {
  // We can't say an unlabelled refusal was Railway's, so it isn't counted as one.
  assert.equal(sharedRefusal(STAFF, [STAFF, reading("B", true, null)]), null);
});
