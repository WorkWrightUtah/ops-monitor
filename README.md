# WorkWright — Ops Monitor

Checks WorkWright's live sites every five minutes, records uptime and response time, and raises
one alert (email + Teams) when a site goes down and one notice when it comes back.

A WorkWright House Stack app (Next.js · Supabase · Railway · Resend · n8n), scaffolded from
[`workwrightutah/template`](https://github.com/workwrightutah/template). House rules are in
[`CLAUDE.md`](./CLAUDE.md); scope in [`docs/spec.md`](./docs/spec.md); every decision and why it
was made in [`docs/decisions.md`](./docs/decisions.md).

**Outcome flag:** Internal (WorkWright-owned) · **Domain:** `status.workwright.co`

---

## Runbook: how to add a target

This is the thing you'll do most often. It takes about fifteen seconds, on the dashboard itself —
no Supabase, no code, no deploy.

1. Sign in at **<https://status.workwright.co>**.
2. Scroll to **Add a site** at the bottom.
3. Fill in two boxes and press **Add site**:

   | Box | What to put | Example |
   |---|---|---|
   | **Name** | A human label. This is what appears on the tile and in the alert subject line. | `WorkWright marketing site` |
   | **Address** | The site to check. `https://` is assumed if you leave it off. | `workwright.co` |

4. The tile appears immediately and the first check runs within five minutes.

If something's wrong with what you typed, the form says so in plain words and nothing is saved.
It will refuse a URL that isn't a real domain, isn't `http`/`https`, or is already on the board.

### Removing a target

Each tile has a **Remove** link in its top-right corner. It asks once, because **removing a target
deletes its entire check history along with it** — that's a database cascade, and there's no undo.

If you only want to stop checking something for a while and keep the history, that's a **pause**,
and it's still a Supabase edit: Table Editor → `targets` → set `active` to `false`. If the target
had an open alert, pausing sends one recovery notice closing it out — intentional, not a bug.

> There's deliberately no pause button on the dashboard yet. Add and remove covered what was asked
> for; if pausing turns out to be the thing you reach for, it's a small addition.

### Never edit these by hand

`id`, `created_at`, and `alerting` are the database's and the checker's business. **Never set
`alerting` yourself** — the checker owns it, and changing it will either suppress a real alert or
fire a spurious one.

### Things worth knowing

- A target counts as **up** on any `2xx` or `3xx` response. Redirects are followed, so a site that
  301s to its canonical host is healthy.
- Checks time out after **10 seconds**. A timeout is a failure with no status code.
- A failed check is **retried once** after 3 seconds before it's recorded. One dropped connection
  shouldn't enter the history as a fact.
- Checks are **jittered** by up to 30 seconds inside each 5-minute slot, so our traffic doesn't
  arrive on a perfectly machine-like grid. See "Blocked" below.
- One URL, one row — the database enforces it, so you can't accidentally watch the same site twice
  under two names.

---

## Runbook: how alerts behave

The rules, exactly:

| Situation | What happens |
|---|---|
| A check fails once | **Nothing.** One blip is not an outage. |
| A second check fails in a row | **One alert** — a Resend email to `claude@workwright.co` *and* an Adaptive Card in the Teams channel. |
| It keeps failing | **Nothing more.** One outage produces one alert, however long it lasts. |
| It responds successfully **twice** in a row | **One recovery notice** to the same two channels. |
| The site **refuses** us (`401`, `403`, `429`) | **Nothing.** See "Blocked" below. |
| You pause a target that was alerting | **One recovery notice**, closing the alert out. |
| A target that never alerted recovers or is paused | **Nothing.** There's nothing to take back. |

### "Blocked" — refused is not down

A site can answer and still turn us away. A `403` from a CDN means that CDN is alive and serving;
it tells us nothing about whether customers can reach the site. A genuinely broken site gives a
`5xx`, or nothing at all.

So `401`, `403` and `429` are recorded as **Blocked**, not Down:

- **No alert is sent.** Nobody gets paged because a bot filter doesn't like us.
- The dashboard shows an amber **Blocked** pill and says so in plain words on the tile.
- Blocked checks are **left out of the uptime percentage** entirely — not counted as downtime, not
  counted as uptime. A tile reading `100% · 2 checks in 24h` means what it says: what we saw was
  healthy, and we hardly got to look.
- They don't count toward an alert **or** toward a recovery. A target that was genuinely down and
  then starts blocking us keeps its open alert, because we no longer know anything.

**Every other `4xx` still alerts**, including `404` — a missing page is a real problem for whoever
was trying to visit it.

**What to do when a target sits Blocked for days:** the durable fix is to get the checker
allowlisted by whoever runs that site's CDN. The user-agent carries contact details for exactly
this reason:

```
WorkWright-OpsMonitor/1.0 (+https://status.workwright.co; ops@workwright.co)
```

Until then the tool is honest about not knowing, which is the point.

**Why you won't get spammed:** a `targets.alerting` flag tracks whether a notice is outstanding.
It's set only *after* a notice is actually delivered — so if both channels fail, the alert stays
open and the next run tries again rather than marking an outage announced that nobody heard.

**If only one channel is down**, the notice still counts as delivered and won't re-send; the
failure is in the Railway logs for the `checker` service. Keeping "one outage, one alert" intact
was judged more important than guaranteeing both channels every time.

### Testing the alert path

There's a seed target called **Broken route (alert test)** that points at a 404 route and sits
inactive.

1. Set its `active` to `true`.
2. Wait two check cycles (≤ 10 minutes). You should get exactly one email and one Teams card.
3. Set `active` back to `false`. You should get exactly one recovery notice, and nothing after.

If you want it faster than the cron, run `npm run check:local` locally — each invocation is one
cycle.

---

## Runbook: how to redeploy

Railway auto-deploys on every push to `main`. A manual redeploy is only needed to roll back or to
pick up a changed environment variable.

**Before any deploy** (house rule — in this order):

```bash
npm run build   # must pass
npm run lint    # must pass
npm test        # alert rules — must pass
git status      # must be clean
git log origin/main -1   # your commit must be here, not just local
```

Then push, or trigger a redeploy from the Railway dashboard → service → **Deployments** →
**Redeploy**.

**After any deploy, confirm it actually works** — don't trust a green checkmark:

```bash
curl -I https://status.workwright.co/login     # expect 200
curl    https://status.workwright.co/status    # expect "app": "ok" and both env flags true
```

### Rollback

- **App:** Railway keeps every build. Service → **Deployments** → last known-good → **Redeploy**.
- **Database:** never hand-edit production. Roll forward with a new migration in
  `supabase/migrations/`.

---

## Services

The Railway project `ops-monitor` runs **two** services off this one repo:

| Service | What it does | Config |
|---|---|---|
| `web` | The dashboard. Next.js. | Start: `npm run start` |
| `checker` | The five-minute job. Runs once and exits. | Cron: `*/5 * * * *`, start: `npm run check` |

They're deliberately separate: a redeploy, crash, or idle-sleep of the dashboard must not be able
to silently stop the monitoring. That would be the worst possible failure for a tool whose whole
job is noticing when things stop.

---

## Local setup

```bash
npm install
cp .env.local.example .env.local   # fill from Supabase dashboard + 1Password
npm run dev                        # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Dashboard at localhost:3000 |
| `npm run build` / `npm run lint` | Must both pass before any push |
| `npm test` | The alert rules. Fast, no network, no database. |
| `npm run check:local` | Run one checker cycle against the live database, using `.env.local` |

`npm run check:local` writes real rows and sends real alerts. It is the same code the cron runs.

---

## Who can see the dashboard

Team only. Signing in requires a Supabase Auth account, and the Row Level Security policies only
return data to a **`@workwright.co`** email address. Anyone else can create an account and sign
in, and will see an empty dashboard — that's by design, not a leak: RLS is the security boundary,
so the gate holds even against someone calling the API directly.

To add a team member: they create an account at `/login`, or you add one in Supabase →
**Authentication** → **Add user**. No role assignment needed; the email domain is the gate.

---

## Structure

```
src/app/                routes (App Router)
src/app/login/          sign-in page + auth server actions
src/app/status/         public health check (reports no data)
src/checker/            the five-minute job
  alert-rules.ts        the alert contract, as a pure tested function
  http-check.ts         one HTTP GET, shaped like a checks row
  notify.ts             Resend email + n8n webhook
  run.ts                entry point the cron service runs
src/components/         status tile, response-time chart
src/lib/supabase/       browser + server clients (RLS-respecting)
supabase/migrations/    SQL migrations — the only way schema changes
docs/                   spec.md, decisions.md
```

## Secrets

Environment variables live in **Railway service variables**; credentials live in **1Password**.
`.env.local` is gitignored — never commit real values.

The `service_role` key is the dangerous one: it bypasses every RLS policy. It belongs on the
`checker` service only, and must never appear in a `NEXT_PUBLIC_*` variable, where it would be
shipped to the browser.
