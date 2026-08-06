-- target_status — one row per target, everything a status tile needs.
--
-- The dashboard could assemble this with four round trips per target, but that
-- is N+1 queries against a database that already knows how to do the joins.
-- One view, one request.
--
-- security_invoker = on is the important part: the view runs with the
-- *caller's* rights, so the RLS policies on targets and checks still apply.
-- Without it the view would run as its owner and quietly hand every signed-in
-- account the data the policies exist to withhold.

create view public.target_status
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
  -- "down the entire time" are different facts and the tile says so.
  day.uptime_pct   as uptime_24h,
  day.sample_count as checks_24h,
  week.uptime_pct  as uptime_7d,
  week.sample_count as checks_7d
from public.targets t

-- Newest check. LATERAL + LIMIT 1 lets Postgres walk the
-- (target_id, checked_at desc) index and stop at the first row.
left join lateral (
  select c.checked_at, c.status_code, c.response_ms, c.ok
  from public.checks c
  where c.target_id = t.id
  order by c.checked_at desc
  limit 1
) latest on true

left join lateral (
  select
    round(100.0 * count(*) filter (where c.ok) / nullif(count(*), 0), 2) as uptime_pct,
    count(*) as sample_count
  from public.checks c
  where c.target_id = t.id
    and c.checked_at > now() - interval '24 hours'
) day on true

left join lateral (
  select
    round(100.0 * count(*) filter (where c.ok) / nullif(count(*), 0), 2) as uptime_pct,
    count(*) as sample_count
  from public.checks c
  where c.target_id = t.id
    and c.checked_at > now() - interval '7 days'
) week on true;

comment on view public.target_status is
  'One row per target with its latest check and 24h/7d uptime. Runs as the caller (security_invoker), so RLS on targets and checks still applies.';
