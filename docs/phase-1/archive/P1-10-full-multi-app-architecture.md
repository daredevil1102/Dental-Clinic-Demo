# P1-10 (ARCHIVED) — Stage 1: manual multi-app WhatsApp onboarding

> **⚠️ ARCHIVED 2026-08-10 — not the active plan.**
>
> Superseded by [../P1-10-whatsapp-connection-architecture.md](../P1-10-whatsapp-connection-architecture.md),
> which fixes the same blocking defect (one global App Secret) in ~1–2 days
> instead of 5–8 by adding a single encrypted `app_secret` column and selecting
> the secret per tenant.
>
> **Why archived:** the operating model is hosted-and-hand-held at a handful of
> clients. This document is scoped for a larger operation — server-only credential
> repository, expand/contract migration pair, connection state machine, per-client
> callback URLs, credential rotation semantics. All of it is sound and none of it
> is wrong; it simply doesn't earn its cost yet.
>
> **Revisit this when any of these become true:** client count outgrows
> hand-holding; workspace teams grow enough that ciphertext exposure to ordinary
> members matters; Embedded Signup (P1-11) needs the shared dispatcher and
> credential repository; or credential rotation becomes routine rather than rare.
>
> **Known defects if resurrected as-is** (found in review, never fixed here):
> `connection_state TEXT NOT NULL` in §3.8 has no default and will fail on a table
> with existing rows; and the §3.8 constraints requiring `meta_app_id`,
> `webhook_key` and all three credentials would reject P1-11 provider rows unless
> written conditionally on `connection_method`.

- **Status:** Archived (was: Approved)
- **Effort:** ~5–8 engineering days plus one-client-at-a-time migration/UAT
- **Branch:** `feat/p1-10-manual-multi-app`
- **Last updated:** 2026-08-10
- **Depends on:** current frozen manual-onboarding baseline
- **Blocks:** P1-11 (Stage 2: WhatsApp Embedded Signup v4)

> **Stage boundary:** P1-10 ships a complete, production-safe manual onboarding
> release. Multiple clients can use different client-owned Meta apps and App
> Secrets simultaneously. It does not ship Embedded Signup or a provider
> webhook. P1-11 is built only after P1-10 is merged, deployed, and signed off.
> P1-10 is the production launch bridge while the ConnectsWA provider app is
> built and reviewed; it is not the intended hosted end state.

---

## 1. Context & problem

ConnectsWA is one hosted multi-tenant deployment. Each customer receives an
account/workspace, and `whatsapp_config.account_id` already scopes one WhatsApp
configuration to that workspace. Inbound messages are routed to the workspace
by `phone_number_id`.

The current implementation is not multi-app-safe, however:

- `src/lib/whatsapp/webhook-signature.ts` verifies every webhook POST with one
  deployment-wide `META_APP_SECRET`.
- The manual form accepts `phone_number_id`, `waba_id`, `access_token`,
  `verify_token`, and an optional PIN, but not a per-workspace Meta App ID or
  App Secret.
- `src/components/settings/whatsapp-config.tsx` reads
  `whatsapp_config.select('*')` directly from the browser instead of receiving a
  deliberately sanitized server response.
- Workspace `owner` and `admin` roles already have permission to manage
  WhatsApp settings. There is no platform-operator role, and none is required.

Consequently, this legitimate hosted setup cannot work today:

| Workspace | Meta app           | Webhook signature secret |
| --------- | ------------------ | ------------------------ |
| Client A  | Client-owned App A | Secret A                 |
| Client B  | Client-owned App B | Secret B                 |

Whichever secret is placed in `META_APP_SECRET` works; webhook POSTs from the
other app fail with HTTP 401. Outbound calls can still appear healthy because
they use each workspace's access token, masking the inbound failure.

P1-10 fixes that manual multi-app limitation and defines the common connection,
secret-access, webhook-dispatch, and state boundaries that P1-11 must reuse.
Until P1-11 passes Meta review and production UAT, every client continues to be
onboarded manually through P1-10.

### Confirmed existing assets to retain

