# P1-11 (ARCHIVED) — Stage 2: one provider app with Embedded Signup and assisted fallback

> **⚠️ ARCHIVED 2026-08-10 — not the active plan.**
>
> Superseded by [../P1-11-embedded-signup.md](../P1-11-embedded-signup.md), which
> delivers Embedded Signup in ~4–6 days instead of 6–10 by treating migration as a
> consequence of one design rule rather than as a feature.
>
> **Why archived:** this document made existing-client migration a first-class
> subsystem — `whatsapp_onboarding_attempts` with a nine-state machine, an
> `intent`/`migrate_to_provider` path, `legacy_connection_changed` detection, a
> transactional swap, and a `provider_manual` assisted route gated on an unproven
> Meta capability (§3.1a). At hand-held scale the operator is the failure
> classifier, and migration reduces to "ES is allowed to overwrite the account's
> existing connection row, but only after the subscribe step succeeds."
>
> It also assumed the archived P1-10 had delivered a server-only credential
> repository, a `connect.ts` persistence helper and an extracted dispatcher. The
> shipped P1-10 builds none of those.
>
> **Worth mining if resurrected:** the Meta reference-link table (§0), the event
> shapes and popup edge cases (§3.7), the Track A dashboard checklist
> (Appendix A) and the verified-facts table (Appendix B) are all still accurate —
> the trimmed versions of these carried forward into the active doc.

- **Status:** Archived (was: Approved)
- **Effort:** ~6–10 days code/UAT (Track B). Meta-side (Track A) is days–weeks and
  runs in parallel; App Review is the long pole, not the code.
- **Branch:** `feat/p1-11-embedded-signup`
- **Last updated:** 2026-08-10
- **Hard dependency:** P1-10 is merged, deployed, migrated to
  `manual_unique`, and signed off. This branch starts from that result.
- **Lifecycle:** P1-10 is the temporary launch bridge. P1-11 makes one approved
  ConnectsWA provider app the hosted end state and migrates legacy clients one
  at a time without bulk or automatic conversion.
- **Implementation gates:** P1-10 sign-off, stable HTTPS hosts, token-expiry
  decision, §3.1a assisted-provider pilot and the Meta approval checklist.

> **Hard rule (per `AGENTS.md`):** this is a _modified_ Next.js. Before writing
> any Next-facing code (route handlers, `headers()` in `next.config.ts`, script
> loading, metadata), read the relevant guide in `node_modules/next/dist/docs/`.
> Training-data assumptions about the App Router may be wrong here.

---

## 0. Reference links

### Meta documentation (all read and verified 2026-08-09)

| Topic                                                            | Link                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Embedded Signup overview                                         | https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/                                            |
| Official Meta Embedded Signup API collection                     | https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup                                                  |
| **Implementation** (SDK, event shapes, dashboard settings)       | https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation                                       |
| **Onboarding customers as a Tech Provider** (the 5 server steps) | https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider              |
| Version 4 (what changed, config templates)                       | https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4                                            |
| Versions / deprecation timeline                                  | https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions                                             |
| Cloud API default flow                                           | https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/default-flow                                         |
| Embedded Signup flow errors + abandoned-step names               | https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors                                               |
| Access tokens (business integration system user tokens)          | https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens                                                        |
| Become a Tech Provider                                           | https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers/                   |
| App Review for partners                                          | https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review/                                       |
| Subscribed Apps API                                              | https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api              |
| Phone Number Registration API                                    | https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/phone-number-registration   |
| Phone Number Deregister API                                      | https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/phone-number-deregister-api |
| `account_update` webhook reference                               | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update                                    |
| Webhook callback URL override                                    | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override                                                    |
| Facebook Login for Business (token expiry config)                | https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business                                                       |
| Data Deletion Request callback                                   | https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback                                            |
| Deauthorize callback                                             | https://developers.facebook.com/docs/development/create-an-app/app-dashboard/deauthorize-callback                                              |
| `signed_request` parsing                                         | https://developers.facebook.com/docs/reference/login/signed-request/                                                                           |

> **Tip for Claude Code:** every Meta doc page has a plain-Markdown twin at the
> same URL with `.md` appended (e.g.
> `…/embedded-signup/implementation.md`). Fetch that form — it is ~10× smaller
> than the HTML and contains the full body text and code samples.

### Reference implementation (read-only, outside this repo)

OpenBSP — a registered Tech Provider whose standard-flow code was read directly
and used to cross-check every claim below.

- Server: `C:\Users\manis\Desktop\Claude\OpenBSP\open-bsp-api\open-bsp-api\supabase\functions\whatsapp-management\embedded_signup.ts`
- Frontend: `C:\Users\manis\Desktop\Claude\OpenBSP\open-bsp-ui\src\contexts\WhatsAppIntegrationContext.tsx`
- Upstream: https://github.com/matiasbattocchia/open-bsp-api

### Supporting analysis in the parent folder (not versioned in this repo)

- `../../../embedded-signup-plan.md` — earlier v5 plan. **Superseded in parts.**
- `../../../embedded-signup-implementation-recommendation.md` — the
  triangulation that produced this doc; explains _why_ v5 was corrected.

---

## 1. Context & problem

**P1-11 begins after P1-10.** At that point ConnectsWA already supports multiple
simultaneous manual clients, each with a client-owned Meta app, unique callback
URL and server-only credentials. That path is production-safe and remains the
launch bridge until the ConnectsWA provider app completes every Meta production
prerequisite; it is not the intended long-term hosted architecture.

That is fine for a developer and unusable for a paying client. It requires the
client to create a Meta app, generate a token, and hand us a long-lived
credential — a support burden and a security smell.

**Embedded Signup (ES)** adds a second onboarding method: the client clicks
_Connect WhatsApp_,
completes Meta's own popup (login → business selection → phone number add and
verification → permissions), and we receive a one-time code plus their WABA ID
and phone number ID. We exchange the code server-side for a per-client business
token. We never see their password and they never see a token.

**Before P1-11, no OAuth / ES code exists in the repo.** There is no
`oauth/access_token` call, no `connect.facebook.net` reference, no
`deauthorize` or `data-deletion` route, and no `account_update` webhook
handling.

**Why now:** Embedded Signup **v2 is deprecated on 15 Oct 2026**
([Meta banner](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions)).
v4 was released 8 Oct 2025 and is what we build. App Review is the long pole, so
Track A can run while P1-10 is implemented, but P1-11 code does not merge until
Stage 1 is deployed and stable.

### What already exists and is reusable (verified by reading the files)

| Asset                                                    | Location                                                                                                                | Note                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `verifyPhoneNumber({phoneNumberId, accessToken})`        | `src/lib/whatsapp/meta-api.ts:54`                                                                                       | = Meta onboarding metadata step. Reuse verbatim.                                                                        |
| `registerPhoneNumber({phoneNumberId, accessToken, pin})` | `src/lib/whatsapp/meta-api.ts:123`                                                                                      | Already returns `{success, alreadyRegistered}` and treats `/already.*registered/i` as success (`:151`). Reuse verbatim. |
| `subscribeWabaToApp({wabaId, accessToken})`              | `src/lib/whatsapp/meta-api.ts:167`                                                                                      | Throws on failure. Reuse the call, **change the caller's error handling** (see §3.4).                                   |
| `getSubscribedApps({wabaId, accessToken})`               | `src/lib/whatsapp/meta-api.ts`                                                                                          | Diagnostic; already wired to the UI's "Verify Registration" button. Reuse for acceptance testing.                       |
| `connection-secrets.ts`                                  | Added by P1-10                                                                                                          | Sole server-only credential repository; ES business tokens must use it.                                                 |
| `verifyMetaWebhookSignature(rawBody, secret)`            | Refactored by P1-10                                                                                                     | P1-11 passes only `META_PROVIDER_APP_SECRET` on the provider route.                                                     |
| `webhook-dispatch.ts`                                    | Extracted by P1-10                                                                                                      | Reuse after provider HMAC verification; do not duplicate message/status processing.                                     |
| Cross-account duplicate-number 409                       | `src/app/api/whatsapp/config/route.ts:213-236`                                                                          | Service-role lookup that sees past RLS. Reuse verbatim.                                                                 |
| Tenancy                                                  | `whatsapp_config.account_id` NOT NULL + `UNIQUE(account_id)` (`017:181,281,314-328`), `UNIQUE(phone_number_id)` (`013`) | One number per account, one account per number.                                                                         |

