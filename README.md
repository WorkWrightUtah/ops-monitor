# WorkWright — Ops Monitor

A headless cron. Every five minutes it GETs three URLs, records the result, and emails
`monitor@workwright.co` when one goes down and again when it comes back.

There is no dashboard, no login and no web service. There used to be all three; they were deleted on
2026-09-09 when uptime monitoring moved into the WorkWright Portal.

## Why this still exists

**It is the only checker outside the Portal, and that is its entire job.**

The Portal now watches every hosted client site itself, on its own five-minute cron, and shows the
charts on `/app`. That is the system to use and the place to look. But a checker that lives inside
the Portal cannot report the Portal down — if the Portal or its database fails, its checker fails in
the same breath. Worse, `app.workwright.co` and `clients.workwright.co` are one service behind two
hostnames, so they fail together.

So the alarm that says "the Portal has stopped answering" also means "every client site has stopped
being checked, and no client outage will alert either." This service is what sends it. It runs on its
own Railway project, its own Supabase project and its own network, so that nothing it watches can
take it down with them.

Treat it accordingly: it should be boring, and it should be left alone.

## What it watches

| URL | Why |
|---|---|
| `https://app.workwright.co` | Staff Portal. Must be watched from outside. |
| `https://clients.workwright.co` | Client Portal. Same service, same failure. |
| `https://www.workwright.co` | Marketing site. Not a "project", so the Portal has nowhere to put it. |

Client sites are **not** watched here. They belong to the Portal, registered by URL on the project's
own page.

## Runbook: change what is watched

There is no UI. Targets are rows in `public.targets` in this project's Supabase.

```sql
-- add
insert into public.targets (name, url, active)
values ('WorkWright site', 'https://www.workwright.co', true);

-- stop watching, keeping the history
update public.targets set active = false where url = 'https://example.com';

-- see the current state
select name, url, active, alerting from public.targets order by name;
```

`alerting` is the flag that makes one outage produce one email instead of one every five minutes.
Never edit it by hand: the checker sets it after a notice is delivered, and clearing it re-sends.

## Runbook: change who is told

`ALERT_EMAIL_TO` on the `checker` service in Railway. It is an alias, not a person, so on-call can be
reassigned without a deploy.

**Confirm a new address receives mail before switching to it.** A hard bounce puts the address on
Resend's suppression list and every alert after it is dropped silently. That has already happened once
on this account, to `clients@workwright.co`, and the failure is invisible until somebody goes looking.

## The rules it applies

All of this is pure and unit-tested; run `npm test`.

- **Three consecutive failures before alerting**, raised from two on 2026-08-11 after a day of alerts
  nobody believed. A real outage is reported about ten minutes in. That is the price, paid on purpose.
- **Two consecutive successes before announcing recovery.** One was enough until a single good check
  inside a two-hour outage fired "Recovered", then "DOWN" again ten minutes later.
- **`blocked` is not `down`.** A 403 from an edge network proves that edge is alive and serving. Red
  Rock Bicycle's CDN refused this checker for 2h20m while serving every real customer, and the tool
  called the shop down. A refusal is the absence of information: it neither alerts nor recovers.
- **A second vantage** (a Cloudflare Worker, `workers/vantage`) is asked for its own reading whenever
  ours is bad news. Unreachable, unconfigured or nonsense all return "unavailable" rather than
  throwing — the thing that makes the checker better must not be able to break it.
- **The checker identifies itself honestly** in its user-agent, with a contact URL and address, so
  anyone whose site it polls can look it up and allow it through. Dressing it up as Chrome would walk
  past most bot filters and make that impossible.

## Local

```bash
npm ci
npm test          # pure rules, no network, no database
npm run typecheck
npm run check:local   # a real pass; needs .env.local (see .env.local.example)
```

`npm run check:local` writes real rows and can send real email. It is the production database.

## Deployment

One Railway service, `checker`, configured by [`railway.checker.json`](./railway.checker.json): cron
`*/5 * * * *`, start command `npm run check`, restart policy `NEVER`.

A run that ends non-zero shows as a failed deployment in Railway. There is **no CI in this repo** —
nothing runs the tests on push — so run them before you push.
