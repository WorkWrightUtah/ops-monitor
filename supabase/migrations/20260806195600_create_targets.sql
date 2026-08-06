-- targets — the things we watch.
--
-- Columns are exactly the three the spec names (name, url, active) plus a
-- surrogate key and created_at. No org_id: see docs/decisions.md
-- "No org_id on targets/checks" for why this internal tool is the documented
-- exception to the house default.

create table public.targets (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null,
  url        text        not null,
  active     boolean     not null default true,
  created_at timestamptz not null default now(),

  -- We only ever issue plain HTTP GETs. Refusing anything else here means a
  -- typo'd or hostile row can't talk the checker into a different protocol.
  constraint targets_url_is_http check (url ~* '^https?://')
);

comment on table  public.targets       is 'WorkWright properties the checker polls. Only active rows are checked.';
comment on column public.targets.url   is 'The URL the checker GETs. Must be http(s).';
comment on column public.targets.active is 'Only active targets are checked. The broken seed target sits inactive except when testing alerts.';

-- The checker asks "which targets are active?" every five minutes forever.
create index targets_active_idx on public.targets (active) where active;

-- RLS: on, and team-only.
--
-- Enabling RLS with no policy denies everyone by default; the policies below
-- open exactly the doors we want. The checker does NOT rely on these -- it
-- connects with the service_role key, which bypasses RLS entirely.
alter table public.targets enable row level security;

-- Team members read every target.
create policy targets_select_team
  on public.targets
  for select
  to authenticated
  using (public.is_team_member());

-- Team members manage targets, which is how a new site gets added (see the
-- README runbook). `with check` guards the post-write row, so a team member
-- cannot insert or rename a row into something they couldn't have read.
create policy targets_insert_team
  on public.targets
  for insert
  to authenticated
  with check (public.is_team_member());

create policy targets_update_team
  on public.targets
  for update
  to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

create policy targets_delete_team
  on public.targets
  for delete
  to authenticated
  using (public.is_team_member());
