# claude-01 (P1-10) — Per-client App Secret + two bug fixes

- **Status:** Draft
- **Effort:** ~3–4 days. §8.0's characterization tests are done; §6.2's
  credential lockdown touches ~16 files and is the largest remaining piece.
- **Branch:** `feat/p1-10-per-client-app-secret`
- **Last updated:** 2026-08-10
- **Prerequisite reading:** `claude-00-architecture-overview.md`
- **Implements:** `CODEX-ADR-001`, `CODEX-SDD-WA-001` §14 Phase A
- **Gated by:** `CODEX-RAS-WA-001` Stages 0–1
- **Acceptance criteria:** `TEST-PLAN.md` §5A.6 (canonical — not restated here)
- **Ships to:** production, immediately. This is what goes to market.

> **Scope discipline.** Make hand-held onboarding work for more than one client,
> safely. Add nothing else. The larger architecture considered — server-only
> credential repository, expand/contract migrations, connection state machine,
> per-client callback URLs — is in `archive/P1-10-full-multi-app-architecture.md`
> and deliberately not built.

---

## 1. Problem

`src/lib/whatsapp/webhook-signature.ts:25` verifies every inbound webhook against
a single deployment-wide `META_APP_SECRET`. Meta signs each delivery with the App
Secret of the app that owns the number, and here every client owns their own app.

| Workspace | Meta app | Signed with | Today |
| --- | --- | --- | --- |
| Client A | App A | Secret A | Works if `META_APP_SECRET` is A |
| Client B | App B | Secret B | **401 — every message silently dropped** |

Outbound keeps working for both, because sending uses each workspace's own token.
**The failure looks like a quiet week, not a broken product.**

**Bug 1 — a re-save can take a live client offline.** `config/route.ts:361-363`
writes `status:'disconnected'`, `connected_at:null`, `registered_at:null`
whenever `registrationError` is truthy. Re-saving a working connection while Meta
is having a moment disconnects that client.

**Bug 2 — a failed subscription reports success.** `config/route.ts:344-351`
catches a `subscribeWabaToApp` failure, logs `console.warn`, and returns success.
Without that subscription Meta never delivers, so onboarding "completes" and the
inbox stays empty forever.

## 2. Goals / Non-goals

**Goals**

- Two or more workspaces, each on their own client-owned Meta app, receive
  inbound simultaneously.
- Every webhook verified with the correct App Secret before any side effect.
- Every webhook write scoped to the workspace it was verified for.
- Re-saving a working connection can never take it offline.
- A failed WABA subscription is reported at save time.
- A silently dead connection is visible without opening the database.
- No credential ciphertext reaches the browser.
- The current single-client setup keeps working with **no reconfiguration, no
  downtime**.

**Non-goals**

- Server-only credential table, repository refactor, expand/contract migrations.
- Per-client callback URLs, `webhook_key`, `connection_state`, `webhook_mode`.
- Credential rotation state machine, sanitized config API contract.
- `META_GRAPH_VERSION` refactor — repo pinned `v21.0`, Meta's examples `v25.0`.
  Tracked separately (§11.3).
- Anything Embedded Signup. That is `claude-02`.

## 3. Data model

`supabase/migrations/037_whatsapp_config_app_secret.sql`

```sql
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS app_secret      TEXT,
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

-- Credentials are server-only. RLS governs WHICH ROWS a member sees; these
-- grants govern WHICH COLUMNS. Both are needed — RLS alone lets a member read
-- their own row's ciphertext (§6.2).
--
-- Table-level SELECT must be revoked FIRST. A column-level REVOKE alone is a
-- no-op while the role still holds table-wide SELECT, which Supabase grants to
-- anon and authenticated by default.
REVOKE SELECT ON whatsapp_config FROM anon, authenticated;

GRANT SELECT (
  id, account_id, phone_number_id, waba_id, status, connected_at,
  registered_at, subscribed_apps_at, last_registration_error,
  last_inbound_at, created_at, updated_at
) ON whatsapp_config TO authenticated;
-- anon gets nothing back.
```

This grant pair is what makes acceptance criterion #4 true. Not optional, not
deferrable — see §6.2.

> **Writes that return the row — checked, clear.** Revoking table SELECT also
> affects `.update(...).select()` or a `.maybeSingle()` after an upsert, since
> PostgREST needs SELECT on returned columns. Verified 2026-08-11: the config
> route's update, insert and delete all destructure only `error` with no
> `.select()`, so supabase-js sends `Prefer: return=minimal` and needs no SELECT
> privilege. Re-confirm against the live database when the grants are applied.
>
> `claude-02` adds `connection_method` and `business_id` to the grant list.

`036_conversation_contact_dedup.sql` is the highest existing migration, so 037 is
free.

