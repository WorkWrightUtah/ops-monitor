-- Index checks by time alone, for the dashboard's cross-target range scan.
--
-- checks_target_checked_at_idx is (target_id, checked_at desc), which serves
-- every per-target read: the alert tail, the status tile, the uptime windows.
-- It does not serve the dashboard's other query, which asks for the last 24
-- hours across *all* targets at once to build the charts. With target_id as
-- the leading column, that range filter cannot seek — it degenerates into a
-- scan that grows with total history.
--
-- At three targets and 288 checks a day this is invisible. At a year of
-- history it is ~315k rows scanned to render a page. Cheap to prevent now,
-- annoying to diagnose later when the dashboard is mysteriously slow.

create index checks_checked_at_idx on public.checks (checked_at desc);

comment on index public.checks_checked_at_idx is
  'Serves the dashboard 24h window across all targets. Per-target reads use checks_target_checked_at_idx instead.';