The ES-specific Meta work is code exchange plus provider subscription,
registration, callbacks and lifecycle handling. P1-10's manual configuration
and webhook code must not be refactored again merely to add P1-11.

### Known landmines in the existing code

1. **`config/route.ts:346`** — `subscribeWabaToApp` failure is a non-fatal
   `console.warn`. Acceptable for manual setup (the user may have already
   subscribed by hand); **fatal for ES**, where it is the only thing that makes
   webhooks flow.
2. **`config/route.ts:361-363`** — when `registrationError` is truthy the row is
   written with `status: 'disconnected'`, `connected_at: null`,
   `registered_at: null`. Reusing this branch in the ES path would let a
   register hiccup **downgrade a working, live connection**. This is the single
   highest-risk regression in this feature.
3. **`meta-api.ts:12`** — `META_API_VERSION` is hardcoded `'v21.0'` and drives
   every helper via `META_API_BASE` (`:13`). The browser SDK will need its own
   version; if the two drift, subtle behaviour differences appear.
4. **Provider isolation** — the provider callback must be
   `/api/whatsapp/webhook/provider`. It never falls back to a manual secret, and
   manual routes never fall back to the provider secret.

---

## 2. Goals / Non-goals

### Goals

- A client with no Meta expertise connects their WhatsApp number to wacrm by
  clicking one button and completing Meta's popup.
- The resulting connection is **fully live**: app subscribed to their WABA,
  number registered for Cloud API, token stored encrypted, inbound messages
  routed to the correct account, outbound sends working.