| Existing asset            | Current location                            | How it is used                                         |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Account-scoped connection | `whatsapp_config.account_id`, migration 017 | Remains one connection per workspace                   |
| Unique number ownership   | migration 013                               | Same `phone_number_id` cannot belong to two workspaces |
| Access-token encryption   | `src/lib/whatsapp/encryption.ts`            | Reuse behind a server-only credential repository       |
| Credential verification   | `verifyPhoneNumber()`                       | Reuse before persistence                               |
| Phone registration        | `registerPhoneNumber()`                     | Reuse for both methods                                 |
| WABA app subscription     | `subscribeWabaToApp()`                      | Reuse for both methods                                 |
| Inbound tenant routing    | `webhook/route.ts` by `phone_number_id`     | Extract into a shared post-verification dispatcher     |
| Workspace authorization   | `owner`/`admin`, `requireRole('admin')`     | Credential management stays workspace-scoped           |

---

## 2. Goals / Non-goals

### Goals

- Multiple workspaces using different client-owned Meta apps and App Secrets
  work simultaneously in one hosted ConnectsWA deployment.
- A workspace owner/admin can create or rotate its manual credentials. Manish
  can assist through remote desktop or temporary workspace-admin membership;
  no cross-tenant operator privilege is introduced.
- Every webhook is verified with the correct App Secret before any database or
  messaging side effect.
- Secret values are encrypted at rest, masked after saving, never logged, and
  never queryable or returned to the browser, including ciphertext.
- Credential rotation affects only the selected workspace.
- Existing manual clients migrate without downtime.
- P1-10 is independently deployable, testable, rollbackable, and useful before
  any provider-app approval.

### Non-goals

- WhatsApp Business mobile-app Coexistence, QR onboarding, history sync, or
  `smb_app_data`.
- Combining a client-owned Meta app and the provider app within one active
  workspace connection.
- Automatic switching from Embedded Signup to manual onboarding. The workspace
  explicitly chooses manual setup after the failed attempt is understood.
- A platform-operator or super-admin authorization layer.
- Multi-number support. `UNIQUE(account_id)` remains: one active WhatsApp number
  per workspace.
- Storing Meta passwords or asking for a client's Facebook login credentials.
- Automatically migrating an active manual connection to Embedded Signup.
- Embedded Signup SDK, OAuth/code exchange, provider webhook, Meta App Review,
  deauthorization callback, data-deletion callback, or provider tokens. These
  belong to P1-11.
- Manual-to-provider migration. P1-10 does not implement it; P1-11 owns the
  explicit one-client-at-a-time cutover to the approved ConnectsWA provider app.

---

## 3. Approach

### 3.1 Connection model

One record remains the source of truth for the workspace's active WhatsApp
connection:

```text
whatsapp_config
  account_id             one workspace
  connection_method      manual_client_app
  connection_state       pending_webhook | ok | not_registered | needs_reconnect
  webhook_mode           legacy_global | manual_unique
  webhook_verified_at    last successful signed webhook, nullable
  phone_number_id
  waba_id
  meta_app_id
  webhook_key           random, unique callback routing key
  business_id           optional operational reference
  system_user_id        optional operational reference

whatsapp_connection_secrets (server-only; no authenticated policies)
  whatsapp_config_id    primary key and cascading foreign key
  access_token_encrypted
  app_secret_encrypted
  verify_token_encrypted
  updated_at
  updated_by
```

`whatsapp_config` contains safe connection metadata. Plaintext and ciphertext
credentials live only behind the server-only credential repository. P1-11 will
extend the allowed `connection_method` and `webhook_mode` values; it must not
introduce a second configuration system.

### 3.2 Webhook architecture options considered

#### Option A — unique manual callback URL per workspace (recommended)

```text
Manual App A -> /api/whatsapp/webhook/manual/<random-key-A>
Manual App B -> /api/whatsapp/webhook/manual/<random-key-B>
Provider App -> /api/whatsapp/webhook/provider
```

The random key locates the candidate connection and therefore the correct
encrypted App Secret. It is a routing identifier, not authentication; the HMAC
signature remains mandatory.

Advantages:

- Secret selection happens before trusting the webhook body.
- Manual workspaces are isolated from each other.
- GET verification no longer scans and decrypts every workspace verify token.
- `account_update` and other non-message payloads do not need special body
  parsing merely to locate the secret.
- Diagnosing a bad callback is account-specific.

Cost: each manually onboarded Meta app receives a workspace-specific callback
URL. This is acceptable because the apps are already created and configured
one client at a time.

