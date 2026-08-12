# claude-02 (P1-11) — Embedded Signup on the ConnectsWA provider app

- **Status:** Draft
- **Effort:** ~4–6 engineering days. Meta's App Review is the long pole, not the code.
- **Branch:** `feat/p1-11-embedded-signup`
- **Last updated:** 2026-08-10
- **Prerequisite reading:** `claude-00`, then `claude-01`
- **Depends on:** claude-01 merged and deployed — its column, its
  `process-webhook.ts` / `resolve-connection.ts`, its explicit-secret helper
- **Meta-side prerequisite:** `claude-03` items 1–4
- **Implements:** `CODEX-ADR-001`, `CODEX-SDD-WA-001` §14 Phases B–C
- **Gated by:** `CODEX-RAS-WA-001` Stages 2–4
- **Acceptance criteria:** `TEST-PLAN.md` §5B.8 (canonical — not restated here)

> **Scope discipline.** Embedded Signup, **for workspaces with no WhatsApp
> connection.** No attempts table, no intent flag, no migration route, no
> transactional swap, no credential snapshot, no "assisted provider" path. The
> version that had them is `archive/P1-11-full-provider-and-migration.md`.
>
> **Migrating an existing `manual` client is out of scope — removed, not
> deferred.** Unreachable at the API (§6 step 3) and in the UI (§8). **§5.3.1
> holds the reasoning; link to it rather than repeating it.**

---

## 1. What this adds

A client **whose workspace has no WhatsApp connection** clicks **Connect
WhatsApp**, completes Meta's popup, and is live. Meta returns a one-time code
plus their WABA ID and phone number ID; the server exchanges it for a token
scoped to the ConnectsWA provider app. The client never creates a Meta app,
never generates a token, never sees an App Secret, and we never hold one.

That qualifier is the whole boundary of this release.

Nothing Embedded Signup-related exists in the repo yet: no `oauth/access_token`
call, no `connect.facebook.net` reference, no deauthorize or data-deletion route,
no `account_update` handling.

