> **SUPERSEDED — archived, not a build document.**
>
> Written 2026-08-09, before the P1-11 design was settled. The frozen design
> is [`claude-02-P1-11-embedded-signup.md`](../claude-02-P1-11-embedded-signup.md)
> (2026-08-10), and where the two disagree, claude-02 wins. Notably, claude-02
> scopes Embedded Signup to workspaces with **no** existing connection and
> removes manual→embedded migration entirely; these documents predate that.
>
> Kept for the reasoning, which is still worth reading. Do not build from it.

# Embedded Signup — Triangulated Implementation Recommendation (wacrm)

**Date:** 2026-08-09
**Sources triangulated:** Meta's current v4 docs (read directly, Aug 2026) · OpenBSP
source (read directly) · wacrm source (read directly).
**Relationship to existing docs:** this supersedes specific claims in
`embedded-signup-plan.md` (v5). Where they disagree, this file is the corrected
version — each disagreement is cited below.

---

## 0. Assumptions I'm making (correct me if wrong)

1. You are going the **Tech Provider** route under your own Meta app
   (`wacrm-test0`), not Solution Partner. This matters: Solution Partner has a
   different onboarding call sequence and requires a line of credit.
2. **Coexistence stays out of scope.** Nothing below covers
   `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, history sync, or `smb_app_data`.
3. One WhatsApp number per wacrm account, matching today's
   `UNIQUE(account_id)` + `UNIQUE(phone_number_id)`.
4. The manual paste-a-token form stays as a fallback (Meta test numbers can't
   go through ES).
5. You have **not yet created** the Facebook Login for Business configuration.
   If you already created it, §2.2 is urgent — the template choice is baked in.

---

## 1. What the three sources agree on (safe to build against)

The server-side onboarding sequence is settled. Meta's Tech Provider doc and
OpenBSP's `embedded_signup.ts` match step for step:

| # | Call | Meta doc | OpenBSP | wacrm today |
|---|------|----------|---------|-------------|
| 1 | `GET /oauth/access_token?client_id&client_secret&code` → business token | Step 1 | `getBusinessAccessToken` L20-37 | **missing — the only new Meta call** |
| 2 | `POST /{waba_id}/subscribed_apps` (Bearer business token) | Step 2 | `postSubscribeToWebhooks` L40-91, **throws** | `subscribeWabaToApp` exists, error is `console.warn` only |
| 3 | `POST /{phone_number_id}/register` `{messaging_product, pin}` | Step 3, **required**, "Set this value to a 6-digit number" | `postRegisterPhoneNumber` L94-122, constant `"123456"`, **throws** | `registerPhoneNumber` exists, already returns `alreadyRegistered` |
| 4 | `GET /{phone_number_id}` metadata | (implied) | `getPhoneNumber` L124-149 | `verifyPhoneNumber` exists |
| 5 | Persist token + ids | — | upsert L303-322 | `whatsapp_config` insert/update |

Frontend is equally settled: FB JS SDK → `FB.login({config_id, response_type:
'code', override_default_response_type: true, extras: {setup: {}}})`, plus a
`window.addEventListener('message', …)` that filters on
`origin.endsWith('facebook.com')` and `type === 'WA_EMBEDDED_SIGNUP'`.

**So the thesis in the existing plan holds: ~1 new Meta call + 1 new route +
frontend wiring.** The corrections below are about the details that will bite.

---

## 2. Corrections to `embedded-signup-plan.md` (v5)

### 2.1 CRITICAL — `/register` is required, not optional

Plan §3 step 7 says: *"Preferred: rely on the popup's registration and skip the
server `/register` entirely unless a probe shows it's needed."* Plan §4 row 8
echoes this.

**That is wrong.** Meta's Tech Provider onboarding page lists
`POST /{phone_number_id}/register` as **Step 3**, with `pin` marked
**Required**, and states plainly that the customer "will not be able to use
your app to access their WhatsApp assets or send and receive messages … until
you complete these steps." OpenBSP calls it unconditionally for every
non-coexistence flow and throws on failure.

**Do this instead:**

- Always call `/register` in the ES path with a **constant 6-digit PIN**
  (OpenBSP hardcodes `"123456"`; use a per-deployment env constant so you can
  change it without a code deploy).
- wacrm's `registerPhoneNumber` **already** handles the feared case:
  `meta-api.ts` matches `/already.*registered/i` and returns
  `{success: true, alreadyRegistered: true}` rather than throwing. The plan's
  worry ("PIN mismatch is a hard error, not idempotent") is already mitigated
  in the code it's worrying about.
- The genuine risk the plan identified is real but is in a *different* place:
  `config/route.ts:361-363` sets `status: 'disconnected'` and nulls
  `connected_at`/`registered_at` whenever `registrationError` is truthy. Do not
  reuse that branch. In the ES path a register failure after a successful
  subscribe should surface as "connected but not registered", never as a
  status downgrade of a live row.
- PIN storage: still **not needed**. Confirmed against OpenBSP (never stored)
  and Meta (the PIN is a value you set, not one you retrieve). Plan B3 stands.

### 2.2 CRITICAL — token expiry is a configuration decision you're about to make blind

Plan §7a and B4 conclude: store the business token, **no refresh logic needed**,
rely on a long-lived token.

Meta's implementation doc tells you to create your configuration from the
template named **"WhatsApp Embedded Signup Configuration With 60 Expiration
Token"** — i.e. the *recommended default template issues a token that expires
in 60 days.* Facebook Login for Business exposes token expiry as a config-level
setting (`set_token_expires_in_60_days`).

OpenBSP has no refresh logic, which means OpenBSP is relying on having picked a
non-expiring configuration — not on business tokens being inherently permanent.

**Decide explicitly, and write the decision down:**

- **Option A (simplest, recommended):** create a *custom* configuration with no
  token expiration. Then plan B4 is correct and you need no refresh job — just
  the "invalid token → needs reconnect" state as a safety net for revocation.
- **Option B:** use Meta's 60-day template. Then you **must** build token
  refresh or every client silently dies at day 60. This is a real background
  job, cron, and failure-surface — significantly more work.

If you already created the configuration from the template, you are on Option B
whether you meant to be or not. Check it before writing code.

### 2.3 CRITICAL — `account_update` webhook subscription is mandatory and absent from the plan

Meta's implementation doc, "Before you start": *"You must be subscribed to the
`account_update` webhook, as this webhook is triggered whenever a customer
successfully completes the Embedded Signup flow, and contains their business
information that you will need."*

The plan never mentions it. `src/app/api/whatsapp/webhook/route.ts` has no
`account_update` handling — it only dispatches `messages`, `statuses`, and
template fields.

Two reasons this matters beyond compliance:

1. It is your **recovery path for the 30-second code**. If the exchange fails
   (slow network, user's laptop sleeps, double-submit), `account_update` still
   tells you a WABA was onboarded. Without it, a failed exchange is
   unrecoverable except by making the user redo the whole popup.
2. It carries downstream lifecycle events (bans, verification changes,
   `PARTNER_APP_INSTALLED`/`REMOVED`) you'll want anyway.

Add it in the App Dashboard webhook fields **and** add a handler branch.

### 2.4 HIGH — the webhook verify-token change is a live-user regression risk

Plan §6 proposes adding a single app-level `WHATSAPP_VERIFY_TOKEN` to the GET
handshake, with keeping the per-config fallback as a "caveat."

Make the fallback **the design, not the caveat**. Current code
(`webhook/route.ts:118-165`) loops every `whatsapp_config` row, decrypts
`verify_token`, and compares. ES-onboarded accounts will have
`verify_token = NULL`, so they contribute nothing to that loop — and Meta only
handshakes the app-level callback URL. Correct order:

```
if (env.WHATSAPP_VERIFY_TOKEN && verifyToken === env.WHATSAPP_VERIFY_TOKEN) → challenge
else → existing per-config decrypt loop   // manual users unaffected
```

Never replace the loop. The handshake only fires on (re)subscription, so a
regression here is invisible until a re-verify months later.

### 2.5 MEDIUM — Meta's onboarding has a Step 5 the plan omits: payment method

Meta: *"Once your customer adds a payment method, they are fully onboarded …
and can begin using your app."* Until then sends fail with billing errors that
will look to your client like a wacrm bug.

Surface a post-connect checklist item in the UI with the deep link to
`https://business.facebook.com/wa/manage/home/`. Cheap; prevents your worst
support ticket.