- Failure modes are legible in the UI ("code expired — try again", "connected,
  finish setup", "reconnect needed") rather than a generic toast.
- Offboarding works: the client can disconnect, and Meta's Deauthorize / Data
  Deletion callbacks are honoured.
- Nothing regresses for existing manual-config users.
- After production enablement, new workspaces see Embedded Signup as the primary
  path; a supported operator-assisted path connects the same approved provider
  app when its required Meta authorization can be proven.
- Existing P1-10 clients can migrate deliberately to the provider app one at a
  time. A failed attempt leaves the active manual connection unchanged.
- The provider App Secret is a server-side deployment credential. Provider
  connections never copy it into a workspace secret row or ask a client for it.

### Non-goals (explicitly deferred)

- **Coexistence** (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, WhatsApp Business
  app numbers, QR onboarding, contact/message history sync via
  `smb_app_data`). Out of scope; do not implement `featureType`.
- **Bulk or automatic migration.** Every P1-10 cutover is explicit, scheduled
  and verified with that client.
- **Claiming that an App Secret alone grants WABA access.** Manual provider
  onboarding requires a token and asset relationship authorized for the
  approved ConnectsWA app. If Meta has not granted that access, the server fails
  closed; it never substitutes the App Secret for customer authorization.
- **Removing legacy support before the final migration.** P1-10 remains callable
  during the transition and is retired only after no legacy rows remain.
- **Multi-number per account.** `UNIQUE(account_id)` stands; a `primary` flag is
  documented as a future path in `017`.
- **Token refresh job.** Avoided by the configuration choice in §3.1. If that
  decision changes, this becomes in-scope and the estimate grows.
- **Solution Partner path** (own system-user token, `assigned_users`, credit-line
  sharing). We are a Tech Provider; clients pay Meta directly.
- **Routing clients through a third party's Meta app.** Rejected by project
  decision.
- **Ads / Catalogs / Instagram products in the ES configuration.** Cloud API
  only — every extra asset in the config is another screen the client can
  abandon on.

### Two manual paths with different lifecycles

`manual_client_app` is the P1-10 launch/legacy path: the client owns the Meta app
and provides its App Secret. Hosted ConnectsWA deprecates this path after the
provider app is approved and removes it only when the last legacy client has
migrated.

`provider_manual` is the P1-11 assisted fallback: ConnectsWA uses the same
approved provider app and provider webhook as Embedded Signup. The owner/admin
provides only client-specific asset IDs and a provider-authorized token; there
is no provider App Secret or provider verify-token input. The server must verify
that the token belongs to/authorizes the configured provider app and can access
the stated WABA and phone number before it writes anything.

The Track A pilot in §3.1a is a release gate. Meta's official provider material
documents assigned/shared WABAs, system-user assignment and app subscription
after Embedded Signup, but does not promise that every failure can be bypassed
manually. If an independent manual grant cannot be reproduced with a disposable
WABA, `provider_manual` is limited to reconciling a partially completed ES grant;
the UI must not advertise it as a universal fallback.

For a self-host build without ConnectsWA provider variables, the Connect button
does not render and `manual_client_app` remains the only path. That self-host
case does not control the hosted ConnectsWA lifecycle.

---

## 3. Approach

### 3.0 Design principle — extend P1-10; do not rebuild manual onboarding

P1-10 already owns the manual route, sanitized configuration API, server-only
credential repository, connection-state logic and verified-event dispatcher.
P1-11 adds thin provider-specific entry points and consumes those interfaces.
It must not copy manual persistence or reopen direct credential-table access.

```text
P1-10 client-owned manual      Embedded Signup       P1-11 assisted provider
           │                       │                         │
           │               exchange code              validate provider
           │                       │                 token + WABA access
           │                       └─────────┬─────────┘
           │                                 │
           │                    subscribe → register → metadata
           │                                 │
           └──────────────────► persistConnection() ◄─────────────────┘
                   one active row + server-only secrets + state
```

### 3.1 DECISION REQUIRED BEFORE CODING — token expiry

Meta's Implementation doc tells you to create the configuration from the
template **"WhatsApp Embedded Signup Configuration With 60 Expiration Token"** —
that template issues a business token that **expires after 60 days**. Facebook
Login for Business exposes this as a config-level setting
(`set_token_expires_in_60_days`); a custom configuration can omit it.

|             | Option A — non-expiring (**recommended**)                                 | Option B — 60-day                                                           |
| ----------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Config      | Custom configuration, no token expiration                                 | Meta's named template                                                       |
| Code impact | None beyond the `needs_reconnect` state                                   | + scheduled refresh job, + `token_expires_at` monitoring, + failure surface |
| Risk        | A leaked token stays valid until revoked (mitigated: AES-256-GCM at rest) | Every client silently dies at day 60 if the job breaks                      |

**This doc assumes Option A.** If Manish chooses B, re-open §2 Non-goals and add
a refresh subsystem before estimating.

Either way `connection_state = 'needs_reconnect'` is still required — a client
can revoke the app in Business Settings at any time, and Meta can invalidate on
policy action.

### 3.1a BLOCKING META PILOT — prove the assisted provider path

Before coding or advertising `provider_manual`, run one disposable-WABA pilot
with the production-candidate provider app:

1. Deliberately stop before completing Embedded Signup end to end.
2. Through supported Meta Business Settings/API operations, establish whatever
   app/business/WABA relationship Meta requires for the provider app.
3. Obtain a token that Meta reports as authorized for the provider app and that
   can read the chosen WABA and phone number.
4. Subscribe the provider app, register the test number, send outbound and
   receive a correctly signed provider webhook.
5. Record the exact reproducible steps and required client role in the runbook.

If this cannot be reproduced, the supported fallback is narrower: retry ES or
manually reconcile an ES attempt that already shared/authorized the WABA. The
product must not claim that copying IDs or the provider App Secret can bypass a
missing authorization grant. This pilot resolves Meta behavior; it does not
change the one-provider-app product decision.

### 3.2 Environment variables

Add to `.env.local.example` **and** the Hostinger environment.

| Var                                   | Scope   | Purpose                                                         | Notes                                                                                                                                                                          |
| ------------------------------------- | ------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_META_PROVIDER_APP_ID`    | browser | `FB.init({appId})`                                              | Public provider App ID; never reuse a client-owned manual App ID.                                                                                                              |
| `NEXT_PUBLIC_META_PROVIDER_CONFIG_ID` | browser | `FB.login({config_id})`                                         | Public provider configuration ID from Track A.                                                                                                                                 |
| `META_PROVIDER_APP_ID`                | server  | code→token exchange                                             | Must equal the public provider App ID.                                                                                                                                         |
| `META_PROVIDER_APP_SECRET`            | server  | code→token exchange, provider-token validation and webhook HMAC | One deployment credential; never returned to a client or copied into a workspace secret row.                                                                                   |
| `META_GRAPH_VERSION`                  | both    | single pinned Graph version                                     | No default is assumed here. Verify the supported target against Meta's current changelog, then test the version change as an isolated compatibility checkpoint before ES code. |
| `WHATSAPP_PROVIDER_VERIFY_TOKEN`      | server  | provider webhook GET handshake                                  | Must exactly match the provider App Dashboard value.                                                                                                                           |
| `WHATSAPP_PROVIDER_REGISTER_PIN`      | server  | provider `/register` PIN                                        | Six digits; never returned to the browser or logged.                                                                                                                           |

Do not assume `META_SYSTEM_USER_ID` / `META_SYSTEM_USER_ACCESS_TOKEN` are needed
or unnecessary for `provider_manual` until the §3.1a pilot establishes the exact
supported Meta grant/token procedure. Embedded Signup itself does not add those
deployment variables.

### 3.3 Extend P1-10 `src/lib/whatsapp/connect.ts`

The file already exists from P1-10. Extend its types for the provider method;
do not create another persistence helper.

```ts
export interface PersistConnectionArgs {
  accountId: string;
  userId: string; // audit column only
  phoneNumberId: string;
  wabaId: string | null;
  businessId?: string | null;
  accessToken: string; // PLAINTEXT in, encrypted inside
  connectionMethod: 'provider_embedded_signup' | 'provider_manual';
  webhookMode: 'provider';
  registered: boolean; // did /register succeed (or already-registered)?
  subscribed: boolean;
  phoneInfo: MetaPhoneInfo;
  tokenExpiresAt?: string | null;
  registrationError?: string | null;
}

export type PersistConnectionResult =
  | { ok: true; connectionState: ConnectionState; row: WhatsAppConfigRow }
  | {
      ok: false;
      code: 'duplicate_phone_number' | 'secret_storage_failed' | 'db_error';
      message: string;
    };
```

Responsibilities, in order:

1. Cross-account duplicate check through P1-10's service-role boundary.
2. Save the client-specific business/system-user token through
   `connection-secrets.ts`; provider rows have null `appSecret` and
   `verifyToken` because those are deployment variables.
3. Look up the existing row for `accountId` (for re-connect).
4. Compute `status` + `connection_state` per §3.4 — **and never downgrade a row
   that is already `connected` with the same `phone_number_id` on a
   register-only failure.** This is the guard that replaces
   `config/route.ts:361-363`.
5. Insert or update safe metadata with
   `connection_method='provider_embedded_signup'` or `provider_manual` and
   `webhook_mode='provider'`. Insert includes `account_id` and `user_id`.

### 3.4 State model

`status` keeps its existing `CHECK (status IN ('connected','disconnected'))`
domain so nothing existing breaks. The new nuance lives in `connection_state`.

| `connection_state` | Meaning                                                        | UI copy                                                 | Set when                                                                                                                  |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ok`               | Live                                                           | "Connected" (green)                                     | subscribe ✅ and register ✅                                                                                              |
| `not_registered`   | Token + subscription fine, number not registered for Cloud API | "Connected — finish setup" (amber) + Retry registration | register ❌ but subscribe ✅                                                                                              |
| `needs_reconnect`  | Token revoked / expired / invalid                              | "Reconnect needed" (red) + Connect button               | Meta OAuth error (code 190 or subcodes 458/463/467) seen at send time, on the config GET probe, or a Deauthorize callback |

Failure semantics for the ES route:

| Step                 | Failure handling                                                                                                                                    | HTTP | Response `code`                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------- |
| 1. exchange          | **Fatal.** Do not create/replace the active config. Record a sanitized `failed_clean` or uncertain attempt.                                         | 400  | `code_expired` (Meta OAuth error) / `exchange_failed` |
| 2. `subscribed_apps` | **Fatal for activation.** Do not create/replace the active config; record `failed_requires_reconciliation` when Meta may have accepted the request. | 502  | `subscribe_failed`                                    |
| 3. `/register`       | **Non-fatal, non-downgrading.** Persist with `connection_state='not_registered'`. `alreadyRegistered: true` counts as success.                      | 200  | `registered: false` in the body                       |
| 4. metadata          | Non-fatal. Persist with what we have; the existing config GET backfills.                                                                            | 200  | —                                                     |
| duplicate number     | Fatal, before any Meta call if possible.                                                                                                            | 409  | `duplicate_phone_number`                              |

`Persist nothing` always means “do not persist an active connection.” It never
means “erase evidence of a partial Meta-side attempt.” Migration 039 adds
`whatsapp_onboarding_attempts` with these sanitized states:

```text
started | code_exchanged | waba_subscribed | phone_registered | completed
failed_clean | failed_requires_reconciliation | reconciled | abandoned
```

No attempt row stores an authorization code, business token, App Secret or
verify token. Assisted provider onboarding is available only when there is no
unresolved attempt, or after `failed_clean`, `abandoned` or `reconciled`.
`failed_requires_reconciliation` blocks activation until the provider
subscription/registration state is inspected and changed to `reconciled`.

### 3.4a Assisted provider onboarding

Add an owner/admin-only `POST /api/whatsapp/provider-manual` endpoint. It accepts
only client-specific values:

```jsonc
{
  "waba_id": "1234567890",
  "phone_number_id": "0987654321",
  "business_id": "1122334455",
  "access_token": "EA...",
}
```

There is no provider App ID, App Secret or verify-token input. The server reads
the configured provider app credentials and, before persistence:

1. Inspects the supplied token and proves it is valid for the configured
   provider app; a token for a client-owned/foreign app is rejected.
2. Proves the token can read the stated WABA and phone number and that the phone
   belongs to that WABA.
3. Runs the same subscribe, register and metadata operations used after ES.
4. Persists `provider_manual` only after the activation rules permit it.

Stable failures include `provider_access_not_granted`,
`provider_token_wrong_app`, `waba_phone_mismatch`, `subscribe_failed` and
`registration_incomplete`. Never fall back to a P1-10 App Secret or accept the
provider App Secret in the request body.

### 3.5 New file — `src/lib/whatsapp/embedded-signup.ts`

Pure orchestration; no Supabase, no `next/server` imports — so it unit-tests
with a mocked `fetch`.

```ts
export interface RunEmbeddedSignupArgs {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  pin?: string; // defaults to env WHATSAPP_PROVIDER_REGISTER_PIN
}

export interface RunEmbeddedSignupResult {
  accessToken: string; // plaintext business token
  tokenExpiresAt: string | null;
  subscribed: true; // fatal if it isn't
  registered: boolean;
  alreadyRegistered: boolean;
  registrationError: string | null;
  phoneInfo: MetaPhoneInfo;
}
```

Sequence (matches Meta's Tech Provider doc steps 1–3 and OpenBSP
`embedded_signup.ts:269-300` exactly):

```
1. exchangeCodeForBusinessToken({ code })
     GET {BASE}/oauth/access_token?client_id=&client_secret=&code=
     → { access_token, token_type?, expires_in? }
     Plain GET. No body. No Authorization header.
     Capture expires_in → tokenExpiresAt (null when absent = non-expiring).
     ⚠ 30-SECOND TTL on the code. This must be the first thing the route does —
       no DB round-trips before it.

2. subscribeWabaToApp({ wabaId, accessToken })          [existing helper]
     POST {BASE}/{waba_id}/subscribed_apps
     Authorization: Bearer <business token>
     THROW on failure — do not console.warn.

3. registerPhoneNumber({ phoneNumberId, accessToken, pin })   [existing helper]
     POST {BASE}/{phone_number_id}/register
     { "messaging_product": "whatsapp", "pin": "<6 digits>" }
     Catch → registrationError, registered:false. Do not rethrow.
     alreadyRegistered → registered:true.

4. verifyPhoneNumber({ phoneNumberId, accessToken })     [existing helper]
     GET {BASE}/{phone_number_id}?fields=id,display_phone_number,verified_name,quality_rating
     Catch → phoneInfo = minimal stub. Do not rethrow.
```

**`/register` is mandatory, not optional.** Meta's Tech Provider onboarding
lists it as Step 3 with `pin` marked _Required_, and states customers "will not
be able to use your app to access their WhatsApp assets or send and receive
messages … until you complete these steps." OpenBSP calls it unconditionally
(`embedded_signup.ts:287-294`) with a constant `"123456"` it never stores. Any
earlier draft suggesting we skip it is wrong.

Add to `meta-api.ts`:

```ts
export interface ExchangeCodeArgs {
  code: string;
}
export interface ExchangeCodeResult {
  accessToken: string;
  expiresIn: number | null;
}
export async function exchangeCodeForBusinessToken(
  args: ExchangeCodeArgs
): Promise<ExchangeCodeResult>;
```

Reads `META_PROVIDER_APP_ID` and `META_PROVIDER_APP_SECRET` from env. Never log
the code or token. Use the existing `throwMetaError` pattern.

### 3.6 New route — `src/app/api/whatsapp/embedded-signup/route.ts`

`POST`. Read `node_modules/next/dist/docs/` for this Next version's route
handler contract before writing.

Request body:

```jsonc
{
  "attempt_id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "AQB...", // required, 30s TTL
  "waba_id": "1234567890", // required
  "phone_number_id": "0987654321", // required
  "business_id": "1122334455", // optional, persist if present
  "flow_type": "new_phone_number", // FINISH → new_phone_number; FINISH_ONLY_WABA → only_waba
}
```

Before opening Meta, `POST /api/whatsapp/embedded-signup/attempts` creates one
`started` attempt for the authenticated workspace and returns its UUID. An
unconnected workspace uses `intent='connect'`. A workspace with an active
`manual_client_app` may use `intent='migrate_to_provider'` only after an explicit
owner/admin confirmation; an active provider connection still returns 409
`active_connection_exists`.

Handler order:

1. `supabase.auth.getUser()` → 401 if absent.
2. Resolve the account and require workspace owner/admin. Agent/viewer → 403.
3. Lock the attempt by `attempt_id`; require the same account and `started`
   state. For `connect`, require no active config. For `migrate_to_provider`,
   require exactly one active `manual_client_app` row and keep it unchanged
   unless the complete provider activation succeeds. Used/foreign/unknown
   attempt → 409.
4. Validate `code`, `waba_id`, `phone_number_id` are non-empty strings. No PIN
   validation — the PIN is ours, not the user's.
5. Reject `flow_type === 'existing_phone_number'` with 400 `coexistence_unsupported`.
6. `runEmbeddedSignup(...)` — exchange first, within the 30-second window;
   update the sanitized attempt state after each external success.
7. `persistConnection(...)` only after the activation rules in §3.4 permit it.
   Migration requires a fully `ok` provider result; `not_registered` never
   replaces a working manual row. The provider row/token replacement is one
   database transaction.
8. Structured JSON in the same shape the existing UI already understands
   (`{ success, saved, registered, registration_error, phone_info }`), plus
   `connection_state`.

Stable route error codes are:

```text
unauthorized | forbidden | invalid_request | attempt_not_found
attempt_already_used | active_connection_exists | migration_confirmation_required
legacy_connection_changed | coexistence_unsupported
code_expired | exchange_failed | subscribe_failed | duplicate_phone_number
registration_incomplete | secret_storage_failed | db_error
```

The button disables on first click, but server-side attempt locking is the
idempotency boundary for double clicks, multiple tabs and retries. A failed
migration never downgrades or overwrites the active manual connection. After a
successful switch, the old client-owned app remains subscribed only long enough
for provider inbound/outbound smoke tests; the runbook then unsubscribes it. The
manual webhook route must ignore/reject a row whose method is now provider so
the overlap cannot create duplicate processing.

### 3.7 Frontend — `src/components/settings/whatsapp-config.tsx`

Current structure: `WhatsAppConfig()` at `:39`, with `handleSave` `:185`,
`handleTestConnection` `:280`, `handleVerifyRegistration` `:310`, `handleReset`
`:336`. For a new hosted workspace with provider configuration present, show ES
as primary and reveal `Use assisted setup` only after an unavailable,
`failed_clean` or reconciled attempt and only within the proven §3.1a boundary.
For an existing `manual_client_app`, show its live status plus an explicit
`Move to the ConnectsWA app` action for owner/admin; never start migration on
page load. When provider configuration is absent, a self-host build keeps the
P1-10 client-owned manual form as its primary path.

Suggested split: put the SDK + popup mechanics in a new
`src/components/settings/embedded-signup-button.tsx` so the 840-line file
doesn't grow further.

**SDK loading.** Inject `https://connect.facebook.net/en_US/sdk.js` with
`async defer crossorigin="anonymous"`. Attach an `onerror` handler — the domain
is commonly blocked by Firefox ETP and ad blockers, and OpenBSP hit this in
production (`WhatsAppIntegrationContext.tsx:167-170`). On error, disable the
button and show "Your browser is blocking Facebook's login script — disable
tracking protection for this site, retry in a supported browser, or use the
assisted provider path if it is enabled for this account."

**`FB.init`:**

```js
FB.init({
  appId: NEXT_PUBLIC_META_PROVIDER_APP_ID,
  autoLogAppEvents: true,
  xfbml: true,
  version: META_GRAPH_VERSION, // same value the server uses
});
```

**Message listener** (mount once, clean up on unmount):

```js
window.addEventListener('message', (event) => {
  const hostname = new URL(event.origin).hostname;
  if (hostname !== 'facebook.com' && !hostname.endsWith('.facebook.com'))
    return;
  if (
    typeof event.data !== 'string' ||
    !event.data.includes('WA_EMBEDDED_SIGNUP')
  )
    return;
  const data = JSON.parse(event.data); // guard with try/catch
  if (data.type !== 'WA_EMBEDDED_SIGNUP') return;
  // ...
});
```

Event shapes (from Meta's Implementation doc — **note the corrections against
OpenBSP's stale types**):

```jsonc
// success
{ "type": "WA_EMBEDDED_SIGNUP",
  "event": "FINISH",           // or FINISH_ONLY_WABA | FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING
                               //    | FINISH_OBO_MIGRATION | FINISH_GRANT_ONLY_API_ACCESS | ERROR
  "data": { "phone_number_id": "...", "waba_id": "...", "business_id": "...",
            "ad_account_ids": [], "page_ids": [], "dataset_ids": [],
            "catalog_ids": [], "instagram_account_ids": [], "waba_ids": [] } }

// abandoned
{ "type": "WA_EMBEDDED_SIGNUP", "event": "CANCEL",
  "data": { "current_step": "PHONE_NUMBER_SETUP" } }

// user-reported error
{ "type": "WA_EMBEDDED_SIGNUP", "event": "CANCEL",
  "data": { "error_message": "...", "error_code": "524126",
            "session_id": "f34b51dab5e0498", "timestamp": "1746041036" } }
```

Handling rules:

- `FINISH` → `flow_type: 'new_phone_number'` (**wacrm's standard case**).
- `FINISH_ONLY_WABA` → no active connection because this release requires a
  phone number. Record a sanitized reconciliation state and show "WABA selected
  but no phone number was connected — finish in Meta before retrying."
- `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` → out of scope; show "Coexistence is
  not supported yet."
- Unknown `event` → treat as abandoned and record only the event name plus
  sanitized attempt ID; **do not throw** and never log the code/event payload.
- The error payload field is **`error_code`**, not `error_id` — OpenBSP's type
  is stale here. Log `session_id` + `error_code`; they're what Meta support asks
  for.
- **Closing the popup on the final screen counts as SUCCESS**, not cancel
  (explicit in Meta's doc). Do not wire "popup closed → abandoned".

**`FB.login`:**

```js
FB.login(fbLoginCallback, {
  config_id: NEXT_PUBLIC_META_PROVIDER_CONFIG_ID,
  response_type: 'code',
  override_default_response_type: true,
  extras: {
    setup: {},
    sessionInfoVersion: '3',
  },
});
// NO featureType — that selects coexistence. Omitting it gives the standard
// new-number Cloud API flow.
```

`sessionInfoVersion: '3'` — OpenBSP sets it
(`WhatsAppIntegrationContext.tsx:242`); Meta's _current_ v4 sample omits it.
Keep it (historically required to receive the `message` events, harmless if
ignored), but if events fail to arrive, this is not the first thing to suspect.

**The join problem.** `FB.login`'s callback and the `message` event fire
independently and in no guaranteed order. OpenBSP stashes session info on
`window.__waSessionInfo` and reads it in the callback — workable but fragile if
the callback lands first. Implement a small deferred that resolves when **both**
`code` and `{waba_id, phone_number_id}` are present, with a ~10 s timeout, then
POST immediately. Remember the code's 30 s TTL: the timeout must be well under
it.

**CSP.** `next.config.ts:39-45` currently ships
`Content-Security-Policy-Report-Only` with
`script-src 'self' 'unsafe-inline' 'unsafe-eval'`. Report-only means ES works
today, but add now so a future flip to enforcing doesn't break onboarding:

```
script-src  … https://connect.facebook.net
connect-src … https://graph.facebook.com https://www.facebook.com
frame-src   https://www.facebook.com
```

Check `node_modules/next/dist/docs/` for the `headers()` contract in this Next
version before editing `next.config.ts:132`.

### 3.8 Provider webhook — `src/app/api/whatsapp/webhook/provider/route.ts`

Do not modify the P1-10 manual route to accept provider traffic. The provider
route owns both methods:

- `GET`: timing-safe comparison against `WHATSAPP_PROVIDER_VERIFY_TOKEN` only.
- `POST`: read the untouched raw body, verify `X-Hub-Signature-256` with
  `META_PROVIDER_APP_SECRET` only, parse only after verification, then pass the
  verified event to P1-10's shared dispatcher.

There is no fallback to a manual App Secret or manual verify token. A manual
callback never reads provider variables. Unknown WABA/phone IDs fail closed
without cross-workspace probing.

Add an `account_update` handler to the shared dispatcher. Meta's
Implementation doc, "Before you start": _"You must be subscribed to the
`account_update` webhook, as this webhook is triggered whenever a customer
successfully completes the Embedded Signup flow, and contains their business
information that you will need."_

The dispatcher already handles messages, statuses and template fields. Add an
`account_update` branch that records the sanitized event against the WABA.
Useful events include
`PARTNER_APP_INSTALLED`, `PARTNER_APP_UNINSTALLED`, `ACCOUNT_VIOLATION`,
`ACCOUNT_RESTRICTION`, `DISABLED_UPDATE`, and business-verification changes.

Why it matters operationally: it is the **recovery signal** when the 30-second
code exchange fails. Without it, "the popup worked but my server didn't" is
indistinguishable from "the popup failed."

Map `PARTNER_APP_UNINSTALLED` → `connection_state = 'needs_reconnect'`.

### 3.9 New routes — Meta app callbacks

Required by Meta for apps handling business data and checked during App Review.
Both receive a POST with a `signed_request` body param that must be verified
with `META_PROVIDER_APP_SECRET` (HMAC-SHA256 over the payload segment,
base64url).

- `src/app/api/meta/deauthorize/route.ts` — the client removed our app. Find the
  affected config, set `connection_state='needs_reconnect'` and
  `status='disconnected'`, stop using the token. Return 200 quickly.
- `src/app/api/meta/data-deletion/route.ts` — must return
  `{ "url": "<status page URL>", "confirmation_code": "<code>" }`. Delete or
  anonymise the client's WhatsApp data and record the request so the status URL
  can report on it.

Write a shared `parseSignedRequest(signedRequest, appSecret)` helper with unit
tests (valid, tampered signature, wrong algorithm, malformed base64).

### 3.10 In-app disconnect

`POST {BASE}/{phone_number_id}/deregister` with the client's business token,
then mark the row disconnected — confirmed against OpenBSP
(`embedded_signup.ts:403-428, 430-469`). OpenBSP guards this to
`flow_type === 'new_phone_number'`; mirror that guard using
`connection_method` / `flow_type`. Add
`deregisterPhoneNumber({phoneNumberId, accessToken})` to
`meta-api.ts`. The existing `DELETE /api/whatsapp/config` should call it before
deleting the row when `connection_method IN
('provider_embedded_signup','provider_manual')`. A `manual_client_app` DELETE
must retain P1-10's behavior.

### 3.11 Migration — `supabase/migrations/039_whatsapp_embedded_signup.sql`

P1-10 owns migrations 037 and 038. P1-11 is 039 and must refuse to run if the
P1-10 schema or server-only secret table is absent. Follow the house style:
explain _why_, use guarded DDL, stay idempotent and fail loudly.

```sql
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flow_type       TEXT;

-- Replace the P1-10 guarded checks so these values are also allowed:
--   connection_method: provider_embedded_signup, provider_manual
--   webhook_mode: provider

CREATE TABLE whatsapp_onboarding_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  state TEXT NOT NULL,
  waba_id TEXT,
  phone_number_id TEXT,
  business_id TEXT,
  intent TEXT NOT NULL DEFAULT 'connect',
  sanitized_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_connection_state
  ON whatsapp_config (connection_state)
  WHERE connection_state <> 'ok';
```

Add a guarded state CHECK using the exact attempt states in §3.4 and a partial
unique index allowing at most one non-terminal attempt per account. Enable RLS
on the attempts table and create no browser policies; routes expose sanitized
attempt status. Do not backfill or change any P1-10 manual row. Existing manual
rows retain `manual_client_app` + `manual_unique` and continue working.

The migration adds no second active connection row and no credential snapshot
table. A migration attempt references the legacy config version it observed;
the final transactional replacement fails with `legacy_connection_changed` if
that row or its secret was rotated during the popup. Before a production
cutover, the operator must possess the current P1-10 credentials in the secure
client runbook so they can be re-entered during the maintenance window if the
post-switch smoke test fails.

### 3.12 Full file manifest

| File                                                               | Action                                                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `src/lib/whatsapp/meta-api.ts`                                     | **Edit** — reuse P1-10's pinned Graph version; add `exchangeCodeForBusinessToken`, `deregisterPhoneNumber` |
| `src/lib/whatsapp/connect.ts`                                      | **Edit** — add Embedded method/provider mode; retain P1-10 behavior                                        |
| `src/lib/whatsapp/connection-secrets.ts`                           | **Reuse** — persist provider business tokens server-side                                                   |
| `src/lib/whatsapp/embedded-signup.ts`                              | **New** — `runEmbeddedSignup` orchestrator                                                                 |
| `src/lib/meta/signed-request.ts`                                   | **New** — `parseSignedRequest`                                                                             |
| `src/app/api/whatsapp/embedded-signup/route.ts`                    | **New** — POST                                                                                             |
| `src/app/api/whatsapp/embedded-signup/attempts/route.ts`           | **New** — create/read sanitized attempt state                                                              |
| `src/app/api/whatsapp/provider-manual/route.ts`                    | **New** — validate provider token/WABA access; assisted provider connection                                |
| `src/app/api/whatsapp/config/route.ts`                             | **Edit** — block activation during unresolved ES attempts; DELETE deregisters only provider rows           |
| `src/app/api/whatsapp/webhook/provider/route.ts`                   | **New** — provider-only GET/POST verification boundary                                                     |
| `src/lib/whatsapp/webhook-dispatch.ts`                             | **Edit** — add `account_update`; retain P1-10 message/status behavior                                      |
| `src/app/api/meta/deauthorize/route.ts`                            | **New**                                                                                                    |
| `src/app/api/meta/data-deletion/route.ts`                          | **New**                                                                                                    |
| `src/components/settings/whatsapp-config.tsx`                      | **Edit** — Connect button, states, manual form demoted, payment-method nudge                               |
| `src/components/settings/embedded-signup-button.tsx`               | **New** — SDK + popup + listener                                                                           |
| `supabase/migrations/039_whatsapp_embedded_signup.sql`             | **New**                                                                                                    |
| `next.config.ts`                                                   | **Edit** — CSP allowances                                                                                  |
| `.env.local.example`                                               | **Edit** — seven provider vars from §3.2                                                                   |
| `messages/*.json`                                                  | **Edit** — new UI strings (en + ko; the repo is i18n'd)                                                    |
| `docs/phase-1/TEST-PLAN.md`                                        | **Edit** — add the P1-11 section                                                                           |
| `docs/phase-1/README.md`                                           | **Edit** — index row                                                                                       |
| `docs/phase-1/runbooks/P1-11-provider-onboarding-and-migration.md` | **New** — ES, proven assisted setup, existing-client cutover, stop/rollback steps                          |
| `Deploy.md`                                                        | **Edit** — new env vars + Meta callback URLs                                                               |

---

## 4. Task breakdown

Start only from the merged, deployed and signed-off P1-10 result. Build order
matters because each checkpoint must preserve every manual workspace.

- [ ] **4.1** Read `node_modules/next/dist/docs/` for route handlers,
      `next.config.ts` `headers()`, and client-side script loading in this Next
      version.
- [ ] **4.2** Confirm §3.1 (token expiry), the stable HTTPS host and the Track A
      production prerequisites with Manish.
- [ ] **4.2a** Complete the §3.1a disposable-WABA pilot. Record whether
      independent assisted provider authorization works or whether the fallback
      is limited to partial-ES reconciliation. Do not code broader claims.
- [ ] **4.3** Verify the inherited P1-10 `META_GRAPH_VERSION` compatibility
      checkpoint is still green; do not change the Graph version in the OAuth
      branch. Then add `exchangeCodeForBusinessToken` and
      `deregisterPhoneNumber`.
- [ ] **4.4** Migration 039 on a disposable database; assert every P1-10 manual
      row is byte-for-byte unchanged except schema visibility.
- [ ] **4.5** Extend `connect.ts` and `connection-secrets.ts` types for Embedded
      rows; run the complete P1-10 test suite before adding routes.
- [ ] **4.6** Add the attempts route/table repository and terminal/non-terminal
      state tests. Prove no code/token is stored.
- [ ] **4.7** Add `embedded-signup.ts` orchestration with the failure semantics
      in §3.4 and unit tests in §5.
- [ ] **4.8** Add `POST /api/whatsapp/embedded-signup` with owner/admin auth,
      attempt locking, normal-connect protection and explicit
      `migrate_to_provider` handling that preserves the live manual row on every
      pre-activation failure.
- [ ] **4.8a** Add `POST /api/whatsapp/provider-manual` within the proven §3.1a
      boundary. Validate provider token/app identity, WABA access and phone
      ownership before subscribe/register/persist.
- [ ] **4.8b** Guard both provider paths during non-terminal or
      `failed_requires_reconciliation` attempts; allow only
      `abandoned`/`failed_clean`/reconciled transitions.
- [ ] **4.9** Add provider GET/POST webhook route; extend the dispatcher with
      `account_update`; map `PARTNER_APP_UNINSTALLED` to `needs_reconnect`.
- [ ] **4.10** `signed-request.ts` + deauthorize + data-deletion routes.
- [ ] **4.11** CSP allowances in `next.config.ts`.
- [ ] **4.12** `embedded-signup-button.tsx`: SDK loader with `onerror`, listener,
      code+sessionInfo join with timeout, POST.
- [ ] **4.13** `whatsapp-config.tsx`: for an unconnected hosted workspace show
      Connect primary and assisted provider fallback within the §3.1a boundary;
      for an existing manual workspace show current status plus an explicit
      owner/admin migration action; for a provider workspace show provider state
      and disconnect/reconnect actions.
- [ ] **4.14** i18n strings (en + ko).
- [ ] **4.15** Disconnect → deregister wiring without changing manual DELETE.
- [ ] **4.16** Run P1-10 characterization/multi-app tests plus all P1-11 tests,
      then `npm run typecheck && npm run lint && npm test && npm run build`.
- [ ] **4.17** Update `Deploy.md`, `docs/phase-1/README.md`, and the P1-11
      section of `TEST-PLAN.md`; publish the versioned provider onboarding and
      migration runbook with the exact §3.1a Meta steps.
- [ ] **4.18** Manual + UAT (owner): two manual apps remain live while a third
      workspace connects through ES; test the proven assisted provider path;
      migrate one manual workspace to the provider app and exercise rollback
      before touching a production client.
- [ ] **4.19** Commit and push `feat/p1-11-embedded-signup` only after Track A
      staging prerequisites, automated checks and P1-11 UAT are green. Production
      enablement remains off until Meta approval is complete.

---

## 5. Testing & acceptance

### Automated (Claude Code writes these)

Vitest, `npm test`. Mock `fetch`; never hit Meta in CI.

`src/lib/whatsapp/embedded-signup.test.ts`

| Case                             | Assert                                                              |
| -------------------------------- | ------------------------------------------------------------------- |
| Happy path                       | 4 calls, in order, correct URLs/methods/headers; `registered: true` |
| Exchange 400 (expired code)      | throws; `subscribed_apps` never called                              |
| `subscribed_apps` 400            | throws; `/register` never called                                    |
| `/register` 400 generic          | resolves with `registered:false`, `registrationError` set           |
| `/register` "already registered" | resolves with `registered:true, alreadyRegistered:true`             |
| metadata 400                     | resolves; `phoneInfo` stubbed; no throw                             |
| Token never logged               | assert no console call receives the token/code substring            |
| `expires_in` present / absent    | `tokenExpiresAt` set / null                                         |

`src/lib/whatsapp/connect.test.ts`

| Case                                                       | Assert                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Normal ES against a manual connection                      | confirmation required; manual metadata and secrets unchanged            |
| Failed `migrate_to_provider` at any external step          | manual row and secret remain byte-for-byte unchanged                    |
| Successful `migrate_to_provider`                           | one transactional switch to provider method/token; no second active row |
| Legacy row rotated while migration popup is open           | `legacy_connection_changed`; neither credential set overwritten         |
| Retry against a live provider number with register failure | row stays `status:'connected'`; `connected_at` is not nulled            |
| New provider connection, all green                         | `status:'connected'`, `connection_state:'ok'`                           |
| Duplicate number owned by another account                  | `{ok:false, code:'duplicate_phone_number'}`; no write                   |
| Secret repository throws                                   | `{ok:false, code:'secret_storage_failed'}`; no active row               |
| P1-10 path unchanged                                       | complete P1-10 route/webhook suite remains green                        |

`src/app/api/whatsapp/embedded-signup/route.test.ts` — owner/admin success;
agent/viewer 403; foreign/used attempt 409; active provider connection 409;
active manual connection requires explicit migration intent; double submit
produces one activation; uncertain/partial failure blocks another activation
until reconciliation; no secret in body, response or logs.

`src/app/api/whatsapp/embedded-signup/attempts/route.test.ts` — one active attempt
per account; terminal retry rules; cross-tenant isolation; sanitized fields only.

`src/app/api/whatsapp/provider-manual/route.test.ts` — no provider App Secret
field accepted; correct provider token/app/WABA/phone succeeds; foreign-app token,
missing WABA access, WABA/phone mismatch and unresolved ES attempt fail without a
write; logs and responses contain no token.

Extend `src/app/api/whatsapp/config/route.test.ts`: P1-10 writes remain isolated,
are rejected while a provider connection is active, and cannot overwrite an
unresolved provider attempt.

`src/lib/meta/signed-request.test.ts` — valid, tampered signature, wrong algo,
malformed base64.

`src/app/api/whatsapp/webhook/provider/route.test.ts` — provider GET token match
and mismatch; provider HMAC match/mismatch over raw bytes; manual secret cannot
validate; unknown WABA/phone fails closed; `account_update` accepted; messages
and statuses reach the P1-10 dispatcher exactly once.

Run every P1-10 config, manual webhook, secret-RLS, rotation and multi-app test
unchanged. P1-11 cannot weaken or replace their assertions.

**Pass bar:** typecheck clean, lint 0 errors, all tests green, build succeeds.
Nothing merges red (phase-1 workflow rule 4).

### Manual / UAT (owner)

Full follow-along tables live in `TEST-PLAN.md` §P1-11. Headline acceptance
criteria:

- A test-role Meta user completes the popup on the staging HTTPS domain and
  lands with a `connected` / `ok` row.
- `getSubscribedApps` (existing "Verify Registration" button) lists our app on
  the client's WABA.
- A message sent **to** the connected number appears in the correct account's
  inbox; a reply sends successfully.
- Re-running Connect against an active provider workspace is rejected without
  changing its connection; a manual workspace requires explicit migration
  confirmation.
- Two P1-10 manual apps remain live while the provider workspace sends and
  receives.
- A clean ES failure offers the proven assisted provider path; a
  partial/uncertain failure shows reconciliation and blocks silent overwrite.
- One P1-10 client migrates to the provider app. Failure before activation keeps
  the manual row live; success switches exactly once and the old app is retired
  only after provider send/receive smoke tests.
- Abandoning the popup produces a terminal sanitized attempt and no active row.

---

## 6. Rollout & rollback

**Feature flag by environment, not by code.** With
`NEXT_PUBLIC_META_PROVIDER_CONFIG_ID` unset, the Connect button doesn't render and the
app behaves exactly as today. That is the kill switch — no flag plumbing needed,
and it is also what self-hosters get by default.

**Order of operations to go live:**

1. Branch from the signed-off P1-10 result. Apply migration 039 and deploy with
   the public provider config variable **unset** in production. Existing manual
   clients remain unchanged.
2. Set the env vars on the **staging** domain; run TEST-PLAN §P1-11 with test-role
   Meta users (dev mode allows this before App Review).
3. Submit App Review for Advanced Access on `whatsapp_business_management` +
   `whatsapp_business_messaging`.
4. After Tech Provider/business verification, App Review/Advanced Access, live
   mode, provider webhooks, the §3.1a pilot and production UAT are complete, set
   the public provider App/Config IDs in production. New hosted workspaces use
   ES first and the proven assisted provider path second.
5. Migrate P1-10 clients individually. Confirm expected WABA/phone IDs, complete
   provider activation, send outbound, receive one signed provider webhook, then
   remove the old client-owned app subscription. If Meta does not present or
   authorize the expected assets, stop with the P1-10 row unchanged.
6. Deprecate the P1-10 hosted UI after new-client provider onboarding is stable;
   remove the legacy runtime only when the database contains no
   `manual_client_app` rows.

**Rollback:**

- Fastest: unset `NEXT_PUBLIC_META_PROVIDER_CONFIG_ID` so no new signup starts.
  Keep `META_PROVIDER_APP_SECRET`, provider webhook routes and token-reading code
  deployed for already-connected Embedded clients.
- Do not revert P1-11 runtime code after an Embedded client is active. First move
  or disconnect those clients through an explicit runbook; the kill switch only
  stops new onboarding.
- Migration 039 is additive. Leave its columns/attempt records in place; do not
  drop them in an emergency down migration.
- P1-10 routes remain a transition rollback path only while legacy rows exist.
  A failed pre-activation migration needs no rollback because the manual row was
  never replaced. A failed post-switch smoke test uses the recorded client
  credentials to restore `manual_client_app` during the maintenance window.

---

## 7. Open questions / decisions

| #   | Question                                                                                                                                                                                                           | Why it matters                                                                      | Owner  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------ |
| 1   | **Token expiry: non-expiring custom config (A) or Meta's 60-day template (B)?** §3.1                                                                                                                               | B adds an entire refresh subsystem. Blocks 4.2.                                     | Manish |
| 2   | New Meta app confirmed (not `wacrm-test0`) — what is its App ID, and is the business portfolio the production one?                                                                                                 | App ID/Secret/Config ID all change; App Review is per-app and non-transferable.     | Manish |
| 3   | Which HTTPS host for testing? A stable staging subdomain is strongly preferred over a tunnel — tunnel URLs rotate and each rotation means re-editing Allowed Domains + Valid OAuth redirect URIs in the dashboard. | Blocks 4.17.                                                                        | Manish |
| 4   | Data-deletion status page — build a real page, or return a static URL explaining the manual process?                                                                                                               | Affects callback scope. Static is acceptable for App Review.                        | Manish |
| 5   | Retain sanitized terminal onboarding attempts for 30 or 90 days?                                                                                                                                                   | Operational diagnosis and data minimization. No codes/tokens are stored.            | Manish |
| 6   | What exact Meta-supported manual grant/token procedure passes the §3.1a pilot?                                                                                                                                     | Defines whether `provider_manual` is independent or partial-ES reconciliation only. | Manish |

---

## Appendix A — Track A: Meta dashboard checklist (owner, not Claude Code)

Order matters. Items 1–4 **block** developer testing; 5–7 can run in parallel.

1. **Create the new Meta app** (type: Business). Record App ID + App Secret.
2. **Facebook Login for Business → Settings → Client OAuth settings.** Set all
   of these to **Yes**: Client OAuth login, Web OAuth login, Enforce HTTPS,
   Embedded Browser OAuth Login, _use Strict Mode for redirect URIs_, Login with
   the JavaScript SDK. Add every host that will run the flow (staging **and**
   production) to **both** _Allowed Domains for the JavaScript SDK_ **and**
   _Valid OAuth redirect URIs_. HTTPS with a valid certificate only —
   `localhost` will not work.
   > Missing either field produces a popup that completes and returns nothing to
   > the page. It is the hardest ES failure to diagnose.
3. **Facebook Login for Business → Configurations →** create a configuration.
   Login variation: **WhatsApp Embedded Signup**. Products: **Cloud API only**.
   Token expiry per decision §3.1. **Copy the Configuration ID.**
   > One configuration serves **all** clients — it is not per-customer. It is
   > your flow definition, and the ID is public (it ships to the browser).
   > Creating a _new_ configuration is also the only way to be on v4; existing
   > configurations cannot be converted.
4. **Webhooks →** subscribe the app to the WhatsApp Business Account object
   fields: `messages` **and `account_update`** (plus `message_template_status_update`
   if templates are in use). Callback URL
   `https://<host>/api/whatsapp/webhook/provider`, verify token = the exact
   value of `WHATSAPP_PROVIDER_VERIFY_TOKEN`. Never point the provider app at a
   P1-10 manual callback.
5. **App Settings → Basic:** set the **Deauthorize Callback URL**
   (`https://<host>/api/meta/deauthorize`) and **Data Deletion Request URL**
   (`https://<host>/api/meta/data-deletion`). Also Privacy Policy and Terms URLs
   — App Review checks these.
6. **Enroll as a Tech Provider** and complete **business verification**.
7. **App Review → request Advanced Access** for `whatsapp_business_management`
   and `whatsapp_business_messaging`. Each needs a short screen recording of the
   flow. Until approved, only App Roles (admins / developers / testers) can
   complete the popup — which is exactly enough to build and test.

**Post-connect, per client:** they must add a payment method in WhatsApp Manager
(https://business.facebook.com/wa/manage/home/) or sends fail with billing
errors. Meta lists this as onboarding Step 5. Surface it in the UI (§4.12) —
otherwise it arrives as a wacrm bug report.

## Appendix B — verified facts and where they came from

Everything below was read directly on 2026-08-09 and rechecked where noted on
2026-08-10, not recalled.

| Claim                                                                                                                           | Evidence                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Server sequence is exchange → subscribe → register → metadata → persist                                                         | Meta Tech-Provider onboarding steps 1–3; OpenBSP `embedded_signup.ts:269-300`                               |
| `/register` is required with a 6-digit PIN                                                                                      | Meta Tech-Provider onboarding Step 3, `pin` marked _Required_                                               |
| PIN need not be stored                                                                                                          | OpenBSP hardcodes `"123456"` at `embedded_signup.ts:288` and never persists it                              |
| `subscribed_apps` must be blocking                                                                                              | OpenBSP throws (`:56-61`); Meta: customer can't send/receive until the steps complete                       |
| Exchange is a plain GET, no body, no auth header                                                                                | Meta doc curl sample; OpenBSP `:25-27`                                                                      |
| Code TTL is 30 seconds                                                                                                          | Meta Implementation doc, "Response callback" warning                                                        |
| Meta's recommended config template issues a **60-day** token                                                                    | Meta Implementation doc Step 2: "WhatsApp Embedded Signup Configuration With 60 Expiration Token"           |
| `account_update` subscription is mandatory                                                                                      | Meta Implementation doc, "Before you start"                                                                 |
| Valid OAuth redirect URIs + Strict Mode required                                                                                | Meta Implementation doc Step 1                                                                              |
| Closing the popup on the final screen = success                                                                                 | Meta Implementation doc, "Successful flow completion structure"                                             |
| CANCEL error field is `error_code` (not `error_id`)                                                                             | Meta Implementation doc, "User reported errors"                                                             |
| Payment method is onboarding Step 5                                                                                             | Meta Tech-Provider onboarding Step 5                                                                        |
| ES **v2** deprecates 15 Oct 2026; v4 released 8 Oct 2025                                                                        | Meta v4 page banner + release note                                                                          |
| Latest Graph version in Meta's examples                                                                                         | v25.0 (repo is on v21.0; OpenBSP on v24.0)                                                                  |
| Test users can run the flow pre-App-Review                                                                                      | Meta Implementation doc, "Testing"                                                                          |
| P1-10 routes verified manual events by `phone_number_id`; P1-11 must verify provider HMAC first with `META_PROVIDER_APP_SECRET` | P1-10 architecture and `src/lib/whatsapp/webhook-signature.ts` after Stage 1                                |
| `registerPhoneNumber` already treats "already registered" as success                                                            | `src/lib/whatsapp/meta-api.ts:151-153`                                                                      |
| `subscribeWabaToApp` failure is currently swallowed                                                                             | `src/app/api/whatsapp/config/route.ts:344-350`                                                              |
| Register failure currently downgrades the row                                                                                   | `src/app/api/whatsapp/config/route.ts:361-363`                                                              |
| One number per account, one account per number                                                                                  | `017:314-328` (`UNIQUE(account_id)`), `013` (`UNIQUE(phone_number_id)`)                                     |
| CSP is report-only today                                                                                                        | `next.config.ts:39-45`                                                                                      |
| No ES / OAuth / deauthorize code exists yet                                                                                     | grep across `src/`                                                                                          |
| A WABA can list more than one subscribed app                                                                                    | Official Meta Postman collection, `GET /{WABA-ID}/subscribed_apps` multi-app example (rechecked 2026-08-10) |
| Public Meta material does not guarantee that every existing WABA/phone appears in ES                                            | No universal-selection guarantee in the current ES docs; require the live pilot and stop condition          |

## Appendix C — client policy after production approval

- New, unconnected hosted workspaces use Embedded Signup as the primary path.
- The assisted fallback uses the same approved ConnectsWA provider app. It is
  available only within the authorization procedure proven by §3.1a; the
  provider App Secret is never a workspace input.
- Existing P1-10 workspaces migrate to the provider app deliberately, one client
  at a time. There is no bulk, automatic or hidden conversion.
- A migration failure before activation preserves the manual row. After a
  successful transactional switch, verify outbound and one signed provider
  webhook before removing the old client-owned app subscription.
- If the expected existing WABA/phone is not presented or cannot be authorized,
  stop. Keep that client temporarily on P1-10 and retry only after the Meta asset
  state or supported flow is understood.
- Remove the hosted P1-10 path only after the final legacy client has migrated.