`app_secret` is nullable **on purpose**: `NULL` means "verify with
`META_APP_SECRET`", so the existing production connection survives the deploy
with no client action. Store it encrypted via `src/lib/whatsapp/encryption.ts`,
exactly like `access_token` and `verify_token`.

> ⚠️ **Nullable in the schema ≠ optional in the API.** It may be `NULL` for one
> grandfathered row and must still be **required** for every new connection —
> §5.1.1. Getting this wrong reintroduces §1's bug through the happy path.

Migration house style: a comment explaining *why*, guarded DDL, idempotent.

### 3.1 `last_inbound_at` — inbound only

Stamped in `process-webhook.ts` when an inbound message is successfully persisted
for that config's account. **Best-effort**: a failed stamp is logged and
swallowed, never propagated — it is a diagnostic and must not become a new way
for messaging to fail. One extra `UPDATE` per inbound message is fine at this
scale; if volume ever bites, throttle to once per minute per account rather than
removing the signal.

**No `last_outbound_at`, deliberately** — three paths send without going through
`send-message.ts` (`automations/meta-send.ts:157`, `flows/meta-send.ts:97`,
`broadcast-core.ts:275`), so the column would read "never" while broadcasts were
sending fine. Rejected in full at
[`archive/rejected-alternatives.md`](archive/rejected-alternatives.md) §4.

No other schema change.

## 4. Webhook: resolve the tenant, then verify

`src/app/api/whatsapp/webhook/route.ts`

### 4.1 POST — new order

Today: verify (`:~190`) → parse → `processWebhook`. Change to:

1. Read the raw body. Parse it. **Use the parsed body only to identify the
   sender — no writes, no mutation, no dispatch.**
2. Resolve the connection — **`phone_number_id` first, `waba_id` only as a
   fallback** (§4.1.1; the obvious order is wrong).
3. Select the secret: `decrypt(config.app_secret)` if set, else
   `process.env.META_APP_SECRET`. Neither → 401.

   > `app_secret IS NULL` means one thing today: a manual connection without its
   > own secret yet. `claude-02` adds a second NULL population (`embedded`), at
   > which point this must narrow to `connection_method = 'manual'` — see
   > `claude-02` §4.1. Leave a comment pointing there.
4. Verify the HMAC over the **untouched raw body string**. Do not re-serialize.
5. Only now `after(() => processWebhook(body, config))`, passing the config from
   step 2. **The processor must handle only changes that resolve to that same
   connection** — see §4.1.2. Never attempt a second secret.

Parsing before verifying is safe because step 1 has no side effect and step 2 is
read-only. Comment that, or someone will "fix" it back.

### 4.1.2 The signature authenticates one workspace — process only that one

**This is a tenancy boundary, not an optimisation. Get it wrong and any manual
client can write into any other workspace's inbox.**

Every manual client owns their Meta app and therefore knows their own App Secret.
So a client can forge any payload they like and sign it validly. If the route
verifies with A's secret and then lets the processor resolve each change
independently, A can craft a change whose
`value.metadata.phone_number_id` is **B's number**, sign it with A's own secret,
and have it written into B's workspace. It passes verification, because the
signature really is valid — it just doesn't authenticate *B*.

Skipping at entry level does not close this. `entry.id` is attacker-controlled
too, and `phone_number_id` lives on the **change**, which is where resolution
happens. Set `entry.id` to A's own WABA and an entry-level check waves it through.

**The rule:**

- On the **manual** route, `resolveConnectionForChange` must return the *same*
  `whatsapp_config.id` that supplied the verifying secret. Any change resolving
  to a different connection, or to none, is **skipped and logged loudly** — a
  validly-signed payload carrying another tenant's number is either a Meta bug
  or an attack, and both deserve a log line naming both `account_id`s.
- Return 200 for the delivery overall; the skip is per change, so one hostile or
  stale change doesn't make Meta retry the legitimate ones.

**Why the provider route differs** (`claude-02` §4.0), stated here so nobody
"unifies" the two later: there, the signature is the deployment-wide provider
secret, which legitimately covers *every* embedded workspace. One signature, many
valid tenants — so per-change resolution is correct there and dangerous here. The
distinguishing question is always **"how many workspaces does this signature
speak for?"** Manual: exactly one. Provider: all embedded ones.

### 4.1.1 Tenant resolution — `waba_id` is not a key

`waba_id TEXT` (`001_initial_schema.sql:194`) has **no constraint of any kind**;
it is nullable and `config/route.ts` writes `waba_id || null` because the form
treats it as optional. Resolving a tenant from it is the ambiguous lookup that
produced issue #136 — which the existing code already guards against for
`phone_number_id` (`webhook/route.ts:265-293`).

Resolve in this order:

1. **`value.metadata.phone_number_id`** against
   `whatsapp_config.phone_number_id` — `UNIQUE` from migration 013, so a match
   is exactly one row. Present on message and status events.