### 2.6 MEDIUM — Track A checklist is missing two dashboard settings

Plan §2 step 1 lists Allowed Domains and the OAuth toggles. Meta's current doc
also requires:

- **Valid OAuth redirect URIs** populated (same domains), and
- the **"use Strict Mode for redirect URIs"** toggle set to Yes.

Missing either produces a popup that completes but returns nothing to your page
— the hardest ES failure to diagnose.

### 2.7 LOW — stale details in the plan's Appendix B (from OpenBSP's own drift)

- `sessionInfoVersion: '3'` — OpenBSP sets it; **Meta's current v4 sample code
  does not include it.** Keep it (harmless, historically required for the
  message events), but don't treat it as load-bearing if events fail.
- The CANCEL error payload field is **`error_code`**, not `error_id`. OpenBSP's
  `ErrorFlowData` type is stale. Plan B9 inherits the error.
- `event` can also be **`ERROR`**, `FINISH_OBO_MIGRATION`, or
  `FINISH_GRANT_ONLY_API_ACCESS`. Handle unknown events as "abandoned", don't
  throw.
- **Closing the popup on the final screen counts as SUCCESS**, not cancel. Do
  not wire "popup closed → treat as abandoned."
- Graph version: wacrm `meta-api.ts:12` is pinned `v21.0`; OpenBSP uses
  `v24.0`; Meta's current examples use `v25.0`. The plan's
  `META_GRAPH_VERSION` idea is right — do it, and bump deliberately (re-run
  `meta-api.test.ts`, `meta-api.media.test.ts`, `meta-api.resumable.test.ts`
  after).
