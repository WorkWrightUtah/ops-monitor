# Spec — [CLIENT_NAME] [TOOL]

> Source of truth for scope and data model. Written from the signed SOW before build
> hours start; Ryan reviews before the first migration. When scope changes, this file
> changes the same day.

## 1. What & who
- **Outcome flag:** [A / B / C]
- **Users / roles:** [who signs in and what each can do]
- **Problem it replaces:** [the spreadsheet / manual process / old tool]
- **Definition of done (v1):** [the shortest list that makes this shippable]

## 2. Features (v1 scope)
- [ ] [Feature — one checkable line each]
- [ ] ...

**Explicitly out of scope for v1:**
- [thing we are NOT building yet]

## 3. Data model
> Every table carries `org_id`; RLS scopes all access by org (see CLAUDE.md). Schema
> changes only via `supabase/migrations/`.

| Table | Columns | Notes |
|---|---|---|
| `orgs` | id, name, created_at | tenant root |
| `[table]` | id, org_id, ... | [purpose] |

## 4. Business rules
- [A rule the code must enforce — e.g. "a quote can't be sent without a line item"]

## 5. Integrations
- **Auth:** Supabase Auth — [providers: email magic link / password / OAuth]
- **Email (Resend):** [what triggers a send, to whom, from which domain]
- **Automation (n8n):** [cross-app flows — flags A/C only; flag B keeps automation in-app]