2. **Fallback: `entry.id`** against `whatsapp_config.waba_id`, for events with no
   `metadata` — template lifecycle events (`isTemplateWebhookField`). Require
   exactly one row:
   - 0 rows → 401, no side effect.
   - **≥2 rows → 401, no side effect**, logging the colliding `account_id`s,
     mirroring the existing guard. Two accounts under one shared WABA is a real
     configuration; guessing which signed the payload is not acceptable.
3. Neither → 401, no side effect.

Do not later "fix" this with `UNIQUE(waba_id)` — a WABA legitimately holds more
than one number, so that breaks valid setups instead of invalid ones.

### 4.2 GET handshake

Leave as-is. It already loops configs and compares decrypted verify tokens, and
is unaffected by the App Secret change.

### 4.3 Signature helper

`webhook-signature.ts` — change `verifyMetaWebhookSignature(rawBody,
signatureHeader)` to take the secret explicitly instead of reading `process.env`
internally. Keep fail-closed on an empty secret. Update its existing tests.

### 4.4 Extract, then scope — two commits, do not combine

**Commit A — pure move.** `processWebhook()` from the route file into
`src/lib/whatsapp/process-webhook.ts`, byte-identical. No signature change, no
behaviour change. Done now because `claude-02` adds a second route that calls the
same processor, and this file is already being edited.

**Commit B — adopt §4.4.1's contract, then scope status writes.** Fixes a live
violation of `claude-00` invariant 1.

### 4.4.1 The processor contract — resolve per *change*

`claude-02` §4.0 depends on this shape; settle it here.

`processWebhook(body)` loops `body.entry`, then `entry.changes`, and resolves the
config **inside the change loop** — `change.value.metadata.phone_number_id` is
where the number lives (`route.ts:262`). Entry-level resolution only works for
template events, which have no `metadata`. So the unit of work is a **change**:

```ts
// src/lib/whatsapp/process-webhook.ts
processWebhookChange(change: WhatsAppChange, config: WhatsAppConfig): Promise<void>

// src/lib/whatsapp/resolve-connection.ts  — shared by both routes
resolveConnectionForChange(entry, change):
  Promise<{ ok: true; config } | { ok: false; reason: 'unknown' | 'ambiguous' }>

// src/lib/whatsapp/process-webhook.ts — the manual route's entry point.
// `expectedConfig` is the connection whose secret verified the request;
// changes resolving elsewhere are skipped (§4.1.2).
processWebhook(body, expectedConfig: WhatsAppConfig): Promise<void>
```

`processWebhook` is a thin loop: per entry, per change, resolve → **check it
matches `expectedConfig.id`** → `processWebhookChange(change, config)`, skipping
and logging otherwise.

- **Never pass a bare `entry` to the processor.** It expects a change; a
  single-entry object isn't a body either, so it type-checks against nothing.
- **Resolution failure, or a mismatch against `expectedConfig`, skips that change
  and continues** — one unroutable or hostile change must not abort its siblings.

`resolveConnectionForChange` owns §4.1.1's ordering and exactly-one-row rule, so
both routes inherit it. The **match check is the manual route's**; the provider
route has no single expected config and instead requires
`connection_method === 'embedded'` (`claude-02` §4.0 step 4). Keep the check at
the route boundary rather than inside `processWebhookChange`, so each route
states its own trust rule explicitly.

**Status scoping.** `handleStatusUpdate` (`webhook/route.ts:364`) does:

```ts
await supabaseAdmin().from('messages')
  .update({ status: status.status })
  .eq('message_id', status.id)          // ← no tenant scope
```

Its own comment records that `message_id` is **not unique** — Meta IDs repeat
across numbers (migration 009). With two clients that is a cross-tenant write.
The awkward part: **`messages` has no `account_id`** — it scopes through
`conversations.account_id`, `broadcast_recipients` through
`broadcasts.account_id`. So:

1. Thread the resolved `config.account_id` into `handleStatusUpdate`.
2. Scope the `messages` update through its conversation. A single joined `UPDATE`
   is ideal but **not required** — the Supabase JS client doesn't express it
   cleanly, and forcing it invites a raw RPC harder to test than the bug. An
   account-bounded conversation-ID lookup followed by a constrained update is
   fine: `conversations.account_id` is immutable, so there is no race to lose.
   Cover whichever form with the M-39 test.
3. **`broadcast_recipients` needs no change.**
   `003_broadcast_recipient_wamid.sql:31` has a partial unique index on
   `whatsapp_message_id`, so that lookup already resolves to at most one row
   repo-wide. Write no duplicate-ID test for it — the case is unconstructible.
4. Leave the `messages` `0..N rows` tolerance intact; it is now bounded to one
   tenant.

