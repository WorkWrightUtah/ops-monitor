-- targets.alerting — "we have already told someone this target is down."
--
-- The original design derived alert state from the tail of `checks`: fire when
-- the run of consecutive failures hits two, stay quiet above that. That works
-- for the down and recovery paths, but it cannot satisfy the spec's acceptance
-- test, which says deactivating an alerting target must produce exactly one
-- recovery notice.
--
-- Deactivating a target stops the checker writing rows for it. So:
--   * no "first successful check" ever arrives, and the derived design would
--     send no recovery at all; and
--   * because the tail then never changes, any notice keyed off that frozen
--     tail would re-send every five minutes, violating "no repeats".
--
-- One boolean fixes both. It is the smallest piece of state that answers the
-- only question the history cannot: have we already sent the notice?
--
-- The two-consecutive-failure rule still comes from `checks` — this column
-- carries no count, only whether a notice is outstanding.

alter table public.targets
  add column alerting boolean not null default false;

comment on column public.targets.alerting is
  'True between sending an outage alert and sending its recovery notice. Prevents repeat alerts while a target stays down, and lets a deactivation still close out an open alert.';

-- The checker asks "which targets have an open alert?" every run, including
-- inactive ones, so this cannot ride on targets_active_idx.
create index targets_alerting_idx on public.targets (alerting) where alerting;
