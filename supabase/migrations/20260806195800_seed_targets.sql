-- Seed targets (spec: "Seed targets").
--
-- All three land inactive on purpose:
--
--   workwright.co          the spec says "once it's live" -- as of this
--                          migration the name does not resolve yet. Flip it
--                          active the day the marketing site ships.
--   status.workwright.co   the monitor watching itself. Flip it active at the
--                          end of Phase 5, once the CNAME resolves and SSL is
--                          valid. Active-before-live would just page us about
--                          a site we hadn't deployed.
--   deliberately broken    a 404 route on our own domain, kept inactive except
--                          when testing the alert path (spec).
--
-- Idempotent on url so re-running against a database that already has these
-- rows is a no-op rather than a duplicate.

insert into public.targets (name, url, active) values
  ('WorkWright marketing site', 'https://workwright.co',                             false),
  ('Ops Monitor (self)',        'https://status.workwright.co',                      false),
  ('Broken route (alert test)', 'https://status.workwright.co/deliberately-broken',  false)
on conflict do nothing;

-- One target per URL, so the seed above can't double up and the checker can't
-- be pointed at the same site twice under two names.
create unique index if not exists targets_url_key on public.targets (url);
