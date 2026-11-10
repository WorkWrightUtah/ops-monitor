-- Record what the second vantage saw, not only what we concluded from it.
--
-- `checks.outcome` holds the reconciled verdict. Since 2026-08-11 that verdict
-- has been built from two readings — ours and the Cloudflare Worker's — but only
-- ours was stored. The Worker's answer lived in Railway's deploy logs and nowhere
-- else.
--
-- On 2026-11-10 that cost an investigation. The staff portal was recorded as
-- `down` with status 429, then `blocked` with status 429, then `down` again —
-- identical rows meaning opposite things — and the only way to see why was to
-- pull logs: the Worker had been refused too on some checks and served on
-- others. Logs age out; the table is the record. So the second reading goes in
-- the row next to the first.
--
-- second_outcome: what the Worker's reading meant, using the same words as
--   `outcome`, plus 'unavailable' (asked, but it gave no usable answer —
--   unconfigured, unreachable, bad token). NULL means we did not ask, which is
--   every check where our own reading was `up`.
-- second_status_code: the HTTP status the Worker got. NULL when it got no
--   response, when it was unavailable, or when it was not asked;
--   second_outcome tells those apart.
--
-- Both nullable and with no default, for the same reason `outcome` was: the
-- checker that is deployed when this lands does not write them, and a NOT NULL
-- column would fail every one of its inserts — the monitor going blind in the
-- gap between a migration and a deploy. Nothing is backfilled; the past
-- readings were never recorded, and inventing them would be worse than NULL.

alter table public.checks add column if not exists second_outcome text;
alter table public.checks add column if not exists second_status_code int;

alter table public.checks drop constraint if exists checks_second_outcome_valid;
alter table public.checks add constraint checks_second_outcome_valid
  check (second_outcome is null or second_outcome in ('up', 'down', 'blocked', 'unavailable'));

comment on column public.checks.second_outcome is
  'What the second vantage (Cloudflare Worker) concluded: up, down, blocked, or unavailable. NULL = not asked, which happens whenever our own reading was up.';
comment on column public.checks.second_status_code is
  'HTTP status the second vantage got from the target. NULL when it got no response, was unavailable, or was not asked — see second_outcome.';