**Out of scope, explicitly:** any manual-to-embedded migration or replacement of
an existing connection (§5.3.1); coexistence
(`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, WhatsApp Business app numbers, QR
onboarding, `smb_app_data` sync — do **not** implement `featureType`); token
refresh (avoided by §7); multi-number per account; the Solution Partner path;
removing the manual form.

## 2. Environments and how this ships

Built locally against the **sandbox Supabase project** and the existing static
ngrok domain. Never developed against the production database.

**On one Meta app throughout** — the final provider app, created at `claude-03`
item 1 before any code is written. Not the app currently wired to ngrok, and not
swapped later: App Review needs a recording of the flow on the app being
submitted. Only the URLs change between development and production.

Meta's **development mode** lets anyone with an App Role complete the entire
flow — popup, exchange, webhooks, messaging — which is enough to build, test and
record. The feature ships to production **switched off** and is enabled later by
setting environment variables and rebuilding (`claude-00` §5).

## 3. Data model

`supabase/migrations/038_whatsapp_config_connection_method.sql`

```sql
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS connection_method TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS business_id TEXT;
-- guarded CHECK: connection_method IN ('manual','embedded')
```

`connection_method` records which Meta app a connection lives under, which
decides how its webhooks are verified. The default backfills every existing row
as `manual` — no data migration, and old code ignores the column, which is what
makes §14's staged deploy safe.

`business_id` is an optional operational reference Meta returns from the popup.
Store it if present; it is what Meta support asks for.

`app_secret` and `verify_token` stay `NULL` on `embedded` rows — they verify
against the deployment's provider secret. **This is what forces §4.1's fallback
narrowing:** after this migration, `app_secret IS NULL` no longer implies
"manual connection awaiting its secret."

No `token_expires_at`: §7 chooses the non-expiring configuration.

## 4. Provider webhook route

**New:** `src/app/api/whatsapp/webhook/provider/route.ts`

The provider app is a different Meta app with its own dashboard, so it gets its
own callback URL — no tenant lookup is needed before *verification*.

- **GET** — timing-safe compare against `WHATSAPP_PROVIDER_VERIFY_TOKEN`. One env
  value, no database access.
- **POST** — see §4.0.

### 4.0 The POST contract — verify globally, resolve per change

**Use claude-01 §4.4.1's contract exactly.** The unit of work is a **change**,
not an entry and not a body — `metadata.phone_number_id` lives on the change.

The asymmetry: on the manual route, resolving a connection is *how you choose the
secret*, so it precedes verification. Here the secret is a single env value, so
verification comes first — but the workspace still must be resolved before
anything is processed. **One provider app serves every embedded client; a valid
provider signature says "Meta sent this," not "this belongs to workspace X."**

1. Read the untouched raw body. Verify `X-Hub-Signature-256` against
   `META_PROVIDER_APP_SECRET` with claude-01's explicit-secret helper. Fail →
   401, no parse, no side effect.
2. Parse only after the signature passes.
3. For each entry, **for each change**, call
   `resolveConnectionForChange(entry, change)` — claude-01 §4.4.1's shared
   helper, which already applies claude-01 §4.1.1's ordering and exactly-one-row
   rule. (This document's own §4.1 is a different thing.)
4. Additionally require `config.connection_method === 'embedded'`. A provider
   payload resolving to a `manual` row is a misconfiguration, not a routing hint
   — reject the change and log the mismatch.
5. Call `processWebhookChange(change, config)` per resolved change.
6. **Skip unresolved or mismatched changes individually** — log and continue.
   Unlike step 1, one bad change must not fail the delivery: Meta batches
   changes, and a non-200 would make it retry the good ones too.

Write no second resolver. If claude-01 landed §4.4.1 correctly, this route is a
signature check plus a loop.

**Do not add a provider branch to the claude-01 webhook route** — by then it
serves paying clients. The provider route never reads a client App Secret; the
manual route never reads provider env vars. Both fail closed.

### 4.1 Narrow claude-01's env fallback — required, easy to miss

claude-01 §4.1 step 3 falls back to `process.env.META_APP_SECRET` when
`app_secret` is NULL. Migration 038 breaks the assumption behind that: every
`embedded` row is NULL by design, so an embedded payload arriving at the *manual*
route would take the env branch. It still fails closed — the HMAC won't match a
different app's secret — but "fails closed by coincidence" isn't "refuses by
design," and the next reader can't tell which was intended.

```
app_secret set                                   → use it
app_secret NULL and connection_method = 'manual' → META_APP_SECRET
otherwise (embedded, or unknown method)          → 401, log the mismatch
```

An `embedded` row hitting the manual callback URL means a Meta-side
misconfiguration — most likely both apps subscribed to one WABA, which the
Appendix confirms is possible. Say so in the log rather than returning a 401 that
looks like a bad signature.

### `account_update`

Meta **requires** subscription to this field. Add a branch in
`process-webhook.ts`:

- Record the sanitized event against the WABA.
- Map `PARTNER_APP_UNINSTALLED` → mark that connection disconnected (§9.1).
- Do not throw on unknown event types.

Operationally this is the recovery signal when a 30-second exchange fails —
without it, "the popup worked but my server didn't" is indistinguishable from
"the popup failed."

## 5. Server flow

### 5.1 New Meta call

Add to `src/lib/whatsapp/meta-api.ts`:

```ts
export async function exchangeCodeForBusinessToken(args: { code: string }):
  Promise<{ accessToken: string; expiresIn: number | null }>
```

`GET {BASE}/oauth/access_token?client_id=&client_secret=&code=` — a plain GET,
no body, no `Authorization` header. Reads the provider App ID (from the public
var) and `META_PROVIDER_APP_SECRET`. Use the existing `throwMetaError` pattern.
**Never log the code or the token.**

### 5.2 Orchestrator

**New:** `src/lib/whatsapp/embedded-signup.ts` — pure orchestration. No Supabase
or `next/server` imports, so it unit-tests against a mocked `fetch`.

```
1. exchangeCodeForBusinessToken({ code })
     ⚠ The code expires in 30 SECONDS.
       Authenticate and authorize first (§6 steps 1–4 — cheap, and you must
       never exchange a code for an unauthenticated caller), then exchange
       IMMEDIATELY. Nothing slow, and no other Meta call, may precede it.
     Capture expires_in (absent = non-expiring).

2. subscribeWabaToApp({ wabaId, accessToken })            [existing helper]
     FATAL on failure. Without it Meta never delivers anything.
     Differs from the manual path, where it is deliberately non-fatal.

3. registerPhoneNumber({ phoneNumberId, accessToken, pin }) [existing helper]
     NON-FATAL to the SAVE, but NOT to the STATUS. Catch → record the error,
     continue, persist as `disconnected` (§5.3.2).
     "already registered" already counts as success in the helper.

4. verifyPhoneNumber({ phoneNumberId, accessToken })       [existing helper]
     NON-FATAL. On failure use a minimal stub; the config GET backfills later.
```

`/register` is mandatory per Meta's Tech Provider onboarding — `pin` is Required
and customers cannot send or receive until it completes. The PIN is a value we
set, never one we retrieve, so it is not stored.

### 5.3 The two persistence rules

1. **Write nothing until step 2 succeeds.** If exchange or subscribe fails,
   nothing is persisted and there is nothing to undo.
2. **Never write over an existing connection row.** If the account already has a
   `whatsapp_config` row — any `connection_method`, any `status` — the request is
   rejected at §6 step 3 and never reaches persistence. Embedded Signup only ever
   *creates* a connection for an account that has none.

**Do not carry forward claude-01's no-downgrade guard here.** It protects a
*previously working* connection from a transient error. Rule 2 means Embedded
Signup never touches one, so the guard would only mislabel a broken new
connection (§5.3.2).

### 5.3.1 Why rule 2 is a hard stop

Overwriting an existing connection — even behind a confirmation flag — was
proposed, examined and **rejected**: the commit point falls between a fatal
subscribe and a non-fatal register, so the realistic failure leaves a live client
with replaced credentials, an unregistered number, and a row still reading
`connected`. Full trace in
[`archive/rejected-alternatives.md`](archive/rejected-alternatives.md) §1.

`CODEX-ADR-001` §Guardrails: *"never automatically prompt or force a healthy
manual client to reconnect."* Do not reintroduce this under any name.

### 5.3.2 A registration failure is `disconnected`, not `connected`

Until `/register` completes the customer **cannot send or receive**, so a row
written after a registration failure describes a connection that does not work.
Saving it as `connected` was proposed and rejected
([archive](archive/rejected-alternatives.md) §3).

- Steps 1–2 succeeded, step 3 failed → persist with `status='disconnected'`,
  `registered_at=NULL`, the error in `last_registration_error`, credentials
  intact.
- Return `{ success: true, saved: true, registered: false, registration_error }`
  so the UI can show an actionable incomplete state.
- Step 3 succeeded → `status='connected'`.

This matches claude-01 §5.2 — *only a genuinely new connection may be written
`disconnected` on a registration error* — and every Embedded Signup connection is
genuinely new.

**No `incomplete` status:** `whatsapp_config.status` carries
`CHECK (status IN ('connected','disconnected'))` from `001_initial_schema.sql`,
so a third value means altering a constraint on a live table for a distinction
`last_registration_error` already draws.

### 5.3.3 Retry — the recovery action

`disconnected` is only honest if the client can get out of it, and today they
cannot: `config/verify-registration/route.ts` is a `GET` calling
`verifyPhoneNumber` and `getSubscribedApps` — it **diagnoses** registration, it
cannot **perform** it. An embedded client has no form to re-submit, and re-running
the popup hits §6 step 3's 409.

**New: `POST /api/whatsapp/registration/retry`.** Body: optional `pin`.

1. Authenticate; `requireRole('admin')`; resolve the caller's connection.
2. Load and decrypt the stored `access_token`.
3. Choose the PIN:

   | Row | PIN source |
   | --- | --- |
   | `embedded` | `WHATSAPP_PROVIDER_REGISTER_PIN`. **Ignore any `pin` in the body** — the PIN is ours, and accepting a client-supplied one would let a caller set the 2FA PIN on a number we manage. |
   | `manual` | **The `pin` from the request body. Required; six digits; 400 if absent or malformed.** |

   > **There is no stored PIN.** No migration adds a `pin` column;
   > `config/route.ts:188` reads it from the body, validates six digits at
   > `:197`, passes it at `:317`, and never persists it. A manual retry must ask
   > the operator for the PIN again, exactly as the save form does.

4. `registerPhoneNumber({ phoneNumberId, accessToken, pin })`.
5. Success → set `registered_at`, clear `last_registration_error`, set
   `status='connected'`.
6. Failure → update `last_registration_error` only. **Never downgrade** — this is
   the one place claude-01's no-downgrade guard genuinely applies, because a live
   connection may legitimately call it.

~40 lines reusing an existing helper, and it serves manual connections too
(claude-01 §5.2 can leave a manual row `disconnected` with no retry). Wire it
into the existing warning state: a six-digit PIN input for manual rows, a plain
button for embedded.

### 5.4 Share the checks, not the write — two functions, not one `upsert`

Create `src/lib/whatsapp/connect.ts`. **Two write functions, not one.**

```ts
// Insert only. Never touches an existing row.
createEmbeddedConnection(args): Promise<Result>   // unique violation → 409 connection_exists

// May update the account's existing row. Manual path only.
saveManualConnection(args): Promise<Result>
```

Both call the same **shared, non-writing** helpers — cross-account duplicate
check, encryption, status decision, error shaping. What they do **not** share is
the final statement against the database.

A single `upsert` helper — and its `allowOverwrite` flag variant — were rejected
([archive](archive/rejected-alternatives.md) §2): an upsert updates an existing
row, which §5.3 rule 2 forbids, and a boolean deciding whether a live client's
credentials get replaced is the argument that gets passed wrong once. Two named
functions make the dangerous operation **unreachable** rather than merely
unrequested — a structural guarantee instead of a promise.

`UNIQUE(account_id)` is the enforcement point: it turns a race (two tabs, a
double submit, a retry) into a database error rather than a silent overwrite.
Map that violation to `connection_exists`, the same 409 as §6 step 3.

**Extract here, not in claude-01**, because here there are two callers that must
not drift on encryption, duplicate-checking or status transitions. claude-01's
characterization tests (§8.0b) are the safety net.

**Its own commit, with the claude-01 suite passing, before the Embedded Signup
route.** The manual path's behaviour must not change — only its call site moves.

## 6. The route

**New:** `POST /api/whatsapp/embedded-signup`

Body: `code`, `waba_id`, `phone_number_id`, optional `business_id`. There is
**no `confirm_replace`** — removed with the overwrite rule (§5.3.1); do not
reintroduce it under another name.

Steps 1–4 are all cheap, so the 30-second code window is not at risk:

1. `supabase.auth.getUser()` → 401 `unauthorized` if absent.
2. Resolve the account; `requireRole('admin')`. Agent/viewer → 403 `forbidden`.
3. **If the account already has any `whatsapp_config` row → 409
   `connection_exists`. Unconditionally.** No flag overrides this. The UI never
   triggers it (§8 hides the button), so reaching it means a stale tab or a direct
   API call — either way, refuse.
4. Validate `code`, `waba_id`, `phone_number_id` are non-empty strings. Do not
   validate a PIN — it is ours, not the user's.
5. **Cross-account duplicate check — before any Meta call.** If another workspace
   already owns this `phone_number_id` → 409 `duplicate_phone_number`, **zero
   Meta calls made**. See §6.1.
6. `runEmbeddedSignup(...)` — the exchange is the first outbound call (§5.2).
7. `createEmbeddedConnection(...)` (§5.3, §5.4) — insert only. It repeats the
   duplicate check and relies on `UNIQUE`, so a row appearing between step 5 and
   here still yields 409 rather than a bad write.
8. Respond in the shape the existing UI understands —
   `{ success, saved, registered, registration_error, phone_info }`.

### 6.1 Why the duplicate check moved ahead of Meta

An earlier ordering ran `runEmbeddedSignup` first and let
`createEmbeddedConnection` catch duplicates afterwards. That is too late,
because steps 2 and 3 of the orchestrator **mutate state on Meta's side**:

- `subscribeWabaToApp` subscribes the ConnectsWA provider app to that WABA.
- `registerPhoneNumber` registers the number **with our PIN** — setting the
  two-factor PIN on a number that may already belong to a live ConnectsWA
  workspace.

So workspace Y attempting Embedded Signup on a number workspace X already owns
would re-register X's number under the provider app, then return a tidy 409 to
Y. Y sees a clean error; **X can go dark.** An outage inflicted on an existing
client by a stranger's signup attempt is not an acceptable failure mode for a
duplicate check.

The check is one indexed lookup on a `UNIQUE` column — `config/route.ts:213-235`
already implements exactly this with `.neq('account_id', accountId)`. It costs
single-digit milliseconds and steps 1–3 already query the database, so the
30-second code window is not at risk (§5.2's rule is "nothing slow and no other
Meta call before the exchange", not "no queries").

Keep the check in `createEmbeddedConnection` as well. The pre-check gives a clean
error and protects Meta; the constraint protects the database under a race.
Both, not either.

Stable error codes: `unauthorized | forbidden | invalid_request |
connection_exists | code_expired | exchange_failed | subscribe_failed |
duplicate_phone_number | db_error`.

Idempotency: disable the button on first click, plus step 3 — now absolute rather
than conditional, so a double submit cannot produce a second write. Sufficient at
hand-held scale. Do not build an attempts table.

## 7. Token expiry — decided

Create the Facebook Login for Business configuration as a **custom configuration
with no token expiry**, not from Meta's suggested template.

The template is named "WhatsApp Embedded Signup Configuration With 60 Expiration
Token" and issues a token that dies after 60 days — which means a scheduled
refresh job, expiry monitoring, and every client going dark on day 60 if that job
breaks. The choice is baked into the configuration and cannot be changed
afterwards, so if one was already created from the template, re-create it.
`claude-03` item 3 owns this.

## 8. Frontend

**New:** `src/components/settings/embedded-signup-button.tsx`, so the ~840-line
settings component doesn't grow further.

- **SDK loading.** Inject `https://connect.facebook.net/en_US/sdk.js` with
  `async defer crossorigin="anonymous"`. Attach an `onerror` handler — Firefox
  ETP and ad blockers block this domain routinely. On error, disable the button
  and point at the manual form. **A silent dead button is the worst outcome.**
- **`FB.init`** with the public App ID.
- **`FB.login`** with `config_id`, `response_type: 'code'`,
  `override_default_response_type: true`,
  `extras: { setup: {}, sessionInfoVersion: '3' }`. **No `featureType`** — that
  selects coexistence.
- **Message listener**, mounted once, cleaned up on unmount. Accept only origins
  whose hostname is `facebook.com` or ends `.facebook.com`. `JSON.parse` in
  try/catch.
- **The join problem.** `FB.login`'s callback and the `message` event fire
  independently, in no guaranteed order. Use a deferred that resolves when
  **both** the `code` and `{waba_id, phone_number_id}` have arrived, with a ~10s
  timeout — well inside the code's 30s life — then POST immediately.
- **Closing the popup on the final screen counts as SUCCESS**, not cancel.
- Events: `FINISH` is standard. `FINISH_ONLY_WABA` → "WABA selected but no phone
  number was connected — finish in Meta before retrying".
  `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` → "Coexistence is not supported yet".
  Unknown → treat as abandoned, do not throw, log only the event name.
- Error payloads use **`error_code`**, not `error_id`. Log `session_id` +
  `error_code` — what Meta support asks for.

**`src/components/settings/whatsapp-config.tsx`** — three states, only three:

| Workspace | Provider env vars | What renders |
| --- | --- | --- |
| No connection | present | **Connect WhatsApp** primary, manual form underneath |
| No connection | absent | Manual form only, exactly as claude-01 left it |
| **Any** connection, `manual` or `embedded` | either | Current status only — **no Connect button at all** |

The third row is the removed migration path (§5.3.1): no button, no banner, no
"upgrade" link, no tooltip. Not disabled-with-explanation — **absent**. Never
start anything on page load, in any state.

Add a post-connect payment-method nudge linking to
`https://business.facebook.com/wa/manage/home/` — without a payment method, sends
fail with billing errors that arrive as a ConnectsWA bug report.

**CSP.** `next.config.ts:39` ships `Content-Security-Policy-Report-Only`, so this
works today regardless. Add the allowances now so a future flip to enforcing
doesn't break onboarding: `script-src … https://connect.facebook.net`,
`connect-src … https://graph.facebook.com https://www.facebook.com`,
`frame-src https://www.facebook.com`. Read `node_modules/next/dist/docs/` for
this version's `headers()` contract first.

## 9. Meta's required callbacks

Both receive a POST with a `signed_request` body param, verified against
`META_PROVIDER_APP_SECRET` (HMAC-SHA256 over the payload segment, base64url).
One `src/lib/meta/signed-request.ts` helper with unit tests: valid, tampered,
wrong algorithm, malformed base64.

- `POST /api/meta/deauthorize` — verify, log, 200. **See §9.1: it does not
  disconnect anything.**
- `POST /api/meta/data-deletion` — must return
  `{ "url": "<status page URL>", "confirmation_code": "<code>" }`. A static page
  explaining the manual process is acceptable for App Review. **Do not try to
  resolve a workspace** (§9.1). Record the request (§9.2) and return the shape.

App Review checks that both exist, along with Privacy Policy and Terms URLs.

### 9.1 How deauthorize identifies the workspace

It doesn't. The verified `signed_request` carries a Facebook **`user_id`** — not
a WABA ID, not a phone number ID, nothing we store — so "mark that connection
disconnected" is undefined as written.

**The working path is `account_update`, not the callback.** Meta sends
`PARTNER_APP_UNINSTALLED` on the WABA-scoped `account_update` webhook (§4), and
*that* payload identifies the WABA. Resolve `whatsapp_config.waba_id` →
`account_id` (claude-01 §4.1.1's exactly-one-row rule) and mark that one row
disconnected. Meta already requires this subscription.

So `/api/meta/deauthorize` must: verify against `META_PROVIDER_APP_SECRET`
(invalid → 400, no side effect), log the sanitized `user_id` and timestamp,
return 200 promptly. **Do not disconnect on a best-guess basis** — guessing which
workspace a bare user ID belongs to risks disconnecting a *working* client on a
spurious or replayed callback, in exchange for a signal `account_update` already
delivers accurately.

If you later want the callback to act directly, store the connecting Meta user ID
on the row at signup time and match on it — a new nullable column and a future
decision, not something to infer during an incident.

### 9.2 Data deletion: one small table, plus a runbook

Returning a confirmation code satisfies Meta. It does not satisfy whoever has to
delete the data. **A log line is not a record** — it rotates out, it isn't
queryable, and "did we complete request `abc123`?" three weeks later has no
answer.

`supabase/migrations/039_data_deletion_requests.sql`

```sql
CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  confirmation_code TEXT NOT NULL UNIQUE,
  meta_user_id      TEXT NOT NULL,
  account_id        UUID REFERENCES accounts(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'received'
                      CHECK (status IN ('received','identified','completed','rejected')),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  notes             TEXT
);

-- Service-role only. RLS ON with ZERO policies denies every browser role;
-- the service role bypasses RLS and does the work.
ALTER TABLE data_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON data_deletion_requests FROM anon, authenticated;
```

> ⚠️ **Both statements are required, and "no policies" alone does the opposite of
> what it sounds like.** With RLS *disabled*, no policies means **no
> restriction** — Supabase grants `anon` and `authenticated` on public-schema
> tables, so PostgREST would expose every row: Meta user IDs, account IDs and
> free-text notes. RLS must be **on** for the absence of policies to mean
> "nobody". This is also the repo's house style — `026_api_keys.sql:63`,
> `027_notifications.sql:33` and `028_webhook_endpoints.sql:59` all enable RLS at
> creation, and 027 adds an explicit `REVOKE` on top.

Create **no** browser policies. The route inserts `status='received'` with
`account_id` NULL; a human fills in the rest. `account_id` is `SET NULL` on
delete so the audit record survives the deletion it recorded.

**Why a table here when §6 bans an attempts table:** an attempts table tracked
transient in-flight state that resolves on the call you're already on. A deletion
request is a durable obligation to an external party, with a code you handed out.
Losing one is a compliance failure.

**Plus `docs/data-deletion-runbook.md`** — the human half: who triages `received`
rows and the turnaround; how a `meta_user_id` gets matched to a workspace (ask
the client — there is no automatic path, §9.1); deletion order `messages` →
`conversations` → `contacts` → `whatsapp_config` → account; how the status page
at the returned `url` reflects completion.

**Both before the first real embedded client** — not before App Review. Meta
checks that the endpoint responds; the obligation outlives the review.

## 10. Environment variables

| Var | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_META_PROVIDER_APP_ID` | browser | `FB.init` |
| `NEXT_PUBLIC_META_PROVIDER_CONFIG_ID` | browser | `FB.login`; **also the kill switch** |
| `META_PROVIDER_APP_SECRET` | server | Code exchange + provider webhook HMAC |
| `WHATSAPP_PROVIDER_VERIFY_TOKEN` | server | Provider webhook GET handshake |
| `WHATSAPP_PROVIDER_REGISTER_PIN` | server | Six digits; never logged or returned |

The server reads the provider App ID from the public var — no duplicate.

## 11. Files

| File | Action |
| --- | --- |
| `supabase/migrations/038_whatsapp_config_connection_method.sql` | New |
| `supabase/migrations/039_data_deletion_requests.sql` | New (§9.2) |
| `src/lib/whatsapp/connect.ts` | New — `createEmbeddedConnection` (insert only) + `saveManualConnection` (may update) + shared non-writing helpers (§5.4) |
| `src/lib/whatsapp/embedded-signup.ts` | New — `runEmbeddedSignup` orchestrator |
| `src/app/api/whatsapp/embedded-signup/route.ts` | New |
| `src/app/api/whatsapp/registration/retry/route.ts` | New — both methods (§5.3.3) |
| `src/app/api/whatsapp/webhook/provider/route.ts` | New |
| `src/lib/meta/signed-request.ts` | New |
| `src/app/api/meta/deauthorize/route.ts` | New |
| `src/app/api/meta/data-deletion/route.ts` | New |
| `src/components/settings/embedded-signup-button.tsx` | New |
| `docs/data-deletion-runbook.md` | New — the human half of §9.2 |
| `src/lib/whatsapp/meta-api.ts` | Edit — `exchangeCodeForBusinessToken` |
| `src/app/api/whatsapp/webhook/route.ts` | Edit — narrow the env fallback to `connection_method='manual'` (§4.1) |
| `src/lib/whatsapp/process-webhook.ts` | Edit — `account_update` branch |
| `src/app/api/whatsapp/config/route.ts` | Edit — call `saveManualConnection` |
| `src/components/settings/whatsapp-config.tsx` | Edit — three states, payment nudge |
| `src/types/index.ts` | Edit — `connection_method`, `business_id` |
| `next.config.ts` | Edit — CSP allowances |
| `.env.local.example`, `Deploy.md` | Edit — five provider vars, Meta callback URLs |
| `messages/en.json`, `messages/ko.json` | Edit |
| `docs/phase-1/TEST-PLAN.md` | Execute §5B — already written |

## 12. Task order

- [ ] 12.1 Read `node_modules/next/dist/docs/` for route handlers, `headers()`
      and client script loading in this Next version.
- [ ] 12.2 Confirm `claude-03` items 1–4 are done; collect the five env values.
- [ ] 12.3 Migration 038 on the sandbox database; assert every existing row reads
      `manual` and is otherwise unchanged.
- [ ] 12.4 **`connect.ts` extraction, own commit** (§5.4): shared non-writing
      helpers plus `saveManualConnection`. claude-01's characterization suite
      must pass first — it exists for this refactor.
      `createEmbeddedConnection` lands with 12.7; adding an unused insert path
      during a pure refactor muddies the blame.
- [ ] 12.5 `exchangeCodeForBusinessToken` + unit tests.
- [ ] 12.6 `embedded-signup.ts` orchestrator + unit tests (§13).
- [ ] 12.7 `POST /api/whatsapp/embedded-signup`, including §5.3.2's
      `disconnected`-on-registration-failure rule **and §6.1's duplicate check
      ahead of the first Meta call**.
- [ ] 12.7a `POST /api/whatsapp/registration/retry` + the UI action (§5.3.3).
      Ship **with** 12.7 — persisting `disconnected` with no way out is worse
      than the bug it replaces.
- [ ] 12.8 Provider webhook route per the **§4.0 contract** (verify globally,
      resolve per **change** via claude-01's shared helper, skip-don't-fail) +
      `account_update` branch (§9.1), **and narrow claude-01's env fallback to
      `connection_method='manual'` (§4.1)** — the one edit 038 forces on the
      live manual route. Write no second resolver.
- [ ] 12.9 `signed-request.ts` + deauthorize (verify-and-log only) + migration
      039, the data-deletion route that inserts into it, the status page, and
      the runbook (§9.2).
- [ ] 12.10 CSP allowances.
- [ ] 12.11 `embedded-signup-button.tsx`.
- [ ] 12.12 `whatsapp-config.tsx` states, payment nudge, i18n (en + ko).
- [ ] 12.13 claude-01 suite still passing + all new tests, then
      `npm run typecheck && npm run lint && npm test && npm run build`.
- [ ] 12.14 Update `Deploy.md`, `README.md`.
- [ ] 12.15 UAT per §13, then record the flow for App Review.

## 13. Tests

**Automated** (Vitest, mocked `fetch`, never hit Meta in CI)

*Orchestrator*

- Happy path: four calls in order, correct URLs/methods/headers, `registered: true`.
- Exchange 400 → throws; `subscribed_apps` never called.
- `subscribed_apps` 400 → throws; `/register` never called; **nothing persisted**.
- `/register` 400 → resolves `registered:false`; connection still saved.
- `/register` "already registered" → counts as success.
- Metadata 400 → resolves with a stub; no throw.
- Neither the code nor the token ever reaches a console call.

*Persistence — no-overwrite is the property under test*

- Account with **no** connection, all green → row created, `status:'connected'`,
  `connection_method:'embedded'`.
- **Existing `manual` connection → 409 `connection_exists`; the row is unchanged
  in every column; it still sends and receives.** Assert the **full row**, not
  just `status` — the failure this guards against leaves `status` looking
  correct while the credentials underneath have been replaced.
- Existing `embedded` connection → 409.
- Existing **`disconnected`** connection → **409 as well.** Broken is not absent.
- `confirm_replace: true` in the body → **ignored**; still 409.
- **Register failure on a newly created `embedded` row → `status` is
  `disconnected`**, `registered_at` NULL, error recorded, credentials intact,
  response reports `registered: false` (§5.3.2). Assert it is **not**
  `connected` — the regression guard for the "green label over a dead number"
  class.
- Retry after that failure → succeeds, sets `registered_at`, clears the error,
  flips to `connected` (§5.3.3).
- Retry failing against a **live** connection → error recorded, `status` stays
  `connected`.
- **Retry on a `manual` row with no `pin` → 400**; non-six-digit → 400; valid →
  registers.
- **Retry on an `embedded` row ignores a body `pin`** and uses
  `WHATSAPP_PROVIDER_REGISTER_PIN`.
- Retry as agent/viewer → 403.
- **Duplicate number owned by another account → 409 `duplicate_phone_number`
  with ZERO Meta calls.** Assert the mocked `fetch` was never invoked — the
  point of §6.1 is that no Meta state is touched, and a test that only checks
  the status code would pass while `registerPhoneNumber` had already reset a
  live client's PIN.
- Duplicate row appearing **after** step 5's check but before the insert →
  unique violation → 409, existing row unchanged.
- **`createEmbeddedConnection` has no code path that issues an `UPDATE`** —
  assert structurally; "the route never calls it with an existing row" is not the
  same guarantee (§5.4).
- Simulated race: a row appears between step 3's check and the insert → unique
  violation surfaces as 409, existing row unchanged.

*Webhooks and callbacks*

- Provider route: correct HMAC → 200; a manual client's App Secret cannot
  validate it; wrong signature → 401, no side effect.
- Provider GET: correct verify token → challenge; wrong → 403.
- **Valid HMAC, change resolving to no connection → skipped and logged; the
  delivery still returns 200** (§4.0 step 6).
- One entry, two changes, one unresolvable → the resolvable one processed exactly
  once; the other skipped; no retry storm.
- Change resolving to a **`manual`** row → rejected, not processed.
- Change whose `waba_id` matches two rows → skipped, both `account_id`s logged.
- `processWebhookChange` never called without a resolved config, never handed a
  bare entry or a whole body (claude-01 §4.4.1).
- `account_update` accepted; `PARTNER_APP_UNINSTALLED` resolves the WABA to
  exactly one config and marks **only that** workspace disconnected (§9.1).
- **An `embedded` row's payload delivered to the *manual* route → 401 with an
  explicit method-mismatch log**, not a silent `META_APP_SECRET` attempt (§4.1).
- **The claude-01 characterization suite still passes.** Amendments only where a
  test asserted an internal call shape that §5.4's extraction legitimately
  changed — never a behaviour, never in the same commit as a behaviour change
  (`claude-00` invariant 6).
- `deauthorize`: valid `signed_request` → 200 and a sanitized log line, and **no
  connection disconnected by this route** (§9.1).
- `data-deletion`: valid `signed_request` → a row in `data_deletion_requests`,
  `status='received'`, `account_id` NULL, same `confirmation_code` in the body.
  **Assert the row, not the log line.**
- `data-deletion` twice with the same payload → two distinct confirmation codes,
  both recorded, no unique-constraint crash.
- **`data_deletion_requests` is unreadable by a browser client.** Query it with
  an authenticated (non-service-role) Supabase client → zero rows / denied.
  Assert this, not just that the migration text contains `ENABLE ROW LEVEL
  SECURITY` — the failure mode is a table that looks locked in the migration and
  is world-readable through PostgREST.
- `signed_request`: valid, tampered, wrong algorithm, malformed base64.

**Manual / UAT** (local, sandbox database, ngrok domain, Meta development mode)

1. Complete the popup with a test portfolio and a free test number → Connected.
2. "Verify Registration" lists the provider app on that WABA.
3. Message the number from a phone → lands in the right inbox; reply delivers.
4. Abandon the popup at several screens → no connection created, no error state.
5. Block Facebook's script (Firefox ETP) → clear message, manual form offered.
6. **Settings → WhatsApp on a workspace with a live `manual` connection → no
   Connect button anywhere.** Then POST to `/api/whatsapp/embedded-signup`
   directly for that workspace → 409, row unchanged.
7. Two `manual` connections stay live throughout.
8. Disable the kill switch mid-test → button disappears; the embedded workspace
   from step 1 keeps sending and receiving.

**Acceptance criteria:** `TEST-PLAN.md` **§5B.8** — the canonical list of twelve,
and the gate for enabling the feature. Not restated here; amend it there.

## 14. Rollout — staged, each stage reversible

Prerequisites: `claude-03` complete including App Review approval, §13 UAT green.

| Stage | Action | Client impact | Backout |
| --- | --- | --- | --- |
| 1 | Merge to the deploy branch. Nothing deployed. | None | Revert merge |
| 2 | Run migrations 038 and 039 in the Supabase SQL editor. Old code ignores them. | None | None needed — inert |
| 3 | Tag current production, then deploy **with provider env vars unset**. All code present, button not rendered, no Meta app pointing at the provider URL. | None visible | Redeploy the tag |
| 4 | Point the provider Meta app at production: webhook URL, verify token, Allowed Domains and OAuth redirect URIs, deauthorize and data-deletion URLs. | None — nobody can start the flow | Nothing to undo |
| 5 | Set the five env vars in hPanel, **rebuild**, restart. Button appears. | Workspaces **with no connection** see Connect; connected workspaces see exactly what they saw yesterday | Unset the public config ID, rebuild, restart (~5 min) |
| 6 | First real self-serve onboarding, watched on a call. | — | — |

**Verification gate after stage 3:** log into an existing `manual` client's
workspace and send a message out and one in. The riskiest deploy is the one where
the new feature is invisible.

**Kill switch:** unsetting `NEXT_PUBLIC_META_PROVIDER_CONFIG_ID` stops new
signups. Clients already connected through the popup **keep working** — the
server routes and their stored credentials remain deployed. Never revert
claude-02 runtime code once an `embedded` client is live.

Deploy outside clients' business hours; build-and-restart briefly takes the app
down.

## 15. The one Meta unknown — out of scope

*Does a number already registered under a client's own Meta app appear in the
Embedded Signup popup?* Meta doesn't document an answer, and it **cannot affect
this release** — Embedded Signup is unreachable for a connected workspace (§5.3,
§6 step 3, §8).

It becomes the first task of any future migration work, which is separate
approved work per `CODEX-SDD-WA-001` §5.4 and `CODEX-RAS-WA-001` §9. Minimum bar
before promising a client anything: popup behaviour confirmed empirically on a
throwaway number, rehearsal on a disposable WABA, old credentials retained and
provably restorable, end-to-end send/receive after the switch.

---

## Appendix — verified facts

Read from Meta's documentation and OpenBSP's source on 2026-08-09.

| Claim | Source |
| --- | --- |
| Sequence is exchange → subscribe → register → metadata → persist | Meta Tech-Provider onboarding steps 1–3; OpenBSP `embedded_signup.ts:269-300` |
| Exchange is a plain GET — no body, no auth header | Meta curl sample; OpenBSP `:25-27` |
| Code TTL is 30 seconds | Meta Implementation doc, "Response callback" |
| `/register` required, `pin` 6 digits, need not be stored | Meta onboarding Step 3; OpenBSP hardcodes `"123456"`, never persists it |
| `subscribed_apps` must be blocking | OpenBSP throws (`:56-61`); Meta: no send/receive until steps complete |
| `account_update` subscription is mandatory | Meta Implementation doc, "Before you start" |
| Valid OAuth redirect URIs + Strict Mode required | Meta Implementation doc Step 1 |
| Closing the popup on the final screen = success | Meta Implementation doc |
| CANCEL error field is `error_code`, not `error_id` | Meta Implementation doc, "User reported errors" |
| Meta's suggested template issues a 60-day token | Meta Implementation doc Step 2 |
| Embedded Signup v2 deprecates 15 Oct 2026; v4 released 8 Oct 2025 | Meta versions page |
| A WABA can have more than one subscribed app | Meta Postman collection, `GET /{WABA-ID}/subscribed_apps` |
| Test users can run the flow before App Review | Meta Implementation doc, "Testing" |
| `registerPhoneNumber` already treats "already registered" as success | `meta-api.ts:151-153` |
| Duplicate-number check excludes the account's own row | `config/route.ts:217` — true, but no longer load-bearing: §5.3 rule 2 refuses first |
| `waba_id` is nullable with no unique constraint | `001_initial_schema.sql:194`; no later migration constrains it |
| `messages` has no `account_id`; scoped via `conversations` | `001_initial_schema.sql` messages DDL; `017_account_sharing.sql:512` |
| No `pin` column exists anywhere | `config/route.ts:188`, `:197`, `:317` — read from the body, never persisted |
| Deauthorize `signed_request` carries a Facebook `user_id`, not a WABA ID | Meta app-settings callback docs — hence §9.1 |
| CSP is report-only today | `next.config.ts:39` |

**Reference implementation** (read-only, outside this repo): OpenBSP, a registered
Tech Provider —
`C:\Users\manis\Desktop\Claude\OpenBSP\open-bsp-api\open-bsp-api\supabase\functions\whatsapp-management\embedded_signup.ts`
and `open-bsp-ui\src\contexts\WhatsAppIntegrationContext.tsx`.

**Meta docs tip:** every documentation page has a plain-Markdown twin at the same
URL with `.md` appended — about 10× smaller, same body text and code samples.
