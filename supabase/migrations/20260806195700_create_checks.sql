-- checks — one row per check, per target.
--
-- This table is the whole history: the dashboard's uptime percentages and
-- response-time chart read from it, and the alert logic derives a target's
-- "already alerting" state from its most recent rows rather than storing a
-- flag anywhere (see docs/decisions.md).

create table public.checks (
  id          bigint generated always as identity primary key,
  target_id   uuid        not null references public.targets (id) on delete cascade,
  checked_at  timestamptz not null default now(),

  -- NULL when the request never produced an HTTP response at all -- DNS
  -- failure, connection refused, timeout. Those are still failures, they just
  -- have no status code to record, and NULL says that honestly where 0 or 599
  -- would be a number we made up.
  status_code int,

  -- Wall-clock milliseconds from request start to response headers. Always
  -- recorded, including on failure, so a timeout shows up as a slow check
  -- rather than a hole in the chart.
  response_ms int not null check (response_ms >= 0),

  -- true when the target responded healthy (2xx or 3xx), false otherwise.
  ok          boolean     not null
);

comment on table  public.checks             is 'One row per check, per target. Append-only history behind the dashboard and the alert rules.';
comment on column public.checks.status_code is 'HTTP status returned, or NULL when no HTTP response arrived (DNS/refused/timeout).';
comment on column public.checks.response_ms is 'Milliseconds to first response byte. Recorded on failures too.';
comment on column public.checks.ok          is 'true when the target responded healthy; false otherwise. A false row is a failed check.';

-- Every read we make is "the newest rows for one target" -- the alert tail
-- check, the status tile, the 24h/7d windows, the chart. This index serves
-- all four.
create index checks_target_checked_at_idx
  on public.checks (target_id, checked_at desc);

-- RLS: on, and team-only, read-only.
--
-- There is deliberately no insert/update/delete policy. Nobody signing in
-- through the dashboard can write history; only the checker can, and it does
-- that with the service_role key, which bypasses RLS.
alter table public.checks enable row level security;

create policy checks_select_team
  on public.checks
  for select
  to authenticated
  using (public.is_team_member());
