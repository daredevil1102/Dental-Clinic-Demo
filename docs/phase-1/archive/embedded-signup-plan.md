> **SUPERSEDED — archived, not a build document.**
>
> Written 2026-08-09, before the P1-11 design was settled. The frozen design
> is [`claude-02-P1-11-embedded-signup.md`](../claude-02-P1-11-embedded-signup.md)
> (2026-08-10), and where the two disagree, claude-02 wins. Notably, claude-02
> scopes Embedded Signup to workspaces with **no** existing connection and
> removes manual→embedded migration entirely; these documents predate that.
>
> Kept for the reasoning, which is still worth reading. Do not build from it.

# Embedded Signup (v4) — Plan-First Spec for wacrm

**Goal:** let a business click "Connect WhatsApp," log into Facebook in a
Meta popup, and have their WhatsApp Business Account linked to your app
automatically — you never touch their password or tokens.

**Repo today:** manual only. A user pastes phone number ID, WABA ID, and an
access token into a form. Embedded Signup does not exist.

**SCOPE (locked):** Standard **Embedded Signup** for new / Cloud-API numbers,
built into wacrm, onboarded under **your own Meta app** — you become the Meta
**Tech Provider** and carry the verified-trust badge yourself. **Coexistence is
OUT of scope.** Routing customers through a third party's Meta app is a
last-resort fallback only (Appendix C), not a recommendation.

**Verification status (v5):**
- Grounded in the repo's actual code (read directly).
- Grounded in Meta's `version-4` + `default-flow` docs (read directly). The
  earlier "real repo" check was actually a **blog** (Teknasyon/Desk360, v2-era)
  — corrected.
- Cross-checked against **OpenBSP** source (`matiasbattocchia/open-bsp-api`, a
  registered Tech Provider) for standard-flow token/env facts — Appendix B.
  The local coexistence runbook is **disregarded** (coexistence never worked
  for Laione/Cladens and is out of scope).
- **Reviewed by an independent agent against the repo.**

---

## 1. Two tracks

**Track A — Meta account work (you, no coding):** make your app *allowed* to
onboard other businesses. Dashboard clicks + Meta review (days–weeks).
Nothing goes live to real clients until approved.

**Track B — Code in wacrm (Claude builds):** the button, the popup wiring,
and the server code that turns the popup's output into a saved connection.

They run in parallel — Track B builds/tests in "dev mode" while Track A's
review is pending.

---

## 2. Track A — your Meta checklist

App = `wacrm-test0`. Remaining:

1. **Client OAuth / domain settings.** *Facebook Login for Business* →
   *Settings* → *Client OAuth Settings*: add your domain under **Allowed
   Domains for the JavaScript SDK**; enable Client OAuth login, Web OAuth
   login, Enforce HTTPS, Embedded Browser OAuth Login, Login with the JS SDK.
   (The popup won't return data to an unlisted domain.)
2. **Create a Facebook Login for Business configuration.** Login variation
   **Embedded Signup** → product **Cloud API** → permissions
   `whatsapp_business_management` + `whatsapp_business_messaging` → **copy the
   Configuration ID.**
3. **Enroll as a Tech Provider.**
4. **Business verification** (handled separately by you).
5. **Deauthorize + Data Deletion callbacks.** Configure both callback URLs on
   the app (Meta requires them for apps handling business data, and App
   Review checks for them). These also drive offboarding — see §7d.
6. **Submit for App Review** requesting **Advanced Access** to the two
   permissions. Usually a short screen recording of the flow.

### What the two permissions are
- **`whatsapp_business_messaging` = the conversations** (send/receive,
  broadcasts, templates).
- **`whatsapp_business_management` = the setup/admin** (numbers, templates,
  profile, settings).

Selecting "Cloud API" requests both. Until approved, only you + test users
can complete the flow — enough to build and test.

---

## 3. How the flow works (confirmed against a real build + reviewed)

**Browser:**
1. Client clicks **Connect WhatsApp** (Settings → WhatsApp).
2. FB JS SDK (`connect.facebook.net/en_US/sdk.js`) runs `FB.login(...)` with
   your **Configuration ID**, `response_type: 'code'`,
   `override_default_response_type: true`.
3. Meta's popup handles login, asset selection, and **phone-number add +
   verification** (v4 default flow) — all on Meta's screens.
4. On **Finish**:
   - callback gives `response.authResponse.code` — one-time, **~30s TTL**.
   - a `WA_EMBEDDED_SIGNUP` message event gives `data.waba_id` +
     `data.phone_number_id`.

**Server (new endpoint receives code + waba_id + phone_number_id):**
5. **Exchange code for token** — `GET /oauth/access_token` with `client_id`,
   `client_secret`, `code` → long-lived **business integration system-user
   token**. Do this immediately (30s window). If it fails (expired/replayed
   code), return a clear "please retry Connect" error; the popup can re-run.
6. **Subscribe your app to their WABA** — `POST /{waba_id}/subscribed_apps`.
   ⚠ **This must be blocking for ES.** It is what makes webhooks flow to you.
   (The existing code treats subscribe failure as a non-fatal `console.warn`,
   `config/route.ts:344`. For ES, a failure here means the client is
   onboarded but receives nothing — so surface it as "not live," don't
   swallow it.)
7. **Phone registration — do NOT blindly reuse the manual `/register`+PIN
   path.** ⚠ In v4 the popup already verifies the number, and re-calling
   `/register` with an invented PIN can *fail* (PIN mismatch is a hard error,
   not idempotent — `meta-api.ts:137-155`) and the reused save logic then
   marks a working number `disconnected` (`config/route.ts:361-363`). Correct
   behavior: only call `/register` if the number is not already registered,
   and treat "already registered" / PIN errors as **success**, never
   downgrading a live row. Preferred: rely on the popup's registration and
   skip the server `/register` entirely unless a probe shows it's needed.
8. **Fetch metadata** (`verifyPhoneNumber`), **encrypt token**, **save** to
   `whatsapp_config` (+ token expiry, see §7c).
9. Done — inbound already routes to the right account (§6).

> If you configure `featureType: only_waba_sharing` (skip in-popup phone
> steps), the server must instead do phone-add → `request_code` →
> `verify_code` → `register`. **Recommendation: let the v4 popup do phone
> add/verify** so the server only does subscribe + save (+ conditional
> register per step 7).

---

## 4. Track B — what's reused vs new (reviewed & corrected)

Current `config/route.ts` POST = 11 steps. Corrected fate of each:

| # | Step in current POST | Fate in ES endpoint |
|---|----------------------|---------------------|
| 1 | Auth + resolve `account_id` | **Reuse verbatim** |
| 2 | Read pasted `{phone_number_id, waba_id, access_token, verify_token, pin}` | **Replace** — input is `{code, waba_id, phone_number_id}` |
| 3 | Validate fields + 6-digit PIN check | **Partial** — keep "IDs present"; drop user PIN |
| 4 | Cross-account duplicate phone check (409) | **Reuse verbatim** |
| 5 | `verifyPhoneNumber()` | **Reuse verbatim** |
| 6 | `encrypt()` token | **Reuse verbatim** (token from exchange) |
| 7 | Existing-row / skip-register lookup | **Reuse** (useful for re-connect) |
| 8 | `registerPhoneNumber(pin)` | ⚠ **Do NOT reuse verbatim** — needs ES-safe handling (§3 step 7): conditional call + treat already-registered/PIN errors as success, never downgrade |
| 9 | `subscribeWabaToApp()` | **Reuse the call, change error handling to blocking** (§3 step 6) |
| 10 | Insert/update `whatsapp_config` | **Reuse** — but see migration note below |
| 11 | Structured JSON responses | **Reuse the pattern** (add revoked/expired + code-expired cases) |

**Precise summary:** ~7 steps reuse cleanly (1,4,5,6,7,10,11); step 3 partial;
step 2 replaced; **steps 8 and 9 reuse the helper but need changed logic**
(the reviewer's load-bearing finding). Genuinely new server work: the
code→token exchange. Plus new browser code.

### New code (none exists today — grep confirmed)
- **A. Token-exchange helper** in `meta-api.ts` — `GET /oauth/access_token`.
- **B. New route** `src/app/api/whatsapp/embedded-signup/route.ts` —
  orchestrates §3 steps 5–8 with ES-safe register + blocking subscribe.
- **C. Frontend** in `whatsapp-config.tsx` — FB JS SDK, Connect button,
  `WA_EMBEDDED_SIGNUP` message listener + `FB.login` callback; keep manual
  form as fallback. Needs CSP `script-src` allowance for
  `connect.facebook.net` if any CSP is enforced.

### Files touched
- `src/lib/whatsapp/meta-api.ts` — add exchange helper; adjust register-error
  handling for ES.
- `src/app/api/whatsapp/embedded-signup/route.ts` — new.
- `src/components/settings/whatsapp-config.tsx` — SDK + button + listener.
- `src/app/api/whatsapp/webhook/route.ts` — small verify-token change (§6).
- **Migration (minimal, likely optional):** no `pin` column needed (Appendix
  B3 — the register PIN is a set constant, never stored). No token-refresh
  column needed (Appendix B4 — rely on a long-lived token). At most, add a
  small `connection_state` / "needs reconnect" flag so the UI can show a
  revoked/invalid token — nice-to-have, not blocking.
- `.env.local.example` + host env (§5).

---

## 5. New environment variables
- `NEXT_PUBLIC_META_APP_ID` — browser `FB.init`.
- `NEXT_PUBLIC_META_CONFIG_ID` — Configuration ID (Track A step 2).
- `META_APP_SECRET` — already used; needed for the exchange.
- `META_GRAPH_VERSION` — single source pinned for **both** `FB.init` and the
  server exchange, to stop the browser SDK and `meta-api.ts` (currently
  `v21.0`) drifting apart.
- `WHATSAPP_VERIFY_TOKEN` — single app-level webhook verify token (§6).
- (`META_SYSTEM_USER_ID` / `META_SYSTEM_USER_ACCESS_TOKEN` are **not** required
  for the per-account ES path — see Appendix B8.)

---

## 6. Webhook — good news + one small change (reviewer-confirmed)
**Already done:** inbound routing keys on `phone_number_id`
(`webhook/route.ts:260-297`), and POST security is app-level HMAC via
`META_APP_SECRET` — already multi-tenant-ready. The hard part is built.

**Small change:** ES uses one webhook URL + one verify token. Add a single
`WHATSAPP_VERIFY_TOKEN` env check to the GET handshake. **Caveat:** set it to
the exact value registered in the Meta dashboard, *or* keep the existing
per-config fallback, so a future re-verify doesn't fail. The handshake only
runs on (re)subscription, so existing manual users' runtime routing is
unaffected.

---

## 7. Decisions
**(a) Token model — store the per-client business integration token.**
Reviewer agrees this is the sound Tech-Provider path and that the
Solution-Partner route (your own system-user token + `assigned_users` + credit
sharing) is not needed for a model where clients pay Meta directly. Fits the
existing one-encrypted-token-per-config schema.

**(b) One number vs many per account.** Start with one (`UNIQUE(account_id)`,
confirmed `017:319-328`); add a `primary` flag later if needed (017 documents
this).

**(c) Token revocation/expiry — must handle (reviewer gap).** The exchange
response carries `expires_in`, and tokens can be revoked (client removes the
app). Store expiry; detect Meta OAuth errors (code 190) at send time and flag
the account as "needs reconnect." The current UI only understands
"token can't be decrypted," not "revoked" — add that state.

**(d) Offboarding — must handle (reviewer gap).** Wire the Deauthorize / Data
Deletion callbacks (Track A step 5) to stop using + delete the client's token
and drop their WABA subscription when they disconnect.

**(e) In-popup phone verification** — recommended (§3), minimizes server work.

---

## 8. Test plan
- **Dev mode (pre-approval):** you + a test business run the full popup;
  confirm row saved, token works (`verifyPhoneNumber`), test message
  round-trips, and an **already-verified number is NOT marked disconnected**
  (regression guard for the §3-step-7 fix).
- **Code timing:** exchange within 30s; verify the expired-code error path.
- **Subscribe failure:** simulate a `subscribed_apps` failure → account shows
  "not live," not a silent success.
- **Webhook:** single verify token handshake passes; inbound routes correctly.
- **Revocation:** revoke the app on Meta → account flips to "needs reconnect."
- **Fallback:** manual form still works for a Meta test number.

---

## 9. Deadlines & residual risks
- **Deadline:** v2/v3 Embedded Signup dies **Oct 15, 2026** — we build v4.
- **Long pole = App Review**, not code. Start Track A early.
- **Small residual to confirm at build:** whether your chosen v4 config
  returns the number already registered (letting you skip `/register`
  entirely) vs needing the conditional server call in §3 step 7. (The
  `WA_EMBEDDED_SIGNUP` event shape and the callback `code` path are both
  confirmed — no longer unknowns.)

---

## 10. What Claude can / cannot do
- **Can build all of Track B**: exchange helper, new route with ES-safe
  register + blocking subscribe, button + SDK + listener, webhook tweak, the
  required migration, revocation/expiry handling, and tests.
- **Cannot do Track A**: enrollment, verification, Configuration ID, callback
  setup, App Review — your Meta account/documents, Meta's timeline.
- **Workflow:** you finish Track A step 2 (Configuration ID) + step 5
  (callbacks) → share App ID + Config ID → Claude builds Track B → dev-mode
  test → submit for review → go live.

---

### Appendix B — CONFIRMED from OpenBSP source (real standard-flow code)

Read directly from `open-bsp-api/supabase/functions/whatsapp-management/
embedded_signup.ts` + `index.ts` + `whatsapp-webhook/index.ts` — a registered
Tech Provider's actual code. These facts are authoritative for the build.

**B1. Exact server sequence (Graph `v24.0`), for a new number:**
1. **Exchange:** `GET /v24.0/oauth/access_token?client_id={APP_ID}&client_secret={APP_SECRET}&code={code}` → `.access_token` (the business token). Plain GET, no body.
2. **Subscribe (blocking):** `POST /v24.0/{waba_id}/subscribed_apps`, header `Authorization: Bearer {business_token}`. Throws on failure.
3. **Register:** `POST /v24.0/{phone_number_id}/register`, body `{messaging_product:"whatsapp", pin:"123456"}`. OpenBSP uses a **constant PIN and does NOT store it**. (Skipped only for coexistence — not our case.)
4. **Metadata:** `GET /v24.0/{phone_number_id}` → display_phone_number, verified_name, quality_rating.
5. **Persist** token + ids on the account row (wacrm: encrypt into `whatsapp_config.access_token`).

**B2. Maps almost 1:1 onto wacrm's existing helpers:** `subscribeWabaToApp` =
step 2 (make it **blocking**); `registerPhoneNumber(pin)` = step 3 (pass a
constant PIN for new numbers; treat "already registered" as success);
`verifyPhoneNumber` = step 4. **The only new Meta call is step 1, the token
exchange.** Confirms the "mostly reuse + one new call" thesis with real code.

**B3. ⚠ PIN — NO migration needed (corrects earlier drafts).** A new number's
PIN is just a value you set at registration; OpenBSP hardcodes it and never
stores it. So drop the "encrypted `pin` column" idea. Keep graceful
"already registered" handling for re-runs.

**B4. Token model — CONFIRMED = §7a.** OpenBSP stores the **business token from
the exchange** as the per-account token and calls the Cloud API with it. It has
**no refresh logic** — it relies on a long-lived token from the config
template. Action: choose a long-lived-token ES config; add an "invalid token →
needs reconnect" state (no scheduled refresh required). The
`assigned_users`/own-system-user path is NOT used.

**B5. Webhook — CONFIRMED matches wacrm.** Single app-level
`WHATSAPP_VERIFY_TOKEN` env for the GET handshake; inbound routed by
`metadata.phone_number_id`; POST verified with `X-Hub-Signature-256`. wacrm
already does phone_number_id routing + HMAC — only the single-env verify token
needs adding (§6).

**B6. Offboarding — CONFIRMED call.** `POST /v24.0/{phone_number_id}/deregister`
then mark disconnected; new numbers only. Use for §7d.

**B7. What wacrm does NOT need** (OpenBSP has these only for its
"as-a-service" model — our Appendix C, out of scope): the per-tenant
callback-URL override, the public token-based `/onboard` route, and
contacts/message-history sync (coexistence-only). wacrm's flow is the
in-dashboard authenticated one: an admin clicks Connect while logged in.

**B8. ⚠ Env — simpler than earlier drafts.** The ES code uses only
`META_APP_ID` + `META_APP_SECRET` (exchange) and `WHATSAPP_VERIFY_TOKEN`
(webhook), plus browser `NEXT_PUBLIC_META_APP_ID` + `NEXT_PUBLIC_META_CONFIG_ID`.
`META_SYSTEM_USER_*` is **not** required for the per-account ES path (it's only
OpenBSP's optional global fallback token).

**B9. Frontend — CONFIRMED from `open-bsp-ui`
(`src/contexts/WhatsAppIntegrationContext.tsx`).**
- `FB.init({ appId, version: v24.0, autoLogAppEvents:true, xfbml:true })`;
  SDK from `connect.facebook.net/en_US/sdk.js` with an `onerror` fallback
  (blockers/ETP commonly block it — show an upfront error).
- **`message` listener:** ignore unless `event.origin` ends with
  `facebook.com` **and** payload string contains `WA_EMBEDDED_SIGNUP`; JSON-
  parse; handle `CANCEL` (abandoned/error) explicitly; on success capture
  `phone_number_id`, `waba_id`, `business_id`.
- **Event → flow_type:** `FINISH` → `new_phone_number` (**this is wacrm's
  standard case**), `FINISH_ONLY_WABA` → `only_waba`,
  `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` → `existing_phone_number`
  (coexistence — omit for us).
- **`FB.login`:** `config_id`, `response_type:'code'`,
  `override_default_response_type:true`, `extras:{ setup:{},
  sessionInfoVersion:'3' }`. ⚠ OpenBSP sets
  `featureType:'whatsapp_business_app_onboarding'` (coexistence); **wacrm OMITS
  `featureType`** to get the standard new-number flow. `sessionInfoVersion:'3'`
  is required to receive the events.
- Read `response.authResponse.code`, POST `{code, phone_number_id, waba_id,
  business_id, flow_type}` to the server signup route.

Everything — server and frontend — is now confirmed against real code.

**B10. App Review** = request Advanced Access to the two permissions with a
short screen recording each (required to onboard other businesses —
Laione/Cladens). Deauthorize + Data Deletion callbacks are standard and checked.

---

### Appendix — independent review summary
Critical (fixed above): (1) `/register`+auto-PIN can fail onboarding and mark
live numbers disconnected — now conditional + non-downgrading; (2) PIN
storage needs a migration — now marked required (or avoided by skipping
server register). Gaps folded in: token revocation/expiry (§7c), blocking
`subscribed_apps` (§3.6/§4.9), Deauthorize + Data Deletion callbacks
(§2.5/§7d), 30s-code failure UX (§3.5). Confirmed correct: no OAuth code
exists today; `phone_number_id` inbound routing; `verifyPhoneNumber` /
`subscribeWabaToApp` signatures reusable; `UNIQUE(account_id)`; cross-account
duplicate check; the "App Review is the long pole, Track B is mostly reuse"
framing.

---

### Appendix C — Deferred option (LAST RESORT — not pursued)

Routing customers' WhatsApp accounts under a **third party's** Meta app
("Tech-Provider-as-a-Service", e.g. OpenBSP hosted) to skip App Review /
business verification. **Rejected by project decision:** you want your own Meta
app and the market trust of a Meta-verified Tech Provider, and you don't want
customers connected through someone else. Recorded here only as a fallback if
becoming a Tech Provider ever proves blocked. Do not build against this unless
that happens.
