-- Fix the deliberately-broken seed target so it is actually broken.
--
-- It pointed at https://status.workwright.co/deliberately-broken. That worked
-- as a failure only while the domain did not resolve. Once the app went live,
-- the auth proxy started redirecting that path to /login, which returns 200 —
-- and because the checker follows redirects, the "broken" target reported as
-- healthy. The one target whose entire job is to fail had quietly stopped
-- failing, and the alert acceptance test would have passed for the wrong
-- reason or not fired at all.
--
-- /status/* is public in the proxy (it is the health check), so a missing path
-- underneath it is not redirected and Next returns a real 404. Verified:
--
--   /deliberately-broken         -> 200 after 1 redirect   (useless as a test)
--   /status/deliberately-broken  -> 404, no redirects      (correct)
--
-- The spec asks for "a deliberately broken URL (a 404 route)". This is that,
-- and it stays a 404 whether or not anyone is signed in.

update public.targets
set url = 'https://status.workwright.co/status/deliberately-broken'
where name = 'Broken route (alert test)';
