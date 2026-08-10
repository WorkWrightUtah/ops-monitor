-- One row per URL.
--
-- Adding targets moved from SQL to a form on the dashboard, which makes
-- "paste the same site twice" an easy accident rather than a deliberate one.
-- Two rows for one URL means two checks every five minutes and two alerts when
-- it goes down, with no way to tell from an inbox that they are the same site.
--
-- The form normalises URLs before insert (scheme added, host lowercased by the
-- URL parser), so an exact-match index catches the realistic duplicates. It is
-- deliberately not lower(url) in full: hostnames are case-insensitive but paths
-- are not, and /Status and /status may genuinely be different pages.

create unique index targets_url_key on public.targets (url);

comment on index public.targets_url_key is 'One target per URL — the add-target form relies on this to reject duplicates.';
