-- Fix: match the email domain case-insensitively.
--
-- Found by testing the gate against candidate identities before wiring any UI:
-- 'Ryan@WorkWright.co' failed a check that 'ryan@workwright.co' passed. Supabase
-- does not guarantee the JWT's email claim is lowercased, so a team member who
-- signed up with a capitalized address would have been locked out of their own
-- dashboard -- and the failure mode is silent, because RLS returns an empty
-- result rather than an error.
--
-- lower() before split_part, so both the local part and the domain are folded.
-- The exact-match-on-domain behaviour is unchanged: attacker@notworkwright.co
-- and attacker@workwright.co.evil.com are still rejected.

create or replace function public.is_team_member()
returns boolean
language sql
stable
set search_path = ''
as $$
  select split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 2) = 'workwright.co';
$$;