#### Option B — one shared callback, parse the body to select a secret

Parse the untrusted raw body just enough to extract `phone_number_id` or WABA
ID, look up the workspace, then verify the HMAC before processing it.

This can work, but it requires different lookup rules for messages,
`account_update`, statuses and future webhook shapes. It makes the security
boundary harder to reason about and test.

#### Option C — try every stored App Secret

Attempt HMAC verification against all workspace secrets until one matches.

Rejected: work grows linearly with customer count, every request decrypts many
secrets, denial-of-service cost increases, and failure logs cannot identify the
intended workspace cleanly.

### 3.3 Recommended webhook flow

#### Manual client-owned app

```mermaid
sequenceDiagram
    participant M as "Client Meta app"
    participant R as "Manual webhook route"
    participant C as "whatsapp_config"
    participant D as "Shared webhook dispatcher"

    M->>R: "POST /manual/{webhook_key} + raw body + HMAC"
    R->>C: "Lookup active manual connection by webhook_key"
    C-->>R: "Encrypted App Secret + workspace connection"
    R->>R: "Decrypt secret and verify HMAC over untouched raw body"
    alt Invalid signature or unknown key
        R-->>M: "401; no side effects"
    else Valid signature
        R->>D: "Verified body + resolved connection"
        D->>D: "Process messages/statuses for account_id"
        R-->>M: "200"
    end
```

#### Future P1-11 provider app (boundary only; not implemented in P1-10)

```mermaid
sequenceDiagram
    participant M as "ConnectsWA provider Meta app"
    participant R as "Provider webhook route"
    participant D as "Shared webhook dispatcher"

    M->>R: "POST /provider + raw body + HMAC"
    R->>R: "Verify with deployment META_PROVIDER_APP_SECRET"
    alt Invalid signature
        R-->>M: "401; no side effects"
    else Valid signature
        R->>D: "Verified body"
        D->>D: "Resolve account by phone_number_id or WABA"
        R-->>M: "200"
    end
```

Both routes terminate at one shared dispatcher. Signature selection and
verification differ; message parsing, tenancy, persistence, automations and
status handling must not be duplicated.

### 3.4 Manual onboarding flow

1. Workspace owner/admin opens Settings → WhatsApp → Manual setup.
2. They enter:
   - Meta App ID;
   - Meta App Secret;
   - Phone Number ID;
   - WABA ID;
   - permanent system-user access token;
   - webhook verify token;
   - six-digit registration PIN;
   - optional Business Portfolio ID and System User ID for support reference.
3. The server enforces `requireRole('admin')` and validates field shapes.
4. The server verifies the access token against the Phone Number ID.
5. The server checks that no other account owns the number.
6. The server registers the number and subscribes the WABA using the existing
   Meta helpers.
7. The server encrypts the access token, App Secret and verify token.
8. The server generates a cryptographically random `webhook_key` and persists
   `connection_method='manual_client_app'`, `webhook_mode='manual_unique'`, and
   `connection_state='pending_webhook'`.
9. The sanitized response returns the callback URL, never a stored secret.
10. The workspace owner/admin configures that URL and the chosen verify token
    in the client-owned Meta app.
11. ConnectsWA runs registration, subscription, inbound and outbound smoke
    checks before showing `Live`. A valid signed POST sets
    `webhook_verified_at` and allows `connection_state='ok'`; a successful GET
    challenge alone does not prove POST signature verification.

After save, secret inputs show only a fixed mask. Changing a secret requires
entering the complete replacement value; no reveal endpoint exists.

### 3.5 Credential rotation and support

No platform-operator layer is added. After handover, a client can:

- rotate credentials themselves as workspace owner/admin;
- use remote desktop while Manish guides the change; or
- invite Manish temporarily as a workspace admin and remove/downgrade the
  membership after the support session.

Access-token rotation:

1. Generate the replacement token with the same required assets/permissions.
2. Save it in ConnectsWA.
3. Test outbound and inbound messaging.
4. Revoke the old token only after the replacement passes.

App-Secret rotation:

1. Keep the unique callback URL unchanged.
2. Save the new App Secret in the workspace immediately after resetting it in
   Meta.
3. Send an inbound test message and confirm webhook signature verification.
4. A failure affects only that workspace; other clients use different secrets.

