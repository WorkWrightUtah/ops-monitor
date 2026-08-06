# Supabase

One Supabase project per app (house rule). This app's project ref is recorded in `CLAUDE.md`.

## Migrations

Schema changes go here as timestamped SQL files — **never hand-edit a production database.**

```bash
# with the Supabase CLI:
supabase migration new <name>   # creates supabase/migrations/<timestamp>_<name>.sql
supabase db push                # apply to the linked project
```

- **RLS is enabled on every table before launch.** Every table carries `org_id`; policies scope all access by org.
- Migrations are committed to git so the schema history travels with the repo.
