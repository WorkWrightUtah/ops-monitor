# Decisions Log

> Append-only. Log any structural or scope choice the day it's made (CLAUDE.md rule).
> Newest at the top.

## [YYYY-MM-DD] — [decision in one line]
**Why:** [the reason / what it rules out]
**Revisit if:** [the condition that would reopen this]

---

*(Example — delete when the first real entry lands.)*

## 2026-01-01 — Supabase Auth via email magic links, not passwords
**Why:** fewer credentials to manage for a small user base; no password-reset flow to build.
**Revisit if:** the client requires SSO or password login.