Every successful credential change records `credentials_updated_at` and
`credentials_updated_by`. Do not store historical secret values.

### 3.6 Server-only credential repository

A sanitized API response is not sufficient while authenticated Supabase users
can query `whatsapp_config` directly through its current SELECT policy. Stage 1
therefore separates credentials from browser-readable metadata.

Create `src/lib/whatsapp/connection-secrets.ts` as the only application module
allowed to read, write, rotate, or delete WhatsApp credentials. It uses the
service-role client after the calling route has resolved and authorized the
workspace. It exposes these server-only operations:

```ts
export type WhatsAppConnectionSecrets = {
  accessToken: string
  appSecret: string | null
  verifyToken: string | null
}

getConnectionSecrets(args: {
  accountId: string
  whatsappConfigId: string
}): Promise<WhatsAppConnectionSecrets>
saveConnectionSecrets(args: {
  accountId: string
  whatsappConfigId: string
  accessToken: string
  appSecret: string
  verifyToken: string
  updatedBy: string
}): Promise<void>
deleteConnectionSecrets(args: {
  accountId: string
  whatsappConfigId: string
}): Promise<void>
```

Every repository operation verifies that `whatsapp_config.id` belongs to the
supplied `accountId` before touching the secret row. Knowing another
workspace's configuration UUID is insufficient to read or mutate its secrets.

All current token consumers—including send, templates, broadcasts, flows,
automations, media, reactions, webhook handling, registration diagnostics and
the configuration routes—must use this repository. No route selects encrypted
credential columns directly after the contract migration.

`whatsapp_connection_secrets` has RLS enabled and no policies for
`anon`/`authenticated`. The service role is the only access path. The settings
component receives a sanitized server response and never calls
`whatsapp_config.select('*')`.

### 3.7 API and state-transition contract

`GET /api/whatsapp/config` returns status only:

```json
{
  "configured": true,
  "connectionMethod": "manual_client_app",
  "connectionState": "pending_webhook",
  "phoneNumberId": "123",
  "wabaId": "456",
  "metaAppId": "789",
  "businessId": null,
  "systemUserId": null,
  "callbackUrl": "https://host/api/whatsapp/webhook/manual/<key>",
  "hasAccessToken": true,
  "hasAppSecret": true,
  "hasVerifyToken": true,
  "webhookVerifiedAt": null,
  "credentialsUpdatedAt": "2026-08-10T12:00:00.000Z"
}
```

The response must not contain `access_token`, `app_secret`, `verify_token`,
their encrypted forms, or a reversible mask.

`POST /api/whatsapp/config` creates a new manual connection. `PATCH` rotates
only explicitly supplied credentials; omitted fields remain unchanged.
`DELETE` disconnects and removes both metadata and secrets. Writes require
workspace owner/admin. Stable error codes are:

```text
unauthorized | forbidden | invalid_request | duplicate_phone_number
meta_verification_failed | registration_failed | subscription_failed
secret_storage_failed | connection_not_found | conflict
```

State ownership is explicit:

| From              | Event/owner                                  | To                                  | Rule                                                                 |
| ----------------- | -------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| none              | successful POST/config route                 | `pending_webhook`                   | Token verified, number registered/subscribed, secrets saved          |
| `pending_webhook` | valid signed POST/manual webhook route       | `ok`                                | GET challenge alone never marks live                                 |
| any active state  | invalid/revoked token detected by server API | `needs_reconnect`                   | Never caused by a transient network error                            |
| `needs_reconnect` | successful access-token PATCH                | previous state or `pending_webhook` | Preserve the old working token when replacement verification fails   |
| `ok`              | App Secret PATCH                             | `pending_webhook`                   | New secret replaces old atomically; next signed POST returns to `ok` |
| any               | DELETE/config route                          | row removed                         | Other workspaces remain untouched                                    |

Credential rotation is fail-safe:

- Verify a replacement access token before overwriting the stored token.
- Failed verification leaves the old token and connection state unchanged.
- App Secret replacement is atomic and immediately discards the previous value;
  it sets `pending_webhook` until a valid signed POST arrives.
- Never downgrade another workspace or reuse one workspace's secret as fallback.

### 3.8 Data model and expand/contract migrations

P1-10 owns two ordered migrations. P1-11 starts at migration 039.

