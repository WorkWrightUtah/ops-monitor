-- Record what a check *meant*, not just what came back.
--
-- Until now `checks` stored status_code and ok, and every reader derived
-- up/down/blocked from the status code on the fly. That worked while the
-- status code was the whole story. It no longer is: a second vantage point can
-- overturn the local reading — a 403 that a Cloudflare Worker also gets is an
-- outage for visitors, while a 500 that the Worker doesn't see is a problem
-- with our own network. Two rows with identical status codes can now mean
-- opposite things, so the verdict has to be written down at the moment it is
-- reached rather than recomputed later from evidence that no longer contains
-- it. See reconcile() in src/lib/check-outcome.ts.
--
-- Nullable on purpose. A NOT NULL column would mean the currently-deployed
-- checker starts failing every insert the instant this lands, and the gap
-- between a migration and a deploy is exactly when a monitor should not go
-- blind. Old rows are backfilled below; anything written during a deploy gap
-- falls back to the old derivation via public.check_outcome().

alter table public.checks add column if not exists outcome text;

alter table public.checks drop constraint if exists checks_outcome_valid;
alter table public.checks add constraint checks_outcome_valid
  check (outcome is null or outcome in ('up', 'down', 'blocked'));

-- The one place the up/down/blocked rule lives in the database. Mirrors
-- outcomeOf() in src/lib/check-outcome.ts; change them together.
--
-- search_path is pinned empty because Supabase's advisor flags functions
-- without it. This one touches no tables so it is moot in practice, but a
-- clean advisor report at handoff is worth more than the inlining it costs.
create or replace function public.check_outcome(outcome text, status_code int)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    outcome,
    case
      when status_code is null then 'down'
      when status_code between 200 and 399 then 'up'
      when status_code in (401, 403, 429) then 'blocked'
      else 'down'
    end
  )
$$;

comment on function public.check_outcome(text, int) is
  'The recorded outcome of a check, falling back to deriving it from the status code for rows written before checks.outcome existed. Mirrors outcomeOf() in src/lib/check-outcome.ts.';

-- Backfill. Every existing row predates the second vantage, so its status code
-- is still the whole story and the derivation is exactly right for it.
update public.checks
set outcome = public.check_outcome(null, status_code)
where outcome is null;

-- Re-state the view over the new column. Refusals still leave the uptime maths
-- entirely; the difference is that "refusal" now means the recorded verdict,
-- so a 403 that both vantages saw counts as real downtime rather than being
-- quietly excluded.
--
-- security_invoker = on is restated deliberately. CREATE OR REPLACE VIEW does
-- not inherit it, and dropping it would silently switch the view to running as
-- its owner — handing every signed-in account the rows that RLS on targets and
-- checks exists to withhold.
create or replace view public.target_status
with (security_invoker = on) as
select
  t.id,
  t.name,
  t.url,
  t.active,
  t.alerting,

  latest.checked_at  as last_checked_at,
  latest.status_code as last_status_code,
  latest.response_ms as last_response_ms,
  latest.ok          as last_ok,

  day.uptime_pct   as uptime_24h,
  day.sample_count as checks_24h,
  week.uptime_pct  as uptime_7d,
  week.sample_count as checks_7d,

  -- Appended rather than sitting next to the other `last_*` columns, where it
  -- belongs. CREATE OR REPLACE VIEW can only add columns at the end — insert
  -- one in the middle and Postgres refuses with "cannot change name of view
  -- column". Renaming the whole view to tidy this up would cost a DROP, and
  -- dropping a view the dashboard reads to improve column order is a bad
  -- trade. Readers select by name.
  latest.outcome as last_outcome
from public.targets t

left join lateral (
  select
    c.checked_at,
    c.status_code,
    c.response_ms,
    c.ok,
    public.check_outcome(c.outcome, c.status_code) as outcome
  from public.checks c
  where c.target_id = t.id
  order by c.checked_at desc
  limit 1
) latest on true

left join lateral (
  select
    round(
      100.0 * count(*) filter (where public.check_outcome(c.outcome, c.status_code) = 'up')
      / nullif(count(*) filter (
          where public.check_outcome(c.outcome, c.status_code) <> 'blocked'
        ), 0),
      2
    ) as uptime_pct,
    count(*) filter (
      where public.check_outcome(c.outcome, c.status_code) <> 'blocked'
    ) as sample_count
  from public.checks c
  where c.target_id = t.id
    and c.checked_at > now() - interval '24 hours'
) day on true

left join lateral (
  select
    round(
      100.0 * count(*) filter (where public.check_outcome(c.outcome, c.status_code) = 'up')
      / nullif(count(*) filter (
          where public.check_outcome(c.outcome, c.status_code) <> 'blocked'
        ), 0),
      2
    ) as uptime_pct,
    count(*) filter (
      where public.check_outcome(c.outcome, c.status_code) <> 'blocked'
    ) as sample_count
  from public.checks c
  where c.target_id = t.id
    and c.checked_at > now() - interval '7 days'
) week on true;

comment on view public.target_status is
  'One row per target with its latest check and 24h/7d uptime. Checks the target refused (outcome = blocked) are excluded from the uptime maths — they measure our access, not the site. Runs as the caller (security_invoker), so RLS on targets and checks still applies.';
