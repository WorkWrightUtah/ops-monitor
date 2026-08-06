# Decisions Log

> Append-only. Log any structural or scope choice the day it's made (CLAUDE.md rule).
> Newest at the top.

## 2026-08-06 — OPEN QUESTION: Supabase Auth still needs custom SMTP wired to Resend
**The question for Ryan:** signup confirmation and password-reset mail currently goes through
Supabase's built-in mailer, which is rate-limited to a couple of messages an hour and is intended
for testing only. Nothing is broken today because the accounts that exist were provisioned
directly, but the first time a team member self-registers or forgets a password, the mail will
silently not arrive.
**Fix when unblocked:** once `workwright.co` finishes verifying in Resend, point Supabase's
custom SMTP at Resend in the dashboard (Project Settings → Auth → SMTP). It is a settings change,
not code, which is why it isn't in a migration.
**Not blocking:** the acceptance criteria only require that login works and that a non-team
account sees nothing — both are proven.

## 2026-08-06 — Email + password login, not magic links
**Why:** the spec asks for "Supabase Auth, email login" and leaves the mechanism open. Magic
links would make every single sign-in depend on mail delivery, and mail is the one part of this
stack that is not yet verified (see the open question above) — a monitoring tool that can't be
logged into during an outage because its login email is queued is exactly the wrong failure.
Passwords work with no external dependency.
**Sign-up is left open on purpose:** RLS, not the absence of a sign-up form, is the security
boundary. An outsider can create an account and will see an empty dashboard, which is precisely
the acceptance test the spec asks for. Keeping sign-up open means that test can be run by anyone,
any time, without an admin handing out credentials.
**Revisit if:** the shop standardizes on SSO, or open sign-up starts collecting junk accounts —
at which point disable sign-ups in the Supabase dashboard and provision team members by hand.

## 2026-08-06 — Team membership is "a `@workwright.co` email", enforced by one SQL function
**Why:** the spec's data model is two tables, and a roles table would have made it three for a
tool with exactly one role. `public.is_team_member()` reads the caller's JWT and compares the
email domain; every RLS policy calls it, so "who is the team" is defined in one place instead of
copied across six policies. Domain comparison uses `split_part(lower(email), '@', 2) = 'workwright.co'`
— an exact match on the domain, not a `LIKE '%@workwright.co'` suffix, which would also have
accepted addresses ending in a lookalike domain.
**Revisit if:** we need more than one role (e.g. read-only contractors), or team members start
signing in with addresses off the workwright.co domain. Either turns this into a real membership table.

## 2026-08-06 — `lower()` the email before the domain comparison
**Why:** testing the gate against candidate identities before wiring any UI showed
`Ryan@WorkWright.co` failing a check that `ryan@workwright.co` passed. Supabase does not
guarantee the JWT email claim is lowercased. The failure mode is silent — RLS returns an empty
result set, not an error — so a team member with a capitalized address would have seen an empty
dashboard and no explanation.
**Revisit if:** never; this is a bug fix, kept here because the near-miss is the lesson.

## 2026-08-06 — Alert state is derived from `checks`, not stored on `targets`
**Why:** the de-duplication rules ("fire at two consecutive fails", "no repeats while down",
"one recovery notice") all describe the *tail* of a target's check history, and the tail is
already in `checks`. Counting consecutive failures from the newest row backwards gives:
fire when the run length is exactly 2; stay quiet when it's 3 or more (already alerting);
send recovery when the newest check is `ok` and the run of failures immediately before it
was 2 or more. No `alerting` boolean to keep in sync, no third table, and no way for the
flag and the history to disagree after a crash mid-write.
**Trade-off accepted:** each evaluation costs one small indexed read per target instead of
reading a cached boolean. At ~3 targets every 5 minutes that is free, and
`checks (target_id, checked_at desc)` serves it directly.
**Revisit if:** target count grows into the hundreds, or we add alert rules that depend on
something not recoverable from check history (e.g. "who acknowledged this outage").

## 2026-08-06 — Scheduler: a Railway cron service, not an in-app scheduler
**Why:** the spec allows either and asks that the choice be logged. A separate Railway service
running `*/5 * * * *` and exiting keeps the checker independent of the web process — a redeploy,
crash, or idle-sleep of the dashboard can't silently stop the monitoring, which would be the
worst possible failure for a tool whose whole job is noticing when things stop. Five minutes is
also exactly Railway's minimum cron interval, so the spec's cadence fits without fighting the
platform. It's the version of this that teaches "background work on Railway," which the SOW names
as the skill this phase trains.
**Trade-off accepted:** two services to deploy and configure instead of one.
**Revisit if:** Railway cron's cold-start latency starts eating a meaningful share of the
5-minute budget, or we need sub-5-minute checks.

## 2026-08-06 — No `org_id` on `targets` or `checks`
**Why:** CLAUDE.md calls `org_id` "cheap insurance — apply it regardless of flag unless there's a
reason not to." This is the documented reason not to. The tool is WorkWright-internal, watches
only WorkWright property (the spec puts client-owned monitoring explicitly out of scope), and the
spec pins the schema to the listed columns "unless a decision in `decisions.md` justifies more."
A tenancy column with exactly one value forever is a column every query has to explain.
**Revisit if:** ops-monitor is ever pointed at client-owned properties, or turned into the
per-client status tooling behind a Shop-Kept care plan. That is a flag-A rebuild and `org_id`
comes back on day one.

## 2026-08-06 — `checks.status_code` is nullable
**Why:** a DNS failure, refused connection, or timeout is a real failed check with no HTTP status
to record. NULL says "no response arrived"; writing `0` or `599` would be inventing a status code
the server never sent, and every reader would then have to know our private convention.
`ok = false` carries the failure; `status_code` carries only what the server actually said.
**Revisit if:** we need to distinguish failure *kinds* in the dashboard, which would call for a
proper `error` column rather than overloading the status code.

## 2026-08-06 — All three seed targets start inactive
**Why:** `workwright.co` and `status.workwright.co` did not resolve when the seed migration was
written — the spec conditions the marketing site on "once it's live," and the monitor can't watch
itself before Phase 5 deploys it. Seeding them active would have generated a genuine outage alert
about sites we simply hadn't shipped yet, teaching everyone to ignore the alerts on day one. The
broken 404 route stays inactive by the spec's own instruction, except when testing.
**Revisit if:** n/a — flip each one active as it goes live. Tracked in the README runbook.

## 2026-08-06 — Outcome flag: internal (WorkWright-owned)
**Why:** the SOW names the flag "WorkWright-owned (internal)," which is not one of CLAUDE.md's
A/B/C. It behaves like **C — Shop-Kept** on infrastructure (dedicated Railway + Supabase project,
n8n automation allowed) with WorkWright as its own client, so email sends from `workwright.co`
rather than a client domain. Recorded here because "flag" appears in the README and drives the
tenancy and email rules.
**Revisit if:** the shop starts selling this as per-client status monitoring — that's flag A.