Do **not** add `account_id` to `messages` here — wide backfill on the largest
table, not additive-safe under a staged deploy, and the join gives the same
guarantee (§11.4).

## 5. Config route: accept the secret, fix the bugs

`src/app/api/whatsapp/config/route.ts`

### 5.1 Accept `app_secret`

Accept in the POST body, encrypt, persist. Treat exactly like `access_token` and
`verify_token`: never returned, never logged, never echoed — not even ciphertext.

### 5.1.1 Require it on create

**A new manual connection saved without an App Secret must be rejected.**
Otherwise: Manish onboards Client B, doesn't paste an App Secret, Meta verifies
the token, the save succeeds, the UI says **Connected**, `app_secret IS NULL`
falls back to `META_APP_SECRET` — Client A's secret — and every inbound message
for B is dropped with a 401. That is §1's table, reproduced by forgetting one
field on an onboarding call.

| Case | Behaviour |
| --- | --- |
| **New** connection, `app_secret` absent or empty | **400, nothing saved.** Error names the field and where to find it (Meta → App Settings → Basic → App Secret). |
| **New** connection, `app_secret` present | Encrypt and store. |
| **Existing** connection, `app_secret` omitted | **Preserve the stored ciphertext.** Omission means "unchanged", exactly as `access_token` behaves today. |
| **Existing** grandfathered row (`app_secret IS NULL`) | Keeps working on `META_APP_SECRET`. Never force a value on re-save; §10 step 6 backfills whenever convenient. |

**Never persist the mask.** The component sends `access_token` only when
`tokenEdited && accessToken !== MASKED_TOKEN` (`whatsapp-config.tsx:212`).
Mirror that, and also reject a submitted value equal to `MASKED_TOKEN`
server-side — the client guard is a convenience, not a boundary.

Nullable in the schema is a statement about one legacy row, not about the API.

### 5.2 Bug 1 — no-downgrade guard

Before writing the `registrationError` branch at `:361-363`, look up the existing
row. If one exists **with the same `phone_number_id`** and
`status === 'connected'`, preserve `status`, `connected_at` and `registered_at`,
recording only `last_registration_error`.

Only a genuinely new connection, or one changing to a different number, may be
written `disconnected` on a registration error.

### 5.3 Bug 2 — surface subscription failure

Keep the call non-fatal (a client may have subscribed by hand), but capture the
failure and return it so the UI can show:

> Saved, but this WhatsApp account is not subscribed to your app — inbound
> messages will not arrive.

Do not report a clean success. Record `subscribed_apps_at` only on actual success.

### 5.4 Add the role gate — it does not exist today

Found by the §8.0b characterization tests, which documented the actual
behaviour: **`config/route.ts` has no role check at all.** `POST` and `DELETE`
call `supabase.auth.getUser()` and then an inlined `resolveAccountId` (`:21`,
`:173-180`, `:448-455`) — so **any member of the workspace, including a viewer,
can overwrite or delete that workspace's WhatsApp connection.**

This is not a new requirement. `CODEX-SDD-WA-001` §11 already states *"only
workspace owners and administrators may create, replace, or remove a WhatsApp
connection"*, `claude-02` §6 step 2 assumes `requireRole('admin')` for the
embedded route, and §9's own test list has asserted it since the first draft.
Every doc believed it was already there; none of them checked. The gap is real
and it is in this release's blast radius, because P1-10 is what makes stored
credentials worth stealing.

**The change:** replace the inlined `resolveAccountId` with
`requireRole('admin')` (`src/lib/auth/account.ts:182`) on **POST and DELETE**.
That is the established pattern — `account/api-keys/route.ts:73`,
`account/invitations`, `account/transfer-ownership`, `ai/config` and six other
routes already use it, and `claude-00` §3 already tells you not to invent a new
authorization layer.

**Leave `GET` alone.** It deliberately returns shaped 200s for every non-auth
failure so the settings page can render a "not connected" state, and it now
returns no credential columns (§6.2). Any member may see *that* a connection
exists; only an admin may change it.

Update the §8.0b characterization test in the same commit — it currently
documents "no role gate exists today", which is correct as a baseline and wrong
as an end state.

## 6. Settings UI

`src/components/settings/whatsapp-config.tsx`

### 6.1 App Secret field

One new field, **Meta App Secret**, alongside the existing token fields.
Write-only, fixed mask once saved, complete replacement value to change, no
reveal control.

**Required when there is no existing connection** (§5.1.1) — mark it required and
block submit client-side, mirroring the `!config && (!accessToken.trim() ||
!tokenEdited)` guard at `:190`. The server-side 400 is the real boundary.

Help text: where to find it (Meta → App Settings → Basic → App Secret) and that
it is the *client's own app's* secret, not something ConnectsWA issues. That
sentence prevents the most likely onboarding mistake.

Render §5.3's subscription warning as a persistent warning state on the
connection card, not a toast.

