> **SUPERSEDED — archived, not a build document.**
>
> Written 2026-08-09, before the P1-11 design was settled. The frozen design
> is [`claude-02-P1-11-embedded-signup.md`](../claude-02-P1-11-embedded-signup.md)
> (2026-08-10), and where the two disagree, claude-02 wins. Notably, claude-02
> scopes Embedded Signup to workspaces with **no** existing connection and
> removes manual→embedded migration entirely; these documents predate that.
>
> Kept for the reasoning, which is still worth reading. Do not build from it.

# Reviewer Brief — Embedded Signup Plan (for an independent Opus 5 review)

**Purpose.** Have a fresh, skeptical reviewer stress-test
`embedded-signup-plan.md` *before* any code is written. Find errors, wrong
assumptions, security holes, and gaps. Do **not** rubber-stamp it.

**How to run it.** Give the reviewer: (1) this brief, (2) the plan
`embedded-signup-plan.md`, (3) read access to the three repos listed below.
Ask for the output format in the last section.

---

## 1. Context (what this is)

- **Product:** wacrm — a self-hostable, multi-tenant WhatsApp CRM
  (Next.js 16 + Supabase, RLS per `account_id`). Repo:
  `C:\Users\manis\Desktop\Claude\wacrm\wacrm`.
- **Goal of the plan:** add **standard WhatsApp Embedded Signup (v4)** so a
  business clicks "Connect WhatsApp," completes Meta's popup, and their WABA is
  linked to wacrm automatically — no pasted tokens.
- **Business model:** the operator (wacrm's owner) becomes their **own Meta
  Tech Provider** (for market trust / verified badge) and hosts wacrm; each
  client is an `account`; the client's team is invited under that account.

## 2. Scope lock (do NOT flag these as "missing" — they are deliberate)

- **In scope:** standard Embedded Signup for **new / Cloud-API numbers**, under
  **the operator's own Meta app**.
- **OUT of scope:** WhatsApp **coexistence** (existing Business-App numbers /
  QR / history sync). It was explicitly dropped; the local coexistence runbook
  is invalid.
- **OUT of scope (last-resort only, plan Appendix C):** routing customers
  through a third party's Meta app ("Tech-Provider-as-a-Service"). Rejected by
  the operator. Do not recommend it.

## 3. Reference material to read

**wacrm (the code being extended)** — verify every claim about it:
- `wacrm/src/app/api/whatsapp/config/route.ts` — the current manual-config POST
  the plan decomposes into an 11-step "reuse table."
- `wacrm/src/lib/whatsapp/meta-api.ts` — helpers `verifyPhoneNumber`,
  `registerPhoneNumber`, `subscribeWabaToApp` (check signatures + token needs).
- `wacrm/src/app/api/whatsapp/webhook/route.ts` — inbound routing + verify
  handshake.
- `wacrm/supabase/migrations/001_initial_schema.sql`, `015_*`,
  `017_account_sharing.sql` — schema, `whatsapp_config`, `UNIQUE(account_id)`,
  RLS/multi-tenant model.

**OpenBSP (a real registered Tech Provider — the ground-truth reference).**
Note the nested folder:
- API: `C:\Users\manis\Desktop\Claude\OpenBSP\open-bsp-api\open-bsp-api\supabase\functions\whatsapp-management\embedded_signup.ts`
  (+ `index.ts`, and `whatsapp-webhook/index.ts`).
- UI: `C:\Users\manis\Desktop\Claude\OpenBSP\open-bsp-ui\open-bsp-ui\src\contexts\WhatsAppIntegrationContext.tsx`.
- The plan's **Appendix B** claims to be "CONFIRMED from OpenBSP source" —
  independently verify those claims against these files.

## 4. What to verify (prioritized)

**A. Server-flow fidelity (highest priority).** Does the plan's sequence match
OpenBSP's real `embedded_signup.ts`? Specifically:
- Token exchange `GET /v24.0/oauth/access_token` (client_id/secret/code) → token.
- `subscribed_apps` is **blocking**.
- `/register` is called for new numbers with a set PIN (OpenBSP hardcodes
  `"123456"`, never stores it) and is **skipped** only for coexistence.
- Metadata `GET /{phone_number_id}` then persist.
Flag any step the plan gets wrong, out of order, or invents.

**B. Reuse-table accuracy.** For each of the 11 rows in plan §4, open
`config/route.ts` and confirm the "reuse / replace / partial" verdict is真.
Pay attention to row 8 (`registerPhoneNumber`) and row 9 (`subscribeWabaToApp`
error handling — currently non-fatal `console.warn`; plan says make it
blocking).

**C. PIN handling.** The plan (Appendix B3) says **no `pin` column / migration
is needed** because the PIN is a set constant. Is that safe for wacrm? Consider
re-connect / already-registered / 2FA-enabled-number cases. Recommend whether
wacrm should generate a random PIN vs hardcode, and whether it must be stored.

**D. Token model & security.** Plan §7a + B4: store the per-account business
token (encrypted) and call Cloud API with it; no refresh (rely on long-lived
token) + an "invalid → reconnect" state. Verify: is the token OpenBSP gets
actually long-lived, or does the chosen config template matter? Is there a
revocation/expiry path the plan misses? Is storing it in
`whatsapp_config.access_token` (AES-GCM) sound? Is `META_SYSTEM_USER_*` truly
unnecessary (plan B8) for the per-account path?

**E. Webhook & tenant isolation.** Plan §6 + B5: single app-level
`WHATSAPP_VERIFY_TOKEN`, inbound routed by `phone_number_id`, HMAC via
`X-Hub-Signature-256`. Confirm against wacrm's webhook that (a) this is correct,
(b) there's no regression for existing manual-config users, and (c) two clients
can't cross-read messages.

**F. Offboarding & compliance.** Plan §7d + B6: `deregister` + mark
disconnected; Deauthorize + Data Deletion callbacks. Is the offboarding
complete (token invalidation, subscription removal, data handling)? Anything
App-Review-blocking missing?

**G. Meta-side / App Review correctness (plan §2, §9).** Are the permissions
(`whatsapp_business_management`, `whatsapp_business_messaging`), the
Configuration-ID steps, Advanced Access requirement, and the Oct 15 2026 v4
deadline stated correctly? Flag anything Meta-side that would stall go-live.

**H. Anything missing entirely.** Rate limits, error/timeout on the 30-second
code, idempotency on double-submit, concurrent onboarding, the
`connection_state` flag, CSP allowance for `connect.facebook.net`, i18n, tests.

## 5. History (already reviewed once — don't re-litigate settled points)

A prior review already caught and the plan already fixed: the unsafe
`/register`+auto-PIN downgrade, non-blocking `subscribed_apps`, missing
token-revocation state, and missing deauthorize/data-deletion callbacks. The
plan was then re-verified against real OpenBSP code (which *simplified* the PIN
question — see §4C). Confirm these fixes are correct; only re-open one if you
find the current text is actually still wrong.

## 6. Output format

Return a prioritized report:
- **Critical** — factually wrong or would break the build (cite `file:line` or
  plan §).
- **Gaps** — important but missing.
- **Minor / nits.**
- **Confirmed correct** — brief.
For each item: the specific evidence (wacrm file/line, OpenBSP file/line, or
plan section) and a concrete recommended change. Stay within the scope lock
(§2) — do not propose coexistence or the as-a-service fork.