- Deadline wording: Meta's banner says **v2** is deprecated Oct 15 2026 (v4
  released Oct 8 2025). The plan says "v2/v3". Immaterial to the build — you're
  building v4 — but don't quote "v3 dies" to anyone.

---

## 3. Recommended architecture — the actual "best way"

The plan's framing ("11-step reuse table") invites copy-pasting
`config/route.ts` into a second route. **Don't.** Two routes that must stay
behaviourally identical on encryption, duplicate-checking, and status
transitions will drift, and the drift will be silent.

**Extract the shared tail once, then write two thin entry points.**

```
src/lib/whatsapp/
  connect.ts            NEW  persistConnection() — dup check, encrypt, upsert,
                             status transitions. Single source of truth.
  embedded-signup.ts    NEW  runEmbeddedSignup() — exchange → subscribe →
                             register → metadata. Pure orchestration, no DB.
  meta-api.ts           EDIT + exchangeCodeForBusinessToken()
                             + META_GRAPH_VERSION from env

src/app/api/whatsapp/
  embedded-signup/route.ts  NEW  auth → resolve account → runEmbeddedSignup →
                                 persistConnection
  config/route.ts           EDIT  POST body → persistConnection (manual path)
  webhook/route.ts          EDIT  env verify token first; + account_update

src/app/api/meta/
  deauthorize/route.ts      NEW  signed_request → revoke + mark disconnected
  data-deletion/route.ts    NEW  signed_request → delete + return status URL

src/components/settings/
  whatsapp-config.tsx       EDIT  "Connect WhatsApp" primary; manual form
                                  demoted behind an "Advanced setup" disclosure

supabase/migrations/
  037_whatsapp_embedded_signup.sql  NEW
```

**Migration 037 — minimal but not zero.** The plan calls this "likely
optional"; it isn't, once you accept §2.2 and §2.3:

```sql
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS connection_state TEXT
      DEFAULT 'ok'                       -- 'ok' | 'needs_reconnect' | 'not_registered'
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,   -- null = non-expiring config
  ADD COLUMN IF NOT EXISTS signup_source TEXT DEFAULT 'manual', -- 'manual' | 'embedded_signup'
  ADD COLUMN IF NOT EXISTS business_id TEXT;
```

`status` stays as-is (`connected`/`disconnected`) so nothing existing breaks;
`connection_state` carries the new nuance the current UI can't express.

**Error semantics for the ES route** (this is where the plan's reuse table is
load-bearing and wrong in two rows):

