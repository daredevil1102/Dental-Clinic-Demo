# Phase 1 — engineering workflow & index

This folder is the source of truth for how Phase 1 work gets planned, built,
and reviewed. One doc per feature, written **before** code. Keep docs short;
the point is shared understanding and a task list, not ceremony.

## The loop (every feature)

1. **Spec** — write/extend the feature's doc from `TEMPLATE.md`. Status `Draft`.
2. **Approve** — Manish reviews the doc. Status → `Approved`. No code before this.
3. **Implement** — on a sub-branch off `phase-1`: `feat/<ref>-<slug>`
   (e.g. `feat/p1-7-pwa`). Status → `In progress`.
4. **Verify** — `npm run typecheck && npm run lint && npm test`, plus the
   feature's own acceptance checks. Nothing merges red.
5. **Review** — self-review diff + Manish review. Status → `In review`.
6. **Merge** — squash-merge the sub-branch into `phase-1`. Status → `Done`.

`main` and the `baseline-pilot` tag stay frozen. Everything lands on `phase-1`.

## Hard rule for this repo

Per `AGENTS.md`, this is a **modified Next.js**. Before writing any Next-facing
code (manifest, routing, metadata, server actions), read the relevant guide in
`node_modules/next/dist/docs/`. Training-data assumptions may be wrong here.

## Status vocabulary

`Draft` → `Approved` → `In progress` → `In review` → `Done` (or `Deferred`).

## Index

| Ref   | Feature                                                        | Doc                                                                                    | Status                                 | Effort                        |
| ----- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------- |
| P1-1  | Rebrand (in-app surface)                                       | [P1-1-rebrand.md](P1-1-rebrand.md)                                                     | Draft                                  | ~0.5 day                      |
| P1-2  | Controlled onboarding                                          | _tbd_                                                                                  | —                                      | ~1–3 d                        |
| P1-3  | Plan setting per workspace                                     | _tbd_                                                                                  | —                                      | ~2–3 d                        |
| P1-4  | Feature-gating                                                 | _tbd_                                                                                  | —                                      | ~2–4 d                        |
| P1-5  | AI usage cap enforcement                                       | _tbd_                                                                                  | —                                      | ~2–4 d                        |
| P1-6  | Manual billing (process)                                       | _tbd_                                                                                  | —                                      | ~2 d                          |
| P1-7  | PWA Level 1                                                    | [P1-7-pwa.md](P1-7-pwa.md)                                                             | Draft                                  | ~0.5 day                      |
| P1-8  | OpenRouter provider                                            | [P1-8-openrouter.md](P1-8-openrouter.md)                                               | **Deferred**                           | —                             |
| P1-9  | n8n wiring (wacrm side)                                        | _tbd_                                                                                  | —                                      | ~2–5 d                        |
| —     | **Architecture overview — read before P1-10/P1-11**             | [claude-00-architecture-overview.md](claude-00-architecture-overview.md)                | Draft                                  | —                             |
| P1-10 | Per-client App Secret + two bug fixes                           | [claude-01-P1-10-manual-onboarding.md](claude-01-P1-10-manual-onboarding.md)            | Draft                                  | ~1–2 d                        |
| P1-11 | Embedded Signup on the ConnectsWA provider app                  | [claude-02-P1-11-embedded-signup.md](claude-02-P1-11-embedded-signup.md)                | Draft                                  | ~4–6 d + Meta review/UAT      |
| —     | Meta dashboard checklist (Manish, not code)                     | [claude-03-meta-dashboard-checklist.md](claude-03-meta-dashboard-checklist.md)          | Draft                                  | —                             |
| —     | _Archived:_ rejected alternatives (do not re-propose)           | [archive/rejected-alternatives.md](archive/rejected-alternatives.md)                    | Archived                               | —                             |
| —     | _Archived:_ full multi-app architecture                         | [archive/P1-10-full-multi-app-architecture.md](archive/P1-10-full-multi-app-architecture.md) | Archived                          | ~5–8 d                        |
| —     | _Archived:_ full provider + migration subsystem                 | [archive/P1-11-full-provider-and-migration.md](archive/P1-11-full-provider-and-migration.md) | Archived                     | ~6–10 d                       |