1. `037_whatsapp_connection_methods_expand.sql` adds safe metadata columns,
   creates `whatsapp_connection_secrets`, copies existing ciphertext into it,
   and leaves the legacy columns temporarily available.
2. `038_whatsapp_connection_secrets_contract.sql` runs only after every server
   reader uses `connection-secrets.ts`; it removes authenticated access to raw
   configuration data and drops the legacy `access_token`/`verify_token`
   columns from `whatsapp_config`.

Migration 037 adds:

```sql
connection_method       TEXT NOT NULL DEFAULT 'manual_client_app'
connection_state        TEXT NOT NULL
webhook_mode            TEXT NOT NULL DEFAULT 'legacy_global'
meta_app_id              TEXT
business_id              TEXT
system_user_id           TEXT
webhook_key              UUID UNIQUE
webhook_verified_at      TIMESTAMPTZ
credentials_updated_at  TIMESTAMPTZ
credentials_updated_by  UUID
```

It also creates:

```sql
whatsapp_connection_secrets (
  whatsapp_config_id UUID PRIMARY KEY REFERENCES whatsapp_config(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  app_secret_encrypted TEXT,
  verify_token_encrypted TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
)
```

Constraints for Stage 1:

- `connection_method = 'manual_client_app'`.
- `connection_state IN
('pending_webhook','ok','not_registered','needs_reconnect')`.
- `webhook_mode IN ('legacy_global','manual_unique')`.
- New manual connections require `manual_unique`, `meta_app_id`, `webhook_key`,
  and all three encrypted credential values in the secret table.
- `UNIQUE(account_id)` and `UNIQUE(phone_number_id)` remain.

Backfill existing rows as `manual_client_app` + `legacy_global`, copy their
encrypted credentials without decrypting/re-encrypting, and derive state:

```text
status = disconnected                   -> needs_reconnect
status = connected, registered_at NULL  -> not_registered
otherwise                               -> ok
```

Before migration 038, assert that every `whatsapp_config` row has exactly one
secret row and that no secret row is orphaned. The contract migration must fail
loudly if those counts do not match. Deploy order is: migration 037 → compatible
application code → data assertions and smoke tests → application code with no
legacy reads → migration 038. The legacy `/api/whatsapp/webhook` URL may remain
live, but its GET verification-token lookup and opportunistic re-encryption write
must use `connection-secrets.ts` before 038 drops the old columns. Do not apply
037 and 038 back-to-back before this intermediate verification gate.

### 3.9 Authorization and secret handling

- Manual credential POST/PATCH/DELETE routes require workspace `admin` or
  `owner` using the existing `requireRole('admin')` boundary.
- Agents and viewers receive sanitized connection status only.
- Replace the browser's direct `whatsapp_config.select('*')` with the config GET
  endpoint defined in §3.7.
- Encrypt App Secrets, access tokens and verify tokens with the existing
  AES-256-GCM helper and store them only in `whatsapp_connection_secrets`.
- Enable RLS on the secret table and create no `anon` or `authenticated`
  policies. Tests must prove authenticated clients cannot SELECT, INSERT,
  UPDATE, or DELETE secret rows.
- Never log request bodies from credential endpoints, exchange codes or Meta
  tokens.
- Never include ciphertext in client responses; ciphertext is implementation
  data, not a useful mask.
- `webhook_key` is random and non-sequential. It is safe to display as part of
  the callback URL, but it does not replace HMAC verification.
- All webhook routes fail closed when a key/connection/secret/signature cannot
  be resolved.

### 3.10 Current files affected

