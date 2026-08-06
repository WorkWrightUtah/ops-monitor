# [CLIENT] — [Tool]

A WorkWright House Stack app (Next.js · Supabase · Railway · Resend), scaffolded from
[`workwrightutah/template`](https://github.com/workwrightutah/template). House rules are in
[`CLAUDE.md`](./CLAUDE.md); scope in [`docs/spec.md`](./docs/spec.md); running decisions in
[`docs/decisions.md`](./docs/decisions.md).

**Outcome flag:** [A / B / C] · **Domain:** [APP_DOMAIN]

## Stack
- **Next.js** — App Router, TypeScript, Tailwind. App code in `src/`.
- **Supabase** — Postgres, Auth, Storage. Client helpers in `src/lib/supabase/`; migrations in `supabase/migrations/`.
- **Railway** — hosting. Config in `railway.json`.
- **Resend** — transactional email.

## Local setup
```bash
npm install
cp .env.local.example .env.local   # fill from the Supabase dashboard + 1Password
npm run dev                        # http://localhost:3000
```
Health check: [`/status`](http://localhost:3000/status) reports app liveness and env wiring.

## Before every push (house rule)
```bash
npm run build   # must pass
npm run lint    # must pass
```

## Deploy runbook (exact order)
1. `npm run build` passes locally
2. Commit and push to GitHub `main`
3. Confirm the push landed: `git log origin/main -1`
4. Deploy via the Railway MCP (or `railway up`)
5. Open the deploy URL and confirm it loads (check `/status`)
6. Read the Railway deploy logs for errors or warnings

## Rollback
- **App:** Railway keeps every build. Service → Deployments → last-good deploy → **Redeploy** (or via the Railway MCP).
- **Database:** never hand-edit production. Roll forward with a new migration in `supabase/migrations/`.

## Secrets
Environment variables live in **Railway service variables**; credentials live in **1Password**.
`.env.local` is gitignored — never commit real values (house rule).

## Structure
```
src/app/              routes (App Router)
src/app/status/       health check
src/lib/supabase/     server + browser clients
supabase/migrations/  SQL migrations (RLS on every table before launch)
docs/                 spec.md, decisions.md
railway.json          Railway build + deploy config
```
