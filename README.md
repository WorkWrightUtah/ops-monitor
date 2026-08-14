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
| A check fails once or twice | **Nothing.** One blip is not an outage. |
| A **third** check fails in a row | **One alert** — a Resend email to `claude@workwright.co` *and* an Adaptive Card in the Teams channel. |
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
- A **short** block is looked past — two failures either side of one skipped check still count as
  consecutive. A block longer than ~15 minutes (3 checks) cuts the history off instead: whatever we
  saw on the far side is too stale to chain onto what we're seeing now.

**Every other `4xx` still alerts**, including `404` — a missing page is a real problem for whoever
was trying to visit it.

**What to do when a target sits Blocked for days:** the durable fix is to get the checker
allowlisted by whoever runs that site's CDN. The user-agent carries contact details for exactly
this reason:

```
WorkWright-OpsMonitor/1.0 (+https://status.workwright.co; ops@workwright.co)
```

Until then the tool is honest about not knowing, which is the point.

### The second vantage point

One checker in one datacenter cannot tell *"the site is refusing everyone"* from *"the site is
refusing us"* — and those need opposite responses. So when a check fails, the checker asks a
Cloudflare Worker (`workers/vantage`) to try the same URL from a completely unrelated network, and
combines the two readings:

| We saw | The Worker saw | Verdict | Why |
|---|---|---|---|
| up | *(not asked)* | **up** | nothing to corroborate |
| down | up | **blocked** | the site is fine; our network is the problem |
| down | down or blocked | **down** | corroborated — a real outage |
| blocked | up | **blocked** | confirmed: it's us being refused |
| blocked | **blocked** | **down** | *nobody* can reach it — an outage from a visitor's chair |
| anything | *unreachable* | *unchanged* | no new information, so no new conclusion |

The second-to-last row is the important one: it buys back the coverage we gave up by not paging on
refusals. A WAF rule broken badly enough to turn away two unrelated networks is turning away
customers too.

**If the Worker is unreachable, not configured, or rejects our token, the checker behaves exactly
as it did before.** That is deliberate — the second opinion is an improvement to lean on, never a
dependency that can take the monitor down with it.

The verdict is stored on the check (`checks.outcome`) rather than re-derived later, because two
checks with the same status code can now mean opposite things.

#### Deploying the second vantage

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (both in `.env.local`, both in
1Password), and a `workers.dev` subdomain registered on the Cloudflare account.

```bash
cd workers/vantage
npx wrangler deploy
npx wrangler secret put VANTAGE_TOKEN     # paste the shared secret
```

Then set two variables on the Railway **checker** service:

| Variable | Value |
|---|---|
| `VANTAGE_URL` | the deployed Worker's URL |
| `VANTAGE_TOKEN` | the same secret you gave `wrangler secret put` |

Both must match or the Worker returns 401 and the checker quietly carries on without it — which is
safe, but means you get none of the benefit. To confirm it is actually working, look for
`second vantage saw ...` in the `checker` service logs after any failed check.

**Why you won't get spammed:** a `targets.alerting` flag tracks whether a notice is outstanding.
It's set only *after* a notice is actually delivered — so if both channels fail, the alert stays
open and the next run tries again rather than marking an outage announced that nobody heard.

**If only one channel is down**, the notice still counts as delivered and won't re-send; the
failure is in the Railway logs for the `checker` service. Keeping "one outage, one alert" intact
was judged more important than guaranteeing both channels every time.

### Testing the alert path

Add a temporary target pointed at a hostname that does not resolve, let it fail three times, then
switch it off. That exercises the whole path — checker, thresholds, email, and Teams — for real.

```sql
-- 1. Create it. A nonexistent host gives a clean "no response", which is
--    unambiguously down. Do NOT use a 404 on status.workwright.co: the auth
--    middleware redirects unknown routes to /login and the checker sees 200.
insert into public.targets (name, url, active, alerting)
values ('Alert path test (temporary)', 'https://this-host-does-not-exist.workwright.co', true, false);

-- 2. Run three cycles (see below). The third sends the DOWN notice.

-- 3. Switch it off. The next cycle closes the alert out with a recovery notice.
update public.targets set active = false where name = 'Alert path test (temporary)';

-- 4. Run one more cycle, then delete it. Check alerting = false first — deleting
--    a target mid-alert leaves a notice that never gets closed.
delete from public.targets where name = 'Alert path test (temporary)';
```

Each `npm run check:local` is one cycle, so the whole test takes about two minutes instead of the
twenty the cron would need. Expect exactly one email plus one Teams card for the outage, and one of
each for the recovery.

Two things to know before you read the output:

- **`teams=accepted` is not proof.** It means n8n took the request. Confirm in the channel, or in
  the flow's run history — see the section above.
- **The second vantage is not exercised locally.** `VANTAGE_URL` and `VANTAGE_TOKEN` live in
  Railway, not `.env.local`, so a local run logs `second vantage saw unavailable (not configured)`
  and falls back to its own verdict. That is correct behaviour, not a fault, but it means local
  runs do not test the Worker.

### When Teams cards stop arriving but email keeps working

This has already happened once, on 2026-08-06, and it went unnoticed for a week. Read this before
debugging anything on our side, because **the logs will tell you the send succeeded.**

The Teams path has three hops, and only the first two are ours:

```
checker  ──POST──▶  n8n webhook  ──POST──▶  Power Automate flow  ──▶  Teams channel
                    (our workflow)          "Send webhook alerts to General"
```

Both of our hops answer instantly and optimistically. The n8n webhook replies "Workflow got
started" before the workflow runs, so the checker logs `teams=accepted`. Power Automate replies
`202 Accepted` with an empty body before the flow runs, so the n8n node logs a success. **A flow
that fails on every single run still looks green from here.** The failure is visible in exactly
two places: the flow's own run history, and a weekly digest email Microsoft sends the flow's owner
("1 of your flow(s) have failed").

Where to look, in order:

1. **Teams itself.** Search the channel for a recent alert. If the last card is old, the flow is
   the problem, not the checker.
2. **[The flow's run history](https://make.powerautomate.com/environments/Default-fe3d00dc-277c-4f4a-8088-5578cce1296a/flows/6c0f4681-7b2a-4766-9bcf-062efba462f0/details)**
   — signed in as **benson@workwright.co**, who owns it. Open a failed run and read the red step.
3. Only then look at n8n executions and the `checker` logs.

**The failure we've actually seen:** the trigger step succeeds, and `Post card in a chat or
channel` fails with **`Unauthorized`**. That is not our payload — it's the flow's Microsoft Teams
connection losing its token, usually after a password change or a tenant policy update. Power
Automate shows an **"Action required"** banner offering **Reauthenticate**; one click on that
fixes it. Nothing needs to be redeployed and no code needs to change.

**Do not panic about missed outages.** Email and Teams are independent — email goes out through
Resend and does not touch any of this. Through the entire week of Teams failures every alert still
landed in `claude@workwright.co`. That redundancy is the whole reason there are two channels.

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