Client-facing process unchanged: one callback URL,
`https://<domain>/api/whatsapp/webhook`, for every client.

### 6.2 Credentials become server-only — the whole of it

Acceptance criterion #4 (frozen): *no stored credential, plaintext or ciphertext,
is returned from the server **or database** to the browser.* A narrowed UI query
does not satisfy that — it changes what the app asks for, not what the database
is willing to give. Any member could open DevTools and re-query the columns.

**Three parts, all required. Do not ship one or two.**

**(a) Revoke the columns** — migration 037 (§3). RLS decides which *rows* a
member sees; column grants decide which *columns*. `claude-01`'s earlier draft
deferred this as "low severity, ciphertext, own workspace"; that deferral is
withdrawn, because the criterion is approved and frozen.

**(b) Fix the one browser reader that over-selects.** Audited 2026-08-11:

| File | Selects | Change |
| --- | --- | --- |
| `src/components/settings/whatsapp-config.tsx:107` | `*` | Explicit safe column list, below |
| `src/components/settings/settings-overview.tsx:125` | `phone_number_id` | **None.** Already minimal. It breaks only *indirectly*, via the GET route in (c)①, which it calls on the same render. |
| `src/app/(dashboard)/inbox/page.tsx:204` | `status` | **None.** Granted column. |

Safe column list:

```
id, account_id, phone_number_id, waba_id, status, connected_at,
registered_at, subscribed_apps_at, last_registration_error,
last_inbound_at, created_at, updated_at
```

`whatsapp-config.tsx` is safe to narrow today — it calls
`setAccessToken(MASKED_TOKEN)` and `setVerifyToken('')` unconditionally at
`:121-122` and never reads the credential fields. `claude-02` adds
`connection_method` and `business_id` to this list.

**(c) Move server-side credential reads to the service-role client.** This is the
part that makes (a) safe to apply, and the reason this section is a real work
item rather than a one-line change.

`createClient()` from `@/lib/supabase/server` authenticates **as the user** —
role `authenticated`, the same role the browser uses. Postgres cannot tell
"server code acting as the user" from "browser acting as the user", so the
`REVOKE` in (a) hits both. Every server path that decrypts a token must therefore
read through the service-role client (`supabaseAdmin()`, the pattern already in
`config/route.ts:40` and `webhook/route.ts`).

**Audited 2026-08-11 — 31 occurrences across 20 files.** (An earlier draft said
22/16 and was wrong in both directions; it also used a single-quote-only grep
that missed a double-quoted site.) Use:

```bash
grep -rnE "from\(['\"]whatsapp_config['\"]\)" src/ --include=*.ts --include=*.tsx
```

**Move these 10 sites, in 9 files, to `supabaseAdmin()`:**

| Site | Note |
| --- | --- |
| `config/route.ts:91` **(GET)** | ⚠️ **The one that breaks the settings page.** Selects `phone_number_id, access_token, status` on the user-scoped client for "Test API Connection", and `settings-overview.tsx` calls it on every settings render. |
| `send/route.ts:175` | ⚠️ **Fix at the caller, not the lib.** It injects the user-scoped client into `sendMessageToConversation`, which does `select('*')` + `decrypt`. |
| `broadcast/route.ts:138` | |
| `react/route.ts:113` | |
| `media/[mediaId]/route.ts:53` | |
| `templates/submit/route.ts:153` | |
| `templates/sync/route.ts:154` | |
| `templates/[id]/route.ts:142` and `:282` | Two sites |
| `config/verify-registration/route.ts:59` | |

**Already safe — do not touch:** `automations/meta-send.ts` and
`flows/meta-send.ts` (already `supabaseAdmin()` internally);
`broadcast-core.ts` and `send-message.ts` (injected client — their only public
caller is v1, where `requireApiKey` supplies service-role); `webhook/route.ts`,
`process-webhook.ts`, `resolve-connection.ts` (service-role throughout);
`config/route.ts:222` (claim check, no credentials); `resolve-conversation.ts:59`.

**`user_id` stays out of the GRANT list.** `lib/api/v1/contacts.ts:78` selects it,
but only ever through a service-role client — and service role bypasses column
grants entirely, so granting it to `authenticated` would change nothing except
widen the allowlist. The list is what *browser* code needs, not everything
non-credential. (`whatsapp_config.user_id` is a pre-account-sharing vestige from
migration 001; 017 moved the tenant key to `account_id`. See §11.5.)

**Ordering matters.** Do (c) first, then (b), then (a). Applying the `REVOKE`
before the reads are moved takes sending offline.

### 6.3 Connection health

Show `last_inbound_at` on the connection card as a relative time — "Last inbound
3 minutes ago" / "Last inbound: never". One line.