| File/area                                                          | Change                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `supabase/migrations/037_whatsapp_connection_methods_expand.sql`   | Add manual metadata and server-only secret table; copy legacy ciphertext                         |
| `supabase/migrations/038_whatsapp_connection_secrets_contract.sql` | Assert copy completeness; remove legacy columns/client raw-table access                          |
| `src/types/index.ts`                                               | Extend `WhatsAppConfig`; add safe response and connection-method types                           |
| `src/lib/whatsapp/encryption.ts`                                   | Reuse; optionally add purpose-specific wrappers to prevent field mix-ups                         |
| `src/lib/whatsapp/connection-secrets.ts`                           | Sole server-only credential repository                                                           |
| `src/lib/whatsapp/webhook-signature.ts`                            | Accept an explicitly resolved secret instead of reading global env internally                    |
| `src/lib/whatsapp/webhook-dispatch.ts`                             | New shared verified-event dispatcher extracted from the current route                            |
| `src/app/api/whatsapp/webhook/manual/[webhookKey]/route.ts`        | New manual GET handshake and POST signature boundary                                             |
| `src/app/api/whatsapp/webhook/route.ts`                            | Retain temporarily as the legacy compatibility route; remove only after migration                |
| `src/app/api/whatsapp/config/route.ts`                             | Explicit `admin` authorization, per-app fields, sanitized GET, rotation semantics                |
| `src/app/api/whatsapp/config/verify-registration/route.ts`         | Report connection method and correct webhook checks                                              |
| `src/lib/whatsapp/connect.ts`                                      | Manual connection persistence/state logic; P1-11 later reuses it                                 |
| `src/lib/whatsapp/meta-api.ts`                                     | Read a pinned `META_GRAPH_VERSION`; preserve v21 first, then test any bump alone                 |
| `src/components/settings/whatsapp-config.tsx`                      | Stop direct DB reads; show method/status; manual masked credential form                          |
| `src/components/settings/settings-overview.tsx`                    | Replace direct `whatsapp_config` read with the sanitized config API                              |
| `messages/en.json`, `messages/ko.json`                             | Manual connection, verification, failure, and rotation copy                                      |
| `.env.local.example`                                               | Add `META_GRAPH_VERSION`; rename global secret to `META_LEGACY_APP_SECRET`; no provider vars yet |
| `docs/phase-1/P1-11-embedded-signup.md`                            | Depend on P1-10 model; correct migration number and webhook architecture                         |
| `docs/phase-1/TEST-PLAN.md`                                        | P1-10 characterization, multi-app, secret-RLS, migration, and rotation UAT                       |
| `docs/phase-1/runbooks/P1-10-manual-onboarding.md`                 | Versioned deployed-state checklist: seven inputs, unique callback, rotation/rollback             |

### 3.11 Legacy compatibility and migration

Do not replace `/api/whatsapp/webhook` in one deployment.

1. Add new schema and routes while the legacy URL and observable behavior remain
   compatible. Refactor its GET secret read and opportunistic re-encryption
   write through `connection-secrets.ts` before migration 038.
2. Add characterization tests around the current manual config route and legacy
   webhook before refactoring.
3. For each existing manual workspace:
   - enter its Meta App ID and App Secret;
   - generate its `webhook_key`;
   - update that client's Meta app to the unique callback URL;
   - verify GET handshake;
   - test inbound and outbound;
   - mark the workspace migrated.
4. Apply the contract migration only after all server readers use the secret
   repository and the row-count assertions pass.
5. Remove the legacy global-secret webhook only when no active configuration
   references it.

Rollback is per workspace: a bad manual migration reverts that client's Meta
callback to the legacy endpoint while the legacy route and
`META_LEGACY_APP_SECRET` are still present.

---

## 4. Task breakdown

### P1-10A — freeze the current behavior before refactoring

- [ ] Add `src/app/api/whatsapp/config/route.test.ts` covering GET, POST and
      DELETE; unauthenticated, agent/viewer, owner/admin; duplicate-number 409;
      token verification; registration; subscription; encryption; and tenancy.
- [ ] Add `src/app/api/whatsapp/webhook/route.test.ts` covering GET verify-token
      match/mismatch, POST HMAC match/mismatch, untouched raw bytes, malformed
      JSON, unknown number, messages, statuses and template-status events.
- [ ] Run those tests against the unchanged implementation and record the
      current manual onboarding smoke result in `TEST-PLAN.md`.
- [ ] Stop if the characterization suite does not pass before refactoring.

### P1-10B — expand schema and introduce the credential repository

- [ ] Add migration 037 exactly as §3.8 specifies; test it against a disposable
      Supabase database containing representative legacy rows.
- [ ] Add `ConnectionMethod`, `ConnectionState`, `WebhookMode`,
      `SafeWhatsAppConfig` and server-only secret types.
- [ ] Add `connection-secrets.ts` and unit tests for encrypt/decrypt, missing or
      corrupt rows, rotation, deletion and service-role-only access.
