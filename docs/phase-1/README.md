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

| Ref | Feature | Doc | Status | Effort |
|-----|---------|-----|--------|--------|
| P1-1 | Rebrand (in-app surface) | [P1-1-rebrand.md](P1-1-rebrand.md) | Draft | ~0.5 day |
| P1-2 | Controlled onboarding | _tbd_ | — | ~1–3 d |
| P1-3 | Plan setting per workspace | _tbd_ | — | ~2–3 d |
| P1-4 | Feature-gating | _tbd_ | — | ~2–4 d |
| P1-5 | AI usage cap enforcement | _tbd_ | — | ~2–4 d |
| P1-6 | Manual billing (process) | _tbd_ | — | ~2 d |
| P1-7 | PWA Level 1 | [P1-7-pwa.md](P1-7-pwa.md) | Draft | ~0.5 day |
| P1-8 | OpenRouter provider | [P1-8-openrouter.md](P1-8-openrouter.md) | **Deferred** | — |
| P1-9 | n8n wiring (wacrm side) | _tbd_ | — | ~2–5 d |
| P1-10 | Manual WhatsApp onboarding | _tbd_ | — | ~1–2 d |

Source requirements: `../../../wacrm-features-requirements.md` (currently outside
the repo; see freeze runbook note about un-versioned parent-folder files).