"No inbound for six days on a workspace that used to receive hourly" is the
signal that catches §1's failure, visible without opening Supabase. No alerting,
no dashboard, no outbound counterpart.

## 7. Files

| File | Action |
| --- | --- |
| `src/app/api/whatsapp/webhook/route.test.ts` | New — characterization, **before** any change (§8.0b) |
| `src/app/api/whatsapp/config/route.test.ts` | New — characterization, **before** any change (§8.0b) |
| `supabase/migrations/037_whatsapp_config_app_secret.sql` | New — `app_secret`, `last_inbound_at` |
| `src/lib/whatsapp/process-webhook.ts` | New — pure move, then `processWebhookChange` (§4.4.1), scoped status writes, `last_inbound_at` |
| `src/lib/whatsapp/resolve-connection.ts` | New — `resolveConnectionForChange`, shared by both webhook routes |
| `src/app/api/whatsapp/webhook/route.ts` | Edit — resolve → select secret → verify → process |
| `src/lib/whatsapp/webhook-signature.ts` | Edit — explicit secret parameter |
| `src/app/api/whatsapp/config/route.ts` | Edit — `app_secret` **required on create** (§5.1.1); no-downgrade guard; surface subscription failure; **`requireRole('admin')` on POST/DELETE (§5.4)** |
| `src/components/settings/whatsapp-config.tsx` | Edit — App Secret field, subscription warning, **narrowed select (§6.2b)**, last-inbound line |
| `src/components/settings/settings-overview.tsx` | Edit — **narrowed select (§6.2b)**; second browser reader, audit what it renders |
| ~13 server files reading `whatsapp_config` | Edit — credential reads move to `supabaseAdmin()` (§6.2c); audit first, most need no change |
| `src/types/index.ts` | Edit — `app_secret`, `last_inbound_at` on `WhatsAppConfig` |
| `messages/en.json`, `messages/ko.json` | Edit — label, help text, required-field error, warning copy, last-inbound strings |
| `.env.local.example` | Edit — `META_APP_SECRET` is now the fallback for connections without their own |
| `docs/phase-1/TEST-PLAN.md` | Execute §5A — already written, no authoring needed |

## 8. Task order

- [ ] **8.0 — HARD GATE. Do not skip, do not reorder.**
  - [ ] 8.0a Line endings — **verify only, change nothing.** Confirm
        `git config --get core.autocrlf` returns `true` and that
        `git diff --name-only` and `git diff --ignore-cr-at-eol --name-only`
        list the same files. Both hold on the development machine, so there is
        nothing to discard (`claude-00` §3). Run no `checkout`, add no
        `.gitattributes`.
  - [ ] 8.0b **Characterization tests for `webhook/route.ts` and
        `config/route.ts`, against unchanged code.** There are none today —
        `src/app/api/` holds exactly two test files (`contacts/[id]/tags`,
        `whatsapp/send`), neither covering these routes; `webhook-signature.test.ts`
        covers only the helper. §8.4 moves ~900 lines of the live inbound path
        and §5 rewrites the save path, so "full suite green" is a **vacuous
        gate** against an empty suite. Capture:
        - GET: correct verify token → challenge; wrong → 403; malformed token row
          skipped, not fatal.
        - POST: valid HMAC → 200 and persisted; invalid → 401 and nothing
          written; raw-body sensitivity; unknown `phone_number_id` → logged,
          dropped, no throw; multi-row guard fires.
        - Status: `sent`/`delivered`/`read`/`failed` mirror onto `messages` and
          `broadcast_recipients`, forward-only transition guard included.
        - Config POST: happy path persists encrypted; 409 on another account's
          number; role enforcement; registration-error → `disconnected`
          (**characterize as-is**, change it in 8.8, update the test in that
          same commit).

        `CODEX-SDD-WA-001` §7.4 and `CODEX-RAS-WA-001` Stage 0. The single most
        valuable item in this document.
  - [ ] 8.0c Tag the current production commit **and push it**. A local-only tag
        is not a rollback target — if the laptop is the thing that failed, the
        tag went with it. `git push origin pre-p1-10`.
- [ ] 8.1 Read `node_modules/next/dist/docs/` for this Next version's route
      handler contract before editing any route (`AGENTS.md` hard rule).
- [ ] 8.2 Migration 037 against a disposable database holding a representative row.
- [ ] 8.3 `webhook-signature.ts` explicit secret + update its tests.
- [ ] 8.4 Extract `processWebhook` — **pure move, own commit** (§4.4 Commit A).
      Characterization suite green **and unmodified**. If a test needed changing,
      it wasn't a pure move.

      > **This is the only task where "unmodified" is absolute.** After it, 8.5
      > and 8.6 deliberately change behaviour — unknown sender moves from
      > "200 + internal drop" to 401 (§4.1.1), status writes become
      > account-scoped (§4.4) — so the webhook characterization tests must be
      > updated to the §9 end state, in the same commit as the behaviour change
      > that requires it. Same for the config route at 8.7–8.9a. Characterization
      > tests exist to make the *pure move* provable, not to freeze bugs forever.