- [ ] Change all WhatsApp access-token readers listed in §3.6 to use the
      repository, with a temporary legacy fallback only during the expand
      deployment.
- [ ] Dual-write legacy and new secret storage only until the migration
      completeness assertion passes; never expose either representation.

### P1-10C — safe config API and manual settings UI

- [ ] Enforce workspace owner/admin on config POST, PATCH and DELETE.
- [ ] Implement the exact sanitized GET and stable error codes in §3.7.
- [ ] Replace the settings component's direct Supabase query with the API.
- [ ] Replace `settings-overview.tsx`'s direct `whatsapp_config` query with the
      same sanitized API so migration 038 cannot break the overview page.
- [ ] Add full Meta App ID, App Secret, access token and verify-token inputs;
      saved secrets render only fixed masks and require full replacement values.
- [ ] Verify replacement access tokens before overwrite and implement the
      App-Secret state transition from §3.7.

### P1-10D — multi-app manual webhooks

- [ ] Refactor signature verification to accept a resolved secret.
- [ ] Extract the shared verified-event dispatcher.
- [ ] Add unique manual webhook GET/POST route.
- [ ] Generate and display manual callback URLs.
- [ ] Prove the route loads exactly one candidate by random `webhook_key`,
      verifies the untouched body with that connection's App Secret, and never
      tries another workspace's secret.
- [ ] Keep the legacy endpoint behavior compatible while existing clients
      migrate, but move its GET verify-token lookup and re-encryption write to
      `connection-secrets.ts` before migration 038.

### P1-10E — contract secret storage and migrate clients

- [ ] Remove every legacy credential-column read and fallback from application
      code, then run the full suite before applying migration 038.
- [ ] Apply migration 038 only after its count/orphan assertions pass on the
      target database; prove authenticated Supabase clients cannot query raw
      configuration or secret rows.
- [ ] For each existing client, enter its own App ID/App Secret, generate the
      unique callback, update that client's Meta app, complete GET verification,
      receive one valid signed POST, and test outbound messaging.
- [ ] Mark the row `manual_unique`; never switch it back automatically.
- [ ] Retire the legacy endpoint and `META_LEGACY_APP_SECRET` only after the
      database contains zero `legacy_global` rows.
- [ ] Publish the versioned P1-10 runbook only with the deployed release. Do not
      overwrite the current operational checklist early; archive it as the
      pre-P1-10 procedure.

### P1-10F — isolate Graph API compatibility before P1-11

- [ ] Replace the hardcoded Graph version with `META_GRAPH_VERSION`, initially
      pinned to the current `v21.0`, and prove this refactor is behavior-neutral.
- [ ] Check Meta's current official changelog at implementation time and choose
      a supported target; do not hardcode the target in this design document.
- [ ] Test the version change in its own commit/checkpoint: every Meta API unit
      test, two-client manual inbound/outbound smoke, templates, media,
      registration and subscription. Revert this checkpoint independently if
      compatibility fails; do not debug it inside OAuth/Embedded Signup work.

### Stage 1 release gate

- [ ] A stable permanent HTTPS production host is configured before the first
      client receives a unique callback URL; rotating tunnel URLs are forbidden
      for production onboarding.
- [ ] Two simultaneous manual workspaces using different App Secrets.
- [ ] Failure/rotation in one workspace leaves all other workspaces live.
- [ ] Browser and authenticated Supabase clients cannot read plaintext or
      ciphertext credentials.
- [ ] Disposable-database migration test passes for empty, legacy and partially
      migrated fixtures.
- [ ] `META_GRAPH_VERSION` compatibility checkpoint is green at the selected
      supported version, independently of P1-11.
- [ ] Typecheck, lint, full tests and production build.
- [ ] Commit and push `feat/p1-10-manual-multi-app` only after all automated
      checks and the P1-10 UAT sign-off are green.

---

## 5. Testing & acceptance

### Automated

#### Manual multi-app webhook tests

- Client A payload + Secret A → 200 and only Account A is changed.
- Client B payload + Secret B → 200 and only Account B is changed.
- Client A callback + Secret B signature → 401, no side effects.
- Unknown/expired `webhook_key` → 404 or 401, no side effects.
- Missing or corrupt encrypted secret → fail closed, sanitized error/log.
- Manual GET handshake accepts only that workspace's verify token.
- App-Secret rotation for A does not change B.
- Access-token rotation for A does not change B.

