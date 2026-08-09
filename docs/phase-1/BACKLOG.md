# Phase 1 — backlog (deferred, not lost)

Items surfaced during Phase 1 work that we consciously chose not to do now.

| # | Item | Source | Notes |
|---|------|--------|-------|
| B1 | **Rebrand marketing / landing pages + strip Hostinger promo** | P1-1 | P1-1 was scoped to the in-app surface only. Landing page, README banners, and Hostinger promo still carry old branding. |
| B2 | **Invite links fall back to `wacrm.tech`** (the original author's domain) | P1-1 sweep | `src/app/api/account/invitations/route.ts` hard-defaults to `https://wacrm.tech` when no base-URL env is set. Set our production domain (OPS-3) so invite/join links point at us. Not surface text — an env/OPS fix. |
| B3 | **Native-Korean review of rebranded strings** | P1-1 | Name swapped in 6 ko strings with 3 particle fixes (으로→로, 이→가, 은→는) for the now-vowel-ending "ConnectsWA". A native speaker should confirm particle + spacing choices read naturally. |
| B4 | **Exact `#1A56DB` vs cobalt `#2563EB`** | P1-1 | We reused the tested "cobalt" theme instead of hand-rolling `#1A56DB`. If the exact hex matters, retune the cobalt tokens across light/dark/hover/soft. |
| B5 | **Real logo asset** | P1-1 | Currently a code-drawn mark (`<BrandMark>` + `icon.tsx`). Swap in a supplied SVG/PNG if/when brand assets are finalized (Open Decision #2). |
| B6 | **Unwind global `OPENAI_BASE_URL` OpenRouter override** | P1-8 | Before onboarding a client who needs real OpenAI or their own provider. See `P1-8-openrouter.md`. |