- [ ] 8.5 §4.4 Commit B: `resolveConnectionForChange` + `processWebhookChange`
      (§4.4.1), then scope status writes. `claude-02` §4.0 reuses this contract.
- [ ] 8.6 Webhook route: resolve (§4.1.1 order) → select → verify → process,
      **passing `expectedConfig` and enforcing the same-connection rule
      (§4.1.2)**. Write the forgery test in this commit, not later — it is the
      only thing that proves the boundary holds.
- [ ] 8.7 Config route: accept and encrypt `app_secret`, **and enforce §5.1.1**.
      The enforcement is the point; acceptance alone is not.
- [ ] 8.8 Config route: no-downgrade guard.
- [ ] 8.9 Config route: surface subscription failure.
- [ ] 8.9a Config route: **add `requireRole('admin')` to POST and DELETE**
      (§5.4). It is absent today — any viewer can overwrite the connection.
      Update the 8.0b characterization test in the same commit.
- [ ] 8.10 `last_inbound_at` stamping, best-effort (§3.1).
- [ ] 8.10a **Credential lockdown (§6.2) — in this order.**
      - [ ] (c) Audit all 22 `whatsapp_config` read sites; switch every read
            that selects a credential column to `supabaseAdmin()`. Run the full
            suite after — this is the largest regression surface in the release.
      - [ ] (b) Narrow both browser components, including
            `settings-overview.tsx:125`.
      - [ ] (a) Only now apply the `REVOKE` from migration 037 and re-run every
            Meta-calling path. Applying it before (c) takes sending offline.
- [ ] 8.11 Settings: field, warning, last-inbound line, i18n (en/ko).
- [ ] 8.12 Remaining tests per §9.
- [ ] 8.13 `npm run typecheck && npm run lint && npm test && npm run build`.
- [ ] 8.14 Walk `TEST-PLAN.md` §5A and record the result.

## 9. Tests

Also the safety net for `claude-02` §5.4's `connect.ts` extraction.

**Webhook**

- Payload A signed with Secret A → 200; only Account A written.
- Payload B signed with Secret B → 200; only Account B written.
- Payload A signed with Secret B → 401; no write, no automation.
- `app_secret = NULL` → falls back to `META_APP_SECRET`, verifies.
- Neither secret available → 401.
- Unknown WABA and unknown phone number → 401; no second secret attempted.
- Signature over raw bytes; a re-serialized body must fail.
- GET handshake unchanged.

**Cross-tenant forgery (§4.1.2) — the tenancy regression guard**

- **Payload validly signed with A's App Secret, containing a change whose
  `metadata.phone_number_id` is B's → B is completely untouched.** No message
  row, no conversation, no automation, no status change. The change is skipped
  and logged with both `account_id`s; the delivery still returns 200.
- Same, with `entry.id` set to A's own WABA — an entry-level check alone would
  have let this through.
- Same, with a mix: one change for A and one for B in the same delivery → A's is
  processed exactly once, B's is skipped.

  > If this test is ever deleted, any manual client can write into any other
  > workspace. It is the reason §4.1.2 exists.

**Tenant resolution (§4.1.1)**

- Event with `metadata.phone_number_id` → resolved by phone number; `waba_id`
  never consulted.
- Template event without `metadata` → resolved by `waba_id`.
- **Two accounts sharing one `waba_id`, template event → 401, no side effect,
  both `account_id`s logged.**
- Row with `waba_id = NULL` still resolves via `phone_number_id`.

**Status isolation (§4.4)**

- A and B both hold a message row with the *same* `message_id`. A status webhook
  verified for A updates **only A's** row.
- Forward-only transition guard behaves as characterized in 8.0b.
- No `broadcast_recipients` equivalent — uniquely indexed, case unconstructible.

**Config route**

- `app_secret` encrypted at rest, absent from every response and log line.
- **A user-scoped Supabase client cannot select credential columns at all.**
  Query `whatsapp_config` as `authenticated` asking for `access_token` → a
  permission error, not a row with nulls. This is criterion #4's real test;
  asserting only the narrowed UI `select` would pass while the database still
  handed the columns to anyone who asked (§6.2).
- The same client **can** still read the safe columns for its own account, and
  cannot read another account's row at all (RLS unchanged).
- Both browser components render correctly with the narrowed list —
  `whatsapp-config.tsx` and `settings-overview.tsx`.
- **Every Meta-calling path still works after the `REVOKE`**: send, broadcast,
  react, media, all three template routes, verify-registration, and the
  automations / flows / broadcast-core senders. This is the regression surface
  of §6.2(c) and it is larger than anything else in this release.