#### Authorization and secrecy tests

- Owner/admin can save and rotate credentials.
- Agent/viewer receive 403 on writes.
- Sanitized GET never returns plaintext or ciphertext secret fields.
- Authenticated Supabase clients receive permission denied for every operation
  on `whatsapp_connection_secrets`.
- Authenticated Supabase clients cannot retrieve raw `whatsapp_config` rows
  after migration 038.
- Logs contain no App Secret, access token or verify token.
- Duplicate `phone_number_id` across workspaces returns 409.
- Failed access-token rotation preserves the working token and state.
- App-Secret rotation changes only that workspace to `pending_webhook`; a valid
  signed POST changes it to `ok`.

#### Migration and repository tests

- Migration 037 copies legacy ciphertext one-for-one without logging or
  decrypting it and derives state correctly.
- Migration 038 refuses to run when a config lacks a secret row or an orphan
  secret row exists.
- Every send/template/broadcast/flow/automation/media/reaction/webhook path
  reads credentials through `connection-secrets.ts`.
- Deleting a configuration cascades to its secret row.
- Cross-workspace secret lookup is impossible even when an attacker knows a
  `whatsapp_config_id`.

### Manual/UAT

1. Connect two test workspaces using two different client-owned Meta apps.
2. Confirm inbound/outbound independently for both.
3. Rotate only one access token; confirm both remain live.
4. Rotate only one App Secret; confirm the other remains live.
5. Verify a signed webhook for the rotated app returns that workspace to `ok`.
6. Query both protected tables with an authenticated browser client and confirm
   credentials and ciphertext are inaccessible.
7. Complete the legacy-to-unique callback migration and rollback once on a test
   workspace before touching a production client.

**Acceptance bar:** no connection depends on another workspace's secret; one
client's failure, rotation, disconnect or migration cannot interrupt another
client.

---

## 6. Rollout & rollback

### Rollout

1. Create `feat/p1-10-manual-multi-app` from the approved Phase 1 base.
2. Add and pass characterization tests before behavior changes.
3. Apply migration 037, deploy compatible repository code and verify copied
   credentials before proceeding.
4. Ship sanitized config reads and unique manual webhook routes while keeping
   the legacy webhook active.
5. Remove legacy credential reads, apply migration 038 at its explicit gate and
   rerun the full automated suite.
6. Migrate manual clients individually with explicit smoke-test sign-off.
7. Retire the legacy global-secret endpoint only after the last manual client is
   `manual_unique`.
8. Commit and push Stage 1 only when P1-10 is independently green. P1-11 starts
   from the merged and deployed P1-10 result, never from the old baseline.

### Rollback

- Manual client migration: restore that client's previous callback URL while
  the legacy endpoint remains deployed.
- Before migration 038: roll back application code to its compatible dual-read
  version; never delete copied secret rows.
- After migration 038: roll forward with a corrective migration. Do not restore
  secret columns or ciphertext to a browser-queryable table.
- A failed client callback migration reverts only that client's Meta callback
  while the legacy endpoint remains deployed.

### Operational visibility

Log only identifiers and sanitized states:

```text
account_id
connection_method
webhook route kind (manual/legacy)
waba_id / phone_number_id where safe
verification result
Meta error code without token-bearing request details
```

Provide a workspace-visible diagnostic that checks credentials, registration,
app subscription and last verified webhook time without exposing secrets.

---

## 7. Open questions / decisions

These do not block the P1-10 manual multi-app release:

1. **Audit retention:** decide how long sanitized credential-change and
   onboarding-attempt events are retained.
2. **Manual-to-provider cutover:** implemented only in P1-11, never hidden or
   automatic. P1-10 merely preserves the legacy connection until that cutover.

---

## Architecture verdict

Ship and sign off P1-10 first. The current global-secret webhook is the
foundational multi-tenant defect. Unique manual callback URLs provide the
secret-selection boundary, while the server-only repository prevents both
plaintext and ciphertext exposure through Supabase.

After Stage 1 is stable, P1-11 adds the single ConnectsWA provider app on the
same metadata, credential-repository and dispatcher foundations. Existing
manual clients can then migrate one at a time; P1-10 remains available only
until the final legacy client has completed that cutover.
