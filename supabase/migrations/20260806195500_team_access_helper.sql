-- Team-access helper.
--
-- The dashboard is team-only (spec: "Auth gate"). Rather than a roles table,
-- membership is "your verified Supabase Auth email is on the workwright.co
-- domain". Every RLS policy in this schema calls this one function, so the
-- definition of "team" lives in exactly one place.
--
-- Line by line:
--   auth.jwt() ->> 'email'      the signed-in user's email, or NULL when anonymous
--   split_part(email, '@', 2)   the part after the first '@' -- an exact domain
--                               match, not a LIKE suffix, so an address such as
--                               attacker@notworkwright.co cannot sneak through
--   stable                      same answer for the whole statement, so Postgres
--                               may cache it per row-scan instead of re-parsing
--                               the JWT for every row
--
-- Deliberately NOT security definer: it reads only the caller's own JWT and
-- touches no tables, so it needs no elevated rights.

create or replace function public.is_team_member()
returns boolean
language sql
stable
set search_path = ''
as $$
  select split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2) = 'workwright.co';
$$;

comment on function public.is_team_member() is
  'True when the caller is signed in with a @workwright.co email. Single source of truth for the team-only gate.';