| Step | On failure |
|------|-----------|
| exchange | **Fatal.** 400 `code_expired` → UI offers "Try again" and re-launches the popup. Do not save a row. |
| subscribed_apps | **Fatal.** Without it no webhooks arrive; a "success" here is a lie. Save nothing, return `subscribe_failed`. |
| register | **Non-fatal, non-downgrading.** Save the row, `connection_state='not_registered'`, surface a retry button. `alreadyRegistered` counts as success. |
| metadata | Non-fatal — save with what you have, backfill on next GET. |

**Frontend event/callback race.** `FB.login`'s callback and the `message` event
are independent and unordered. OpenBSP stashes the session info on
`window.__waSessionInfo` and reads it in the callback — fine in practice but
fragile if the callback lands first. Use a small promise that resolves when
*both* the code and the session info are present, with a ~10s guard, then POST.
Remember the 30-second TTL on the code — the exchange must be the first thing
your server does.

**CSP.** `next.config.ts:39-45` currently ships
`Content-Security-Policy-Report-Only` with `script-src 'self' 'unsafe-inline'
'unsafe-eval'`. Report-only means ES will work today, but add
`https://connect.facebook.net` (and `frame-src https://www.facebook.com`) now,
so flipping CSP to enforcing later doesn't break onboarding.

---

## 4. Build order

Track A (Meta dashboard, you) and Track B (code) genuinely parallelise, but two
Track A items **block** Track B testing:

**Blocking — do first:**

1. Decide token expiry (§2.2) and create the Facebook Login for Business
   configuration accordingly → gives you `NEXT_PUBLIC_META_CONFIG_ID`.
2. Client OAuth settings: Allowed Domains **and** Valid OAuth redirect URIs
   **and** Strict Mode (§2.6).
3. Subscribe the app to the `account_update` webhook field (§2.3).

**Non-blocking Track A (can run during/after the build):** Tech Provider
enrollment, business verification, Deauthorize + Data Deletion callback URLs,
App Review for Advanced Access on `whatsapp_business_management` +
`whatsapp_business_messaging`. Until App Review clears, only app admins/
developers/test users can complete the flow — which is exactly enough to build
and test.

**Track B, in dependency order:**

1. `META_GRAPH_VERSION` env + `exchangeCodeForBusinessToken` in `meta-api.ts`
   (+ tests).
2. Migration 037.
3. `connect.ts` extraction; refactor `config/route.ts` POST onto it — **ship and
   verify this alone first.** It's a pure refactor of a working path; if
   anything regresses you want it isolated from the new feature.
4. `embedded-signup.ts` orchestrator + unit tests with mocked fetch (the four
   calls, plus the four failure modes in the table above).
5. `/api/whatsapp/embedded-signup` route.
6. Webhook: env verify token first + `account_update` branch.
7. Frontend: SDK loader with `onerror` guard, Connect button, message listener,
   code+sessionInfo join, demote manual form.
8. Deauthorize + data-deletion routes.
9. Payment-method nudge in the post-connect UI.

**Regression guard to write before step 7:** a test asserting that an
already-registered number never ends up with `status='disconnected'`. That's the
one bug most likely to reach a paying client.

---

## 5. Where I'd push back on scope

- **Don't build token refresh unless you choose Option B in §2.2.** Pick the
  non-expiring config and delete an entire subsystem from the roadmap.
- **Don't add multi-number support now.** `UNIQUE(account_id)` is fine; the
  migration path to a `primary` flag is documented in 017 and the ES route
  doesn't make it harder.
- **Don't build the `connection_state` UI beyond three strings.** "Live",
  "Connected — finish setup", "Reconnect needed" covers every case above.
- **Do not skip step 3 of the build order** (the `connect.ts` refactor). It's
  the difference between one onboarding path and two that diverge.

---

## 6. Open questions for you

1. Which token-expiry configuration will you create (§2.2)? This is the single
   decision that most changes the amount of code.
2. Has the Facebook Login for Business configuration already been created? If
   yes, from which template?
3. Is `wacrm-test0` the app you'll ship on, or will production be a separate
   app? (Different App ID/Secret/Config ID, and App Review is per-app.)
4. Do you want the manual token form kept indefinitely, or removed once ES is
   approved? It's your only way to connect Meta *test* numbers, so I'd keep it.