**Testing:** [TEST-PLAN.md](TEST-PLAN.md) — follow-along functionality + UAT
tests (currently P1-1, P1-7, P1-10 and P1-11). **Backlog:** [BACKLOG.md](BACKLOG.md).

## WhatsApp delivery stages

**Read `claude-00-architecture-overview.md` first.** It defines the system model,
the invariants, the environments and the deploy mechanics that both build specs
assume.

1. **claude-01 / `feat/p1-10-per-client-app-secret`** — ~1–2 days. One encrypted
   `app_secret` column, per-tenant secret selection in the existing webhook route,
   `processWebhook` extracted to `src/lib/whatsapp/`, and the two
   `config/route.ts` bugs fixed (live-connection downgrade on re-save; silently
   swallowed WABA subscription failure). One shared callback URL is retained.
   **Ships to production immediately — this is what goes to market.**
2. **claude-02 / `feat/p1-11-embedded-signup`** — ~4–6 days, built afterwards on
   its own branch. One ConnectsWA-owned provider app, Embedded Signup, the
   provider webhook route, Meta's required callbacks, and the `persistConnection`
   extraction. Developed locally against a **separate sandbox Supabase project**
   and the existing ngrok domain. Ships to production **switched off**, is
   demonstrated in Meta's development mode, recorded, and submitted for App
   Review. The Connect button is enabled only after approval.

**One repo, one production system.** One Hostinger deployment, one database, one
domain. Branches are bookmarks in the same repo, not separate systems. The only
separate thing is a free sandbox Supabase project used while developing, so a
mistake cannot reach a paying client.

Meta's App Review requires a **screen recording of the working flow**, so
claude-02's code must be complete and demonstrable before submission. Development
mode lets anyone with an App Role complete the flow, which is exactly enough to
build, test and record.

Migration of existing clients is **out of scope — removed, not deferred.**
Embedded Signup is reachable only by a workspace with no WhatsApp connection; a
connected workspace gets a 409 and never sees the button. The reasoning lives in
one place: [claude-02 §5.3.1](claude-02-P1-11-embedded-signup.md).

A future client-requested move is its own spec, with its own Meta rehearsal and
rollback plan, per `CODEX-SDD-WA-001` §5.4.

## Governing architecture — `docs/architecture/`

These phase-1 specs are the **implementation plan** for an approved architecture
that lives elsewhere in the repo:

| Doc | ID | Status |
| --- | --- | --- |
| [ADR 001 — one product, two onboarding methods](../architecture/decisions/codex-adr-001-one-product-two-onboarding-methods.md) | `CODEX-ADR-001` | Accepted |
| [Unified system design](../architecture/codex-unified-whatsapp-onboarding-system-design.md) | `CODEX-SDD-WA-001` | Final review required |
| [Rollout and acceptance](../architecture/codex-whatsapp-onboarding-rollout-and-acceptance.md) | `CODEX-RAS-WA-001` | Final review required |
| [Index and precedence](../architecture/codex-whatsapp-onboarding-documentation-index.md) | `CODEX-DOC-WA-001` | — |

**Precedence:** the `codex-` set governs business scope, architectural
guardrails and release gates. `claude-00`–`claude-03` govern implementation
detail. Where they conflict, codex wins and the claude doc is wrong — with two
recorded exceptions, both scale-appropriate and both documented in `claude-00`:
no private staging deployment (§4) and no formal release evidence package (§7).

Source requirements: `../../../wacrm-features-requirements.md` (currently outside
the repo; see freeze runbook note about un-versioned parent-folder files).
