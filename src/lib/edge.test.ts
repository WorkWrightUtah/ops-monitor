import assert from "node:assert/strict";
import { test } from "node:test";

import { edgeOf } from "./edge";

const h = (init: Record<string, string>) => new Headers(init);

test("Railway is recognised by any of its documented or observed markers", () => {
  assert.equal(edgeOf(h({ "x-railway-edge": "railway/us-west2" })), "Railway");
  assert.equal(edgeOf(h({ "x-railway-request-id": "abc" })), "Railway");
  assert.equal(edgeOf(h({ server: "railway-edge" })), "Railway");
});

test("Cloudflare and Vercel are recognised", () => {
  assert.equal(edgeOf(h({ "cf-ray": "8f1b2c3d4e5f-SJC", server: "cloudflare" })), "Cloudflare");
  assert.equal(edgeOf(h({ "x-vercel-id": "sfo1::abc" })), "Vercel");
});

test("a Railway app behind Cloudflare reads as Railway: it answered, Cloudflare passed it on", () => {
  assert.equal(edgeOf(h({ "cf-ray": "x", "x-railway-edge": "railway/us-west2" })), "Railway");
});

test("headers that name no edge give null, not a guess", () => {
  assert.equal(edgeOf(h({})), null);
  assert.equal(edgeOf(h({ server: "nginx" })), null);
});
