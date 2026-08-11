-- Uptime should measure the site, not our access to it.
--
-- On 2026-08-11 Red Rock Bicycle's CDN spent two hours and twenty minutes
-- refusing our checker with 403s while serving every real visitor normally.
-- The old view counted each refusal as downtime, so a site that never missed a
-- request showed ~85% uptime for the day. That number would have reached a
-- report eventually, and it would have been a lie about a client's site — a
-- more expensive kind of wrong than a noisy alert.
--
-- A refusal (401/403/429) is not a failed check, it is an absent one: something
-- answered and turned us away, which says nothing about whether customers can
-- reach the site. So refusals leave the calculation entirely — out of the
-- numerator and out of the denominator.
--
-- Consequently checks_24h / checks_7d now count the checks the percentage is
-- computed from, not every request we made. A tile reading "100% · 2 checks in
-- 24h" tells the truth twice: what we saw was healthy, and we hardly got to
-- look. Averaging that with 28 refusals would report false confidence instead.
--
-- The 401/403/429 list is duplicated from REFUSAL_STATUSES in
-- src/lib/check-outcome.ts. Two copies of one list is a real cost; the
-- alternative is the dashboard and the database disagreeing about what "up"
-- means, which is worse. Change both together.
--
-- security_invoker = on is restated deliberately. CREATE OR REPLACE VIEW does
-- not inherit the original's options, and dropping it here would silently
-- switch the view to running as its owner — handing every signed-in account
-- the rows that RLS on targets and checks exists to withhold. The most
-- dangerous line in this file is the one that is easiest to leave out.

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

  -- NULL rather than 0 when a window holds no checks. "No data yet" and
  -- "down the entire time" are different facts and the tile says so. A window
  -- of nothing but refusals now lands here too, which is correct: we have no
  -- measurement, not a bad one.
  day.uptime_pct   as uptime_24h,
  day.sample_count as checks_24h,
  week.uptime_pct  as uptime_7d,
  week.sample_count as checks_7d
from public.targets t

-- Newest check. LATERAL + LIMIT 1 lets Postgres walk the
-- (target_id, checked_at desc) index and stop at the first row.
--
-- Deliberately the newest check of any kind, including a refusal: the tile
-- needs to know it is currently blocked, and hiding that behind the last
-- informative check would show a stale green "Up" for hours.
left join lateral (
  select c.checked_at, c.status_code, c.response_ms, c.ok
  from public.checks c
  where c.target_id = t.id
  order by c.checked_at desc
  limit 1
) latest on true

left join lateral (
  select
    round(
      100.0 * count(*) filter (where c.ok)
      / nullif(count(*) filter (
          where c.status_code is null or c.status_code not in (401, 403, 429)
        ), 0),
      2
    ) as uptime_pct,
    count(*) filter (
      where c.status_code is null or c.status_code not in (401, 403, 429)
    ) as sample_count
  from public.checks c
  where c.target_id = t.id
    and c.checked_at > now() - interval '24 hours'
) day on true

left join lateral (
  select
    round(
      100.0 * count(*) filter (where c.ok)
      / nullif(count(*) filter (
          where c.status_code is null or c.status_code not in (401, 403, 429)
        ), 0),
      2
    ) as uptime_pct,
    count(*) filter (
      where c.status_code is null or c.status_code not in (401, 403, 429)
    ) as sample_count
  from public.checks c
  where c.target_id = t.id
    and c.checked_at > now() - interval '7 days'
) week on true;

comment on view public.target_status is
  'One row per target with its latest check and 24h/7d uptime. Checks refused by the target (401/403/429) are excluded from the uptime maths — they measure our access, not the site. Runs as the caller (security_invoker), so RLS on targets and checks still applies.';
