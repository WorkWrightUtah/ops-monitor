# CLAUDE.md — WorkWright House Stack

## This project

- **Client:** WorkWright LLC (internal) · **Outcome flag:** Internal (WorkWright-owned) · **Domain:** `status.workwright.co`
- **What it is:** Checks WorkWright's live sites every five minutes and records uptime and response time. Raises one alert (email + Teams) when a site goes down and one notice when it comes back.
- **Project docs:** scope and data model in `docs/spec.md`; running decisions log in `docs/decisions.md`. Read them before structural changes; update `decisions.md` the same day a choice is made.

### This app's coordinates

| Piece | Value |
|---|---|
| Supabase project ref | `mgzhjwboinevltuwprxv` |
| Railway project | `ops-monitor` — two services: `web` (dashboard) and `checker` (cron, `*/5 * * * *`) |
| n8n workflow | [Ops Monitor — Alerts to Teams](https://workwright.app.n8n.cloud/workflow/lWBKekNRPrLacFzZ) |
| Cloudflare zone | `workwright.co` in **Ryan's** account (nameservers `elijah`/`sue`). A second, never-activated zone exists in Benson's account — records added there do not resolve. See `docs/decisions.md`. |

**One gotcha worth knowing before touching anything:** the checker is the only writer, and it uses
the `service_role` key, which bypasses RLS. The dashboard must keep reading as the signed-in user
so the team-only policies stay in force — never import `src/checker/supabase.ts` from `src/app/`.

Everything below is WorkWright house rules — identical in every repo. Change house rules only via PR to `workwrightutah/template`.

This file governs every WorkWright project. It lives in `workwrightutah/template` and every new project inherits it. If reality diverges from this file, fix the file the same day via PR to the template repo — not in a message, not in memory.

## Stack

- **Next.js** (App Router, TypeScript)
- **Supabase** — Postgres, auth, storage. One Supabase project per app. This app's project ref: `[SUPABASE_PROJECT_REF]`
- **Railway** — hosting. One Railway project per app. This app's project: `[RAILWAY_PROJECT_NAME]`
- **Resend** — transactional email. WorkWright's own apps send from `workwright.co`; client-facing apps send from the client's domain (see Outcome flags)
- **n8n** — cross-app automation. WorkWright workspace: `[N8N_WORKSPACE_URL]`
- **GitHub** — org `workwrightutah`. Repo naming: `workwrightutah/<client>-<tool>` for client builds, `workwrightutah/ops-<tool>` for internal.

## Commands

- `npm run dev` — local dev server
- `npm run build` — must pass before any push
- `npm run lint` — must pass before any push

## Workflow rules

1. **Never deploy uncommitted or unpushed work.** Before any Railway deploy, confirm `git status` is clean and the latest commit exists on `origin/main` (`git log origin/main -1`).
2. Run `npm run build` and `npm run lint` locally before pushing. If either fails, fix before pushing.
3. Solo projects work on `main`. The moment two builders touch a repo, switch to feature branches + PRs.
4. After any deploy, fetch the live URL and confirm it responds correctly before reporting success.

## Deploy runbook (exact order)

1. `npm run build` passes locally
2. Commit and push to GitHub `main`
3. Verify the push landed: `git log origin/main -1`
4. Deploy via the Railway MCP server (or `railway up`)
5. Open the deployment URL and confirm the page loads
6. Check deploy logs via Railway MCP for errors or warnings

## Secrets

- Environment variables live in **Railway service variables** — nowhere else
- Credentials live in **1Password** — nowhere else
- Never write secrets into code, commits, READMEs, logs, or prompts
- `.env.local` is gitignored; before every commit, confirm no env file is staged

## Database

- Schema changes only via migrations in `supabase/migrations/` — never ad-hoc edits to a production database
- Row Level Security enabled on every table before launch
- Every client app gets its own Supabase project; never share a database across clients

## Client-app ship checklist

Before any build leaves the shop:

- [ ] Auth wired (Supabase Auth) and tested with a non-admin account
- [ ] Error states handled — no raw stack traces shown to users
- [ ] Resend notification path tested end to end
- [ ] README written with this app's specific runbook (setup, deploy, rollback)
- [ ] If the app has an AI layer: list its model dependencies here and mark it **Shop-Kept**

## Outcome flags (set before the first commit)

Every project is flagged **A**, **B**, or **C** at the Walkthrough; the flag is recorded in the README and drives these rules:

- **A — Scale-out candidate** (may become a multi-tenant subscription product): tenancy from day one is mandatory. Every table carries `org_id`; RLS policies scope all access by org. Single-tenant today is just "one org." Stripe is added only when tenant #2 signs.
- **B — Owner-Kept** (client will host and maintain): run on the client's domain from day one; email sends from the client's domain via the client's own Resend account; automation lives in-app (cron, in-app notifications) — never in WorkWright's n8n; handoff = transfer the GitHub repo, Supabase project, and Railway project to client accounts, then rotate all secrets. If the app has an AI layer, the client gets their own Anthropic API key during the support window.
- **C — Shop-Kept** (WorkWright hosts for a monthly fee): dedicated Railway project, Supabase project, and (if AI layer) Anthropic API key per client so per-client costs are always legible; email sends from the client's domain, verified inside WorkWright's Resend account; n8n automation allowed.

**All flags:** `org_id` scoping is cheap insurance — apply it regardless of flag unless there's a reason not to.

## Voice

User-facing copy is plainspoken and specific — no hype, no jargon. WorkWright sounds like a company with a workbench, not a pitch deck.