**App Secret requirement (§5.1.1) — one per row of the table**

- **New connection with no `app_secret` → 400, nothing written, no wasted Meta
  call.** The regression test for §1; if it is ever deleted, the bug returns.
- New connection with `app_secret` → stored encrypted.
- Existing connection re-saved with it **omitted** → stored ciphertext
  byte-identical afterwards.
- Grandfathered `NULL` row re-saved without one → still `NULL`, still verifying
  via `META_APP_SECRET`, no 400.
- Literal mask string submitted → rejected server-side, stored value unchanged.

**Bug fixes and authorization**

- Registration error on an existing `connected` row, same `phone_number_id` →
  `status` stays `connected`, `connected_at` unchanged, error recorded.
- Registration error on a brand-new connection → `disconnected`.
- Subscription failure → reported in the response; `subscribed_apps_at` not set.
- Duplicate `phone_number_id` from another account → 409, no write.
- **Agent and viewer cannot POST or DELETE → 403, no side effect; owner/admin
  can** (`requireRole('admin')`, §5.4). This asserts *new* behaviour — the gate
  does not exist before 8.9a, and the 8.0b baseline test documents its absence.
- `GET` remains available to any member and still returns no credential column.

**Manual / UAT**

1. Two workspaces on two client-owned Meta apps, one shared callback URL.
2. Message each number → each lands once, in the correct inbox only.
3. Reply from both → both deliver.
4. Re-save workspace A → A stays live, B untouched.
5. Change A's App Secret in Meta without updating ConnectsWA → A's inbound stops,
   B keeps working. Update A → A recovers.

**Acceptance criteria:** `TEST-PLAN.md` **§5A.6** — canonical list of ten. Not
restated here; amend it there.

## 10. Rollout

0. **Pre-flight: every existing row needs a `waba_id`.**

   ```sql
   SELECT id, account_id, phone_number_id FROM whatsapp_config WHERE waba_id IS NULL;
   ```

   Must return zero rows. §4.1.1 resolves template-lifecycle events by
   `entry.id → waba_id` — they carry no `metadata.phone_number_id` — so a row
   with `waba_id = NULL` stops receiving template status updates after this
   deploy, and the delivery is rejected at the gate rather than dropped
   internally. Backfill from WhatsApp Manager before deploying. This is a
   behaviour change from today, where template events were handled without
   resolving a connection at all.

1. **Deploy to the permanent Hostinger domain first.** Callback URLs handed to
   clients must never point at a tunnel.
2. Run migration 037 in the Supabase SQL editor. Existing rows get
   `app_secret = NULL` and keep using `META_APP_SECRET` — no client action, no
   downtime. **The grant statements are the exception: do not run them until
   §6.2(c) is deployed**, or sending goes offline (task 8.10a).
3. Tag the current production commit, then deploy: Pull → `npm ci` →
   `npm run build` → Restart.
4. Verify the existing connection still sends and receives.
5. Onboard the next client. Their App Secret is now **mandatory** (§5.1.1), so it
   cannot be forgotten. Confirm both work at once.
6. Backfill the first client's App Secret whenever convenient — the fallback
   means no deadline, and §5.1.1 row 4 means a re-save won't demand it.

**Rollback:** redeploy the tagged commit. The columns are additive and ignored by
old code, so leave them. Any client already relying on their own App Secret loses
inbound until redeployed — so prove the two-client case before onboarding a third.

## 11. Open items

1. **`META_APP_SECRET` fallback** retires once every connection has its own
   secret. No urgency. `claude-02` §4.1 narrows it to `manual` first.
2. **Credentials in a separate server-only table** — still archived, still not
   built. §6.2's column `REVOKE` closes the browser-read hole that criterion #4
   names; a dedicated table would additionally survive someone re-granting the
   columns by accident. Revisit only if that becomes a real risk.

   > This item previously deferred the *whole* browser-read problem. That
   > deferral was withdrawn: it contradicted approved criterion #4, and §6.2 now
   > closes it inside P1-10.
3. **Graph API version.** Pinned `v21.0` (`meta-api.ts:12`) while Meta's examples
   are `v25.0`. A clock, not a preference. Its own small change — never inside
   the Embedded Signup branch.
4. **`messages.account_id`.** §4.4 scopes through `conversations.account_id`
   rather than denormalising. Revisit only if the join shows up in query timings.
5. **`whatsapp_config.user_id` is a vestige.** Migration 001 keyed the table on
   it with `UNIQUE(user_id)`; 017 moved the tenant key to `account_id` and
   dropped that constraint. One reader remains — `lib/api/v1/contacts.ts:78`,
   using it as "who owns this config" for API-key attribution. Deliberately left
   out of §6.2's GRANT list (service role bypasses grants). Removing the column
   is a separate cleanup, not part of this release.
