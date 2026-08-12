# Phase 1 — Test Plan

A follow-along test plan for verifying Phase 1 features by hand. Living
document: each feature adds a section. Currently covers **P1-1 (rebrand)**,
**P1-7 (PWA Level 1)**, **P1-10 (per-client App Secret + two bug fixes)** and
**P1-11 (Embedded Signup, new workspaces only)**.

> §5A and §5B were rewritten to match `claude-01` and `claude-02`. The previous
> versions tested the two archived designs in `archive/`, and their migration
> numbers (037, 038) collided with the ones actually in use.

**How to use:** pick the environment (§2), run the automated checks (§3), then
walk the functionality tables (§4–§5B) marking Pass/Fail, do the device matrix
(§6) and the user-flow scenarios (§7), and finish with the regression pass (§8).
Log anything that fails with the template in §9 and record sign-off in §10.

**Legend:** ✅ Pass · ❌ Fail · ⚠️ Pass-with-note · ⬜ Not run.

---

## 1. Scope

| In scope                                                                                                                                                     | Out of scope (why)                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| P1-1: app name = ConnectsWA everywhere on-screen, brand mark (favicon/sidebar/auth), default corporate-blue theme, en + ko locales                           | Marketing/landing pages & Hostinger promo (backlog B1)                                                                        |
| P1-7: installable PWA — manifest, icons, iOS/Android install, fullscreen launch                                                                              | Push notifications / offline (Phase 2, P2-3)                                                                                  |
| P1-10: two or more manual workspaces on different client-owned Meta apps; per-client App Secret; account-scoped status writes; no ciphertext in the browser; connection health signal                                                                        | Server-only credential table, per-client callback URLs, credential-rotation state machine (archived); Embedded Signup; multi-number                                                        |
| P1-11: one provider app — Embedded Signup **for workspaces with no connection**, isolated provider webhook, Meta lifecycle callbacks, kill switch                                                                                                            | **Any** manual-to-embedded migration; assisted-provider onboarding; attempts table; coexistence / WhatsApp Business app numbers; multi-number per account; token refresh (claude-02 §2)   |
| Regression: core flows still work after the rebrand                                                                                                          | Backend/business-logic changes (none were made)                                                                               |

---

## 2. Test environments & prerequisites

You need a working `.env.local` (Supabase URL + keys, encryption key, etc.) for
anything that requires login. The **rebrand** tests need login; most **PWA**
checks don't, but the **install** tests do need a real device.

| Env                 | How to start                                                              | Use for                                           |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| **Dev**             | `npm run dev` → http://localhost:3000                                     | Fast visual checks, both locales                  |
| **Prod (local)**    | `npm run build && npm start` → http://localhost:3000                      | Realistic build; icon/manifest routes; Lighthouse |
| **Device / hosted** | Deployed HTTPS URL (or a tunnel like ngrok/cloudflared) opened on a phone | The only way to test real install on Android/iOS  |

> ⚠️ **HTTPS is required to install a PWA on a phone.** `localhost` counts as a
> secure context on desktop (Lighthouse works there), but a phone needs a real
> **HTTPS** origin — the deployed domain (OPS-1) or a temporary tunnel. Plain
> `http://<your-LAN-ip>:3000` will **not** offer "Install".

**Locale switch:** the app picks locale from the user/browser. To force Korean,
set the browser's preferred language to Korean (or your usual in-app switch) and
reload.

---

## 3. Automated checks (run first — must be green)

From the repo root:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: typecheck clean, lint 0 errors, all tests pass, build succeeds. Neither
P1-10 nor P1-11 may be pushed while the suite is red.

**Baseline as measured on the development machine (2026-08-11): 645/645 green**,
plus 25 from the §8.0b characterization files = **670/670**. An earlier note
predicted three currency/locale separator failures; they do not occur here. That
expectation was ICU/locale-dependent, so **record the count you actually observe
rather than assuming this one** — a different locale or CI image may still show
them, and that is a known-tolerable difference, not a regression.

> ⚠️ **Before §8.0b, a green suite proved very little about WhatsApp routing** —
> `src/app/api/` held exactly two route tests, neither covering
> `whatsapp/webhook` or `whatsapp/config`. Those two characterization files now
> exist. Keep them green and unmodified through the §4.4 extraction; the only
> permitted edits are the ones §5.4 and §8.7 explicitly call for, in the same
> commit as the behaviour change.

> Line endings need **no action** — `core.autocrlf=true` handles it. See
> `claude-00` §3 before believing any large modified-file count.

Optional quick icon/manifest smoke test against a running `npm start`:

```bash
curl -s localhost:3000/manifest.webmanifest
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" localhost:3000/icon
```

Expected: valid JSON manifest; `200 image/png` for `/icon`, `/apple-icon`,
`/icons/pwa-192`, `/icons/pwa-512`, `/icons/maskable`.

---

## 4. Functionality tests — P1-1 Rebrand

| ID    | Steps                                                                              | Expected                                                                            | Result |
| ----- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| RB-01 | Open any page; look at the **browser tab** title                                   | Reads **ConnectsWA** (or "<Page> — ConnectsWA"); no "wacrm"                         | ⬜     |
| RB-02 | Look at the **browser tab favicon**                                                | Blue rounded-square mark with a white message-bubble + up-arrow; not the old violet | ⬜     |
| RB-03 | Sign-in page (`/login`, logged out)                                                | Brand mark = new blue bubble+arrow; primary buttons/links are **blue**, not violet  | ⬜     |
| RB-04 | Sign-up page (`/signup`)                                                           | Tagline reads "Get started with **ConnectsWA**"; mark matches                       | ⬜     |
| RB-05 | Log in; check the **sidebar** header                                               | Logo mark = new glyph; label reads **ConnectsWA**                                   | ⬜     |
| RB-06 | Scan primary UI (buttons, active nav, links)                                       | Accent colour is corporate **blue** (cobalt) throughout                             | ⬜     |
| RB-07 | Settings → Theme picker                                                            | "Cobalt" is the active/default accent; switching themes still works                 | ⬜     |
| RB-08 | Settings → AI Assistant description text                                           | Mentions **ConnectsWA**, not wacrm                                                  | ⬜     |
| RB-09 | Invite a teammate → the generated WhatsApp invite message                          | Says "on **ConnectsWA**" (or account name); no wacrm                                | ⬜     |
| RB-10 | WhatsApp templates → delete dialog copy                                            | References **ConnectsWA**, not wacrm                                                | ⬜     |
| RB-11 | Switch locale to **Korean**; repeat RB-01, RB-05, RB-08, RB-09                     | Name shows as **ConnectsWA**; sentences read naturally (see KO note)                | ⬜     |
| RB-12 | Search the running UI for the string "wacrm" (visually / Ctrl-F on rendered pages) | Not visible anywhere in the product UI                                              | ⬜     |

> **KO note (RB-11):** particles were adjusted for the vowel-ending name
> (으로→로, 이→가, 은→는). A native Korean speaker should confirm they read
> naturally (backlog **B3**). Flag any awkward spacing/particle as a ⚠️.

**Not-to-break (internal, intentionally still "wacrm"):** API keys still start
`wacrm_live_`, webhook headers are still `X-Wacrm-*`. These are contracts, not
UI — do **not** report them as rebrand misses.

---

## 5. Functionality tests — P1-7 PWA

Run against **Prod (local)** for §5.1 and a **device/hosted** URL for §5.2.

### 5.1 Manifest & icons (desktop / Lighthouse)

| ID     | Steps                                                                              | Expected                                                                                           | Result                                           |
| ------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| PWA-01 | Open `/manifest.webmanifest`                                                       | Valid JSON: `name`/`short_name` = ConnectsWA, `display` = standalone, 3 icons (192, 512, maskable) | ✅ (curl-verified, local + tunnel)               |
| PWA-02 | Open `/icon`, `/apple-icon`, `/icons/pwa-192`, `/icons/pwa-512`, `/icons/maskable` | Each shows the blue brand mark as a PNG (maskable = full-bleed, smaller glyph)                     | ✅ (all 200 image/png; on-device icon confirmed) |
| PWA-03 | Chrome DevTools → Application → Manifest                                           | No errors; icons listed; "Installability" shows the app is installable                             | ⬜                                               |
| PWA-04 | Lighthouse (or DevTools) PWA / installability audit                                | "Installable" passes; manifest + icons detected                                                    | ⬜                                               |
| PWA-05 | DevTools → Application → Manifest → maskable preview (or maskable.app)             | Glyph stays inside the safe circle when masked (not clipped)                                       | ⬜                                               |

### 5.2 Install & launch (real devices)

> ⚠️ **Use a clean origin (Cloudflare tunnel or deployed domain), NOT ngrok-free**
> — ngrok's interstitial makes installs fall back to a shortcut with a wrong
> icon (see P1-7 doc + backlog B8).

| ID     | Device             | Steps                                                              | Expected                                                                    | Result                                                                         |
| ------ | ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| PWA-06 | **Android Chrome** | Open clean HTTPS URL → menu → "Install app" / "Add to Home screen" | Installs; home-screen icon = blue mark, not clipped; name = ConnectsWA      | ✅ (2026-08-09; icon correct on Cloudflare tunnel. ❌ on ngrok — see B8)       |
| PWA-07 | **Android**        | Launch from home screen                                            | Opens **fullscreen** (no browser address bar); splash shows icon on dark bg | ❌ Opens in-browser (shortcut), not standalone — needs service worker (**B7**) |
| PWA-08 | **iOS Safari**     | Open clean HTTPS URL → Share → "Add to Home Screen"                | Icon = blue mark; label = ConnectsWA                                        | ⬜                                                                             |
| PWA-09 | **iOS**            | Launch from home screen                                            | Opens fullscreen (standalone); status bar readable                          | ⬜ (likely also blocked until B7)                                              |
| PWA-10 | Either             | Use the app installed (navigate a few screens)                     | Behaves like the browser app; no broken layout in standalone                | ⬜                                                                             |

---

## 5A. Functionality tests — P1-10 per-client App Secret

> Spec: [claude-01-P1-10-manual-onboarding.md](claude-01-P1-10-manual-onboarding.md).
> Read [claude-00](claude-00-architecture-overview.md) first.
>
> **This section was rewritten.** The previous version tested the archived
> `P1-10-full-multi-app-architecture.md` design — a `whatsapp_connection_secrets`
> table under migration 037, a destructive column drop under 038, and a sanitized
> config API. None of that is being built, and its migration numbers collided
> with the ones actually in use. See claude-01 §12.
>
> Stage 1 does not pass merely because one manual client works. **Two different
> Meta apps must work simultaneously, and neither may affect the other.**
>
> **What belongs here vs. in Vitest.** This is a *manual* plan. Anything that
> needs Meta to fail on demand — an expired OAuth code, a rejected subscription,
> a forced registration error, a specific popup event — is unreliable to trigger
> by hand and belongs in the automated suites (claude-01 §9, claude-02 §13).
> What stays below is what only a human with two real phones can prove.

### 5A.0 Pre-flight gate (blocking — nothing below runs until these pass)

| ID   | Check                                                                                                     | Expected                                                                                              | Result |
| ---- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| M-01 | Characterization tests exist and pass for `whatsapp/webhook/route.ts` **against unchanged code**          | GET token match/mismatch, POST valid/invalid HMAC, raw-body sensitivity, unknown number, multi-row guard | ⬜     |
| M-02 | Characterization tests exist and pass for `whatsapp/config/route.ts` **against unchanged code**           | Save persists encrypted; 409 cross-account; role enforcement; today's registration-error → `disconnected` | ⬜     |
| M-03 | Status-update behaviour characterized                                                                     | `sent`/`delivered`/`read`/`failed` mirror onto `messages`; transition guard holds                      | ⬜     |
| M-04 | Full suite green, observed baseline recorded                                                              | 670/670 as of 2026-08-11. No feature work begins on a red or unexplained baseline                      | ✅     |
| M-05 | Current production commit tagged **and pushed**                                                           | `pre-p1-10` at `1a86e5f`, visible on `origin` — a local-only tag is not a rollback target              | ⬜     |

> Line endings need no action (`core.autocrlf=true`) — verify only, no test ID.

### 5A.1 Migration 037 and credential handling

Use a disposable Supabase database seeded with a representative connected row.

| ID   | Steps                                                                        | Expected                                                                                             | Result |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------ |
| M-10 | Apply migration 037 to an empty database                                      | `app_secret` and `last_inbound_at` added; idempotent on re-run                                        | ⬜     |
| M-11 | Apply 037 to a database with an existing connected row                       | Row untouched; `app_secret IS NULL`; connection still sends and receives with `META_APP_SECRET`       | ⬜     |
| M-11a | `SELECT … FROM whatsapp_config WHERE waba_id IS NULL` before deploying      | **Zero rows.** A NULL `waba_id` loses template-lifecycle events after §4.1.1 (claude-01 §10 step 0)   | ⬜     |
| M-12 | Save an App Secret through Settings, then read the row directly              | Stored ciphertext only; never plaintext                                                              | ⬜     |
| M-13 | Inspect the `GET`/`POST` responses of `/api/whatsapp/config`                 | No `app_secret`, `access_token` or `verify_token` — not plaintext, not ciphertext                     | ⬜     |
| M-14 | Open Settings → WhatsApp with DevTools → Network, inspect the Supabase query | The `whatsapp_config` select requests no credential column (claude-01 §6.2b)                          | ⬜     |
| M-14a | **From the browser console, query `whatsapp_config` selecting `access_token` for your own account** | **Permission error — not a row with nulls.** This is criterion #4; M-14 alone does not prove it (§6.2a) | ⬜     |
| M-14b | Repeat M-14a for `verify_token` and `app_secret`                            | Permission error on each                                                                              | ⬜     |
| M-14c | After the REVOKE: send a message, run a broadcast, sync templates, react, fetch media, verify-registration | All still work — the §6.2c regression surface                                        | ⬜     |
| M-15 | Grep the server logs across a full save + inbound + outbound cycle           | No token, App Secret, verify token or PIN in any log line                                            | ⬜     |
| M-16 | **Connect a brand-new workspace leaving App Secret blank**                    | **400; nothing saved.** The error names the field and where to find it (claude-01 §5.1.1)             | ⬜     |
| M-17 | Re-save an existing connection leaving the App Secret field at its mask       | Stored ciphertext unchanged; no 400; connection still live                                           | ⬜     |
| M-18 | Re-save the grandfathered `app_secret IS NULL` row without supplying one      | Still `NULL`, still verifying via `META_APP_SECRET`, no 400                                          | ⬜     |

### 5A.2 Authorization

| ID   | Steps                                              | Expected                                             | Result |
| ---- | ---------------------------------------------------- | ------------------------------------------------------ | ------ |
| M-20 | POST/DELETE `/api/whatsapp/config` while signed out | 401; no Meta call, no database write                 | ⬜     |
| M-21 | POST and DELETE as agent, then as viewer            | 403; no side effect. **New behaviour — no role gate exists before claude-01 §5.4** | ⬜     |
| M-21a | GET as agent and viewer                            | 200; still no credential column in the response      | ⬜     |
| M-22 | Save as owner, then re-save as admin               | Both permitted (`requireRole('admin')`)              | ⬜     |
| M-23 | Claim another workspace's Phone Number ID          | 409; the original connection is unchanged            | ⬜     |

### 5A.3 Two-client webhook isolation — the core of this release

Two workspaces, two client-owned Meta apps, **one shared callback URL**.

| ID   | Steps                                                            | Expected                                                                        | Result |
| ---- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------ |
| M-30 | Message number A from a phone                                    | Lands once, in workspace A's inbox only                                         | ⬜     |
| M-31 | Message number B from a phone                                    | Lands once, in workspace B's inbox only                                         | ⬜     |
| M-32 | Reply from both workspaces                                       | Both deliver                                                                    | ⬜     |
| M-33 | Put a wrong App Secret on A in ConnectsWA                        | A's inbound stops; **B keeps working**; restoring A's secret recovers it        | ⬜     |
| M-34 | Clear A's `app_secret` (leave `META_APP_SECRET` set)             | A falls back to the env secret and still verifies; B unaffected                 | ⬜     |
| M-35 | GET handshake with each workspace's verify token                 | Challenge returned; behaviour identical to the M-01 baseline                    | ⬜     |

> Signature-forgery, unknown-WABA, shared-`waba_id`, duplicate-`message_id` and
> raw-body cases are **automated** (claude-01 §9 — "Tenant resolution" and
> "Status isolation"). They need forged payloads and seeded collisions, which is
> a unit test, not a phone.

### 5A.4 The two bug fixes

| ID   | Steps                                                        | Expected                                                                                    | Result |
| ---- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ |
| M-40 | Re-save workspace A entirely, nothing changed                 | A stays live and `connected`; **B completely untouched**                                     | ⬜     |
| M-41 | Save with a WABA the app isn't subscribed to                   | Response reports it; UI shows a **persistent warning**, not a toast; `subscribed_apps_at` unset | ⬜     |

> The no-downgrade branches (registration error on live vs. new vs.
> number-changed) are automated — claude-01 §9 "Config route". Forcing Meta to
> fail `/register` on demand is not a manual test.

### 5A.5 Connection health signal

| ID   | Steps                                       | Expected                                       | Result |
| ---- | --------------------------------------------- | ------------------------------------------------ | ------ |
| M-50 | Receive an inbound message, reload Settings | "Last inbound" shows a recent time             | ⬜     |
| M-51 | Fresh connection that has received nothing  | Reads "never" — not blank, not an error        | ⬜     |

> Inbound only, by design — there is no `last_outbound_at`. Three send paths
> bypass `send-message.ts`, so an outbound stamp would read "never" while
> broadcasts were sending. See claude-01 §3.1.

### 5A.6 P1-10 acceptance criteria — canonical

> **This is the single definition of "done" for P1-10.** claude-01 §9 points
> here. Do not restate these anywhere else; amend them here instead.

All ten, or the release does not ship:

- [ ] 1. Two workspaces on two different client-owned Meta apps send and receive
      **simultaneously**, through one deployment and one shared callback URL.
- [ ] 2. Neither workspace can affect the other — inbound routing, status
      updates, or a re-save.
- [ ] 3. A new manual connection **cannot be saved without an App Secret**
      (400, nothing written). — M-16
- [ ] 4. No **stored** credential — plaintext or ciphertext — is returned from
      the server or database to the browser, exposed in an API response, or
      written to logs. Newly entered credentials travel only to the
      authenticated server endpoint, over HTTPS. — M-12…M-15
- [ ] 5. Re-saving the **same** working connection, including during a temporary
      Meta registration failure, cannot take it offline. (Changing to a
      *different* number and failing registration correctly writes
      `disconnected` — claude-01 §5.2.) — M-40
- [ ] 6. A failed WABA subscription is reported at save time, never swallowed
      into a clean success. — M-41
- [ ] 7. Last inbound is visible per workspace without opening the database.
      — M-50, M-51
- [ ] 8. The characterization gate (M-01…M-05) and the full automated suite are
      green.
- [ ] 9. The production callback URL is the permanent Hostinger HTTPS domain —
      **never a tunnel**.
- [ ] 10. Rollback tag recorded, migration number recorded, build green.

---

## 5B. Functionality tests — P1-11 Embedded Signup

> Spec: [claude-02-P1-11-embedded-signup.md](claude-02-P1-11-embedded-signup.md).
> Meta dashboard prerequisites: [claude-03](claude-03-meta-dashboard-checklist.md).
>
> **This section was rewritten.** The previous version tested the archived
> `P1-11-full-provider-and-migration.md` design — assisted-provider onboarding,
> sanitized attempt IDs, a `META_GRAPH_VERSION` env var and one-client-at-a-time
> legacy migration. All are explicit non-goals now.
>
> **Embedded Signup applies only to a workspace with no WhatsApp connection.**
> There is no migration to test; there is a *refusal* to test.

### 5B.0 Prerequisites (all true, or stop)

| #   | Prerequisite                                                                                                                    | How to confirm                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| P-1 | Real HTTPS host with a valid certificate. `localhost` will not work. The static ngrok domain qualifies and does not rotate.      | Load over `https://` with no warning                  |
| P-2 | That host is in **both** *Allowed Domains for the JavaScript SDK* **and** *Valid OAuth redirect URIs*                            | claude-03 item 2                                      |
| P-3 | Configuration created: variation = WhatsApp Embedded Signup, products = Cloud API only, **custom config with no token expiry**   | claude-03 item 3; Configuration ID copied             |
| P-4 | Exactly five provider env vars set: `NEXT_PUBLIC_META_PROVIDER_APP_ID`, `NEXT_PUBLIC_META_PROVIDER_CONFIG_ID`, `META_PROVIDER_APP_SECRET`, `WHATSAPP_PROVIDER_VERIFY_TOKEN`, `WHATSAPP_PROVIDER_REGISTER_PIN`. **No `META_PROVIDER_APP_ID`, no `META_GRAPH_VERSION`** — claude-02 §10 | App boots; Connect renders on an unconnected workspace |
| P-5 | Provider app subscribed to `messages`, `account_update`, `message_template_status_update`; callback = `https://<host>/api/whatsapp/webhook/provider` | claude-03 item 4; subscription verified               |
| P-6 | Your Meta user has an App Role (admin / developer / tester)                                                                     | App Dashboard → App roles                             |
| P-7 | A phone number not currently on WhatsApp, consumer or Business, able to receive SMS or a call                                   | —                                                     |
| P-8 | A throwaway business portfolio playing "the client"                                                                             | —                                                     |
| P-9 | Sandbox Supabase database with **no production data**, and one live `manual` test workspace to prove non-interference           | claude-00 §4                                          |

> Keep DevTools open, but the authorization code, business token and full Meta
> payload must never be logged. Diagnose from `session_id` and `error_code` only.

### 5B.1 Pre-flight (no phone number consumed)

| ID    | Steps                                                            | Expected                                                          | Result |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------- | ------ |
| ES-01 | Load Settings → WhatsApp on an **unconnected** workspace         | **Connect WhatsApp** primary; manual form available underneath    | ⬜     |
| ES-02 | Load Settings → WhatsApp on a **connected `manual`** workspace   | **No Connect button anywhere.** Not disabled — absent             | ⬜     |
| ES-03 | Unset `NEXT_PUBLIC_META_PROVIDER_CONFIG_ID`, rebuild, reload     | Button gone; manual form is the only path                         | ⬜     |
| ES-04 | Block `connect.facebook.net` (Firefox ETP or a blocker)          | Clear message, button disabled, manual form offered — never a silent dead button | ⬜     |
| ES-05 | Open the popup and close it immediately                          | No connection created; no error state stuck on screen             | ⬜     |

### 5B.2 Full onboarding (consumes the test number)

| ID    | Steps                                                   | Expected                                                         | Result |
| ----- | --------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| ES-10 | Complete the popup with the test portfolio and number   | Connected; `connection_method = 'embedded'`                      | ⬜     |
| ES-11 | Inspect the row                                         | `app_secret` and `verify_token` NULL; token encrypted; `business_id` stored if returned | ⬜     |
| ES-12 | Click "Verify Registration"                             | The provider app is listed on that WABA                          | ⬜     |
| ES-13 | Message the number from a phone                         | Lands once, in the right inbox                                   | ⬜     |
| ES-14 | Reply from ConnectsWA                                   | Delivers; status updates arrive                                  | ⬜     |
| ES-15 | Exercise contacts, automations, templates, reporting    | Identical to a manual workspace                                  | ⬜     |
| ES-16 | Confirm the payment-method nudge                        | Links to `business.facebook.com/wa/manage/home/`                 | ⬜     |

### 5B.3 Refusal — the removed migration path

**This is the section that replaces the old migration rehearsal. It tests that
migration is unreachable, not that it works.**

| ID    | Steps                                                                                   | Expected                                                                      | Result |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| ES-20 | On a live `manual` workspace, POST `/api/whatsapp/embedded-signup` directly              | 409 `connection_exists`                                                       | ⬜     |
| ES-21 | Diff that workspace's `whatsapp_config` row before and after ES-20                       | **Identical in every column** — token, `app_secret`, `verify_token`, status    | ⬜     |
| ES-22 | Confirm that workspace still sends and receives after ES-20                              | Unaffected                                                                    | ⬜     |
| ES-23 | Repeat ES-20 with `confirm_replace: true` in the body                                    | **Still 409.** The flag is ignored and must not exist server-side              | ⬜     |
| ES-24 | Repeat ES-20 against a workspace whose connection is `disconnected`                      | **Still 409.** Broken is not absent                                           | ⬜     |
| ES-25 | Repeat ES-20 against an already-`embedded` workspace                                     | 409                                                                           | ⬜     |
| ES-26 | Grep the codebase for `confirm_replace`                                                  | Only in claude-02 §5.3.1 / §6 prose explaining its removal — never in `src/`   | ⬜     |

### 5B.4 Failure paths a human can actually cause

| ID    | Steps                                                 | Expected                                                     | Result |
| ----- | ------------------------------------------------------- | -------------------------------------------------------------- | ------ |
| ES-30 | Abandon the popup at each screen in turn              | No connection created; no stuck error state                  | ⬜     |
| ES-31 | Complete the popup, then close it on the final screen | **Treated as success**, not cancel                           | ⬜     |
| ES-32 | Double-click Connect                                  | One connection; the second request 409s                      | ⬜     |
| ES-33 | Run the flow as agent, then as viewer                 | 403 `forbidden`; no Meta call                                | ⬜     |
| ES-34 | Leave the popup idle past 30 s before finishing       | `code_expired`; nothing persisted; a clean retry is offered   | ⬜     |

> The rest of the failure matrix is **automated** — claude-02 §13: exchange
> failure, subscription failure, registration failure and its `disconnected`
> outcome, "already registered", duplicate number, and the `FINISH_ONLY_WABA` /
> coexistence event branches. Forcing Meta to return a specific error on demand
> is a mocked-`fetch` unit test; attempting it by hand produces "couldn't
> reproduce," not a result.

### 5B.4a Registration recovery (claude-02 §5.3.3)

Worth doing by hand once, because it is the state a real client will hit.

| ID    | Steps                                                                   | Expected                                                                  | Result |
| ----- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| ES-35 | Reach a connection whose registration failed (or set the row by hand)    | Settings shows an **actionable incomplete state**, status `disconnected` — never a green "Connected" over a dead number | ⬜     |
| ES-36 | Click the retry action                                                  | `registerPhoneNumber` runs with the stored token and provider PIN; on success the row flips to `connected` and the error clears | ⬜     |
| ES-37 | Send and receive after a successful retry                               | Both work                                                                 | ⬜     |

### 5B.5 Webhooks, callbacks and boundary isolation

| ID    | Steps                                                                                  | Expected                                                                          | Result |
| ----- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| ES-50 | Provider GET during Meta's callback-URL verification                                    | Verified in the Meta dashboard on the first attempt                               | ⬜     |
| ES-51 | Provider POST — send a real message to the embedded number                              | 200; processed exactly once; lands in the right workspace                         | ⬜     |
| ES-52 | Remove the provider app from the client side (`PARTNER_APP_UNINSTALLED`)                | Only that workspace marked disconnected; manual workspaces untouched (claude-02 §9.1) | ⬜     |
| ES-53 | Load `/api/meta/data-deletion`'s status page in a browser                                | Reachable, and explains the process a client would follow                          | ⬜     |
| ES-54 | POST a valid `signed_request` to `/api/meta/data-deletion`, then query the table         | A `data_deletion_requests` row exists with the returned `confirmation_code`, `status='received'` and `received_at` set; `docs/data-deletion-runbook.md` names an owner and completion process (claude-02 §9.2) | ⬜     |
| ES-55 | **Throughout the whole of §5B, watch the two `manual` workspaces**                      | **Never interrupted, never prompted, never modified**                             | ⬜     |

> Signature forgery, cross-boundary secret rejection, `signed_request` tampering,
> unresolvable entries and method-mismatch on the manual route are **automated**
> — claude-02 §13 "Webhooks and callbacks". Hand-crafting an HMAC against a live
> endpoint is a unit test with a mocked body, not a browser exercise.

### 5B.6 Kill switch

| ID    | Steps                                                       | Expected                                                       | Result |
| ----- | ------------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| ES-60 | Unset `NEXT_PUBLIC_META_PROVIDER_CONFIG_ID`, rebuild, restart | Button gone for unconnected workspaces                        | ⬜     |
| ES-61 | With the switch off, use the ES-10 embedded workspace       | **Still sends and receives** — server routes remain deployed   | ⬜     |
| ES-62 | Re-set the var, rebuild, restart                            | Button returns; no data change                                 | ⬜     |

### 5B.7 Cleanup after testing

- [ ] Remove the test number from the provider app.
- [ ] Delete sandbox workspaces created during testing.
- [ ] Confirm no production credential ever entered the sandbox database.
- [ ] Retain the screen recording required for App Review.

### 5B.8 P1-11 acceptance criteria — canonical

> **This is the single definition of "done" for P1-11**, and the gate for
> enabling the feature in production. claude-02 §13 points here. Do not restate
> these anywhere else; amend them here instead.

All twelve:

- [ ] 1. A workspace with **no** connection completes Embedded Signup end to
      end; the client never holds Meta credentials. — ES-10…ES-16
- [ ] 2. A workspace with **any** connection cannot reach Embedded Signup by any
      route — no button, 409 from the API, unaffected by a stale request.
      — ES-20…ES-26
- [ ] 3. No manual workspace is interrupted, prompted or modified at any point.
      — ES-55
- [ ] 4. **A registration failure is never presented as connected**, and the
      retry action recovers it. — ES-35…ES-37
- [ ] 5. Manual and provider webhook boundaries reject each other's signatures;
      neither falls back to the other's secret. — automated, claude-02 §13
- [ ] 6. The provider App Secret never appears in a workspace row.
- [ ] 7. Embedded and manual workspaces feed the same CRM with no data crossing
      between them. — ES-15
- [ ] 8. The kill switch stops new signups without disconnecting existing
      embedded **or** manual clients. — ES-60…ES-62
- [ ] 9. A valid data-deletion callback **creates a durable
      `data_deletion_requests` record** with a confirmation code, status and
      timestamp. A runbook identifies the owner and the completion process.
      — ES-54
- [ ] 10. No production data or production credential ever entered the test
      environment.
- [ ] 11. The claude-01 characterization suite still passes — behaviour
      unchanged.
- [ ] 12. Meta App Review approved **on the app that was built and recorded**.

---


## 6. Device / browser matrix

Run the smoke path (log in → inbox → one nav) on each; note rendering issues.

| Platform | Browser      | Rebrand look | PWA install       | Result |
| -------- | ------------ | ------------ | ----------------- | ------ |
| Desktop  | Chrome/Edge  | RB-01…08     | PWA-01…05         | ⬜     |
| Desktop  | Firefox      | RB-01…08     | manifest detected | ⬜     |
| Desktop  | Safari (mac) | RB-01…08     | n/a               | ⬜     |
| Android  | Chrome       | RB (mobile)  | PWA-06/07         | ⬜     |
| iPhone   | Safari       | RB (mobile)  | PWA-08/09         | ⬜     |

---

## 7. User acceptance test (UAT) scenarios

End-to-end, "act like a real user." Pass = the flow completes and everything on
screen is on-brand.

- **UAT-1 — New user first impression:** land on `/login` → note branding →
  sign up → verify email copy → land in app. _Expect:_ ConnectsWA name + blue
  brand from first screen to dashboard; nothing says wacrm.
- **UAT-2 — Owner installs the app:** on a phone, open the hosted URL, install
  to home screen, launch, log in, open the inbox. _Expect:_ feels like a native
  app (own icon, fullscreen), fully usable.
- **UAT-3 — Team invite:** owner invites a teammate; teammate reads the invite
  message and joins. _Expect:_ invite text is on-brand and clear.
- **UAT-4 — Korean user:** switch to Korean, repeat UAT-1. _Expect:_ name and
  copy read naturally to a Korean speaker.
- **UAT-5 — two manual Meta apps:** operate two workspaces on different
  client-owned apps and secrets. _Expect:_ inbound, outbound and status updates
  are isolated; neither workspace can affect the other; the settings page shows
  each one's last inbound and outbound; no credential value is queryable from
  the browser.
- **UAT-6 — self-serve onboarding on the provider app:** after the P1-11
  prerequisites, connect a **brand-new, unconnected** workspace through Embedded
  Signup while the two UAT-5 manual workspaces stay live. _Expect:_ the new
  workspace connects without the client ever holding Meta credentials; every
  workspace has exactly one connection; the manual workspaces are never
  interrupted, prompted or modified; and no Connect affordance appears anywhere
  on a connected workspace.

  > There is deliberately **no cutover scenario.** Migrating an existing manual
  > client is out of scope — see claude-02 §5.3.1. The corresponding test is
  > ES-20…ES-26, which prove the path is *refused*.

---

## 8. Regression pass (rebrand must not break function)

The rebrand only touched text, one shared icon component, and the default theme.
Confirm core flows still work:

| ID     | Flow                                                          | Expected                           | Result |
| ------ | ------------------------------------------------------------- | ---------------------------------- | ------ |
| REG-01 | Log in / log out                                              | Works                              | ⬜     |
| REG-02 | Open inbox, select a conversation, send a message             | Works                              | ⬜     |
| REG-03 | Theme switch (cobalt → another → back) persists across reload | Works                              | ⬜     |
| REG-04 | Light/dark mode toggle                                        | Works; blue accent legible in both | ⬜     |
| REG-05 | Contacts / pipelines / broadcasts pages load                  | No console errors, no broken icons | ⬜     |
| REG-06 | Settings tabs (profile, WhatsApp, AI) load                    | Works                              | ⬜     |

---

## 9. Bug report template

```
[ID or area]  e.g. RB-06 / PWA-07
Environment:  dev | prod-local | Android Chrome | iOS Safari  (+ version)
Locale:       en | ko
Steps:        1… 2… 3…
Expected:     …
Actual:       …
Severity:     blocker | major | minor | cosmetic
Evidence:     screenshot / URL / console error
```

---

## 10. Sign-off

| Feature                | Tester | Date | Result | Notes                                                               |
| ---------------------- | ------ | ---- | ------ | ------------------------------------------------------------------- |
| P1-1 Rebrand           |        |      | ⬜     |                                                                     |
| P1-7 PWA               |        |      | ⬜     |                                                                     |
| P1-10 Per-client App Secret |   |      | ⬜     | All ten criteria in **§5A.6** — the canonical list — before P1-11 starts |
| P1-11 Embedded Signup  |        |      | ⬜     | All twelve criteria in **§5B.8** — the canonical list — before enablement |

> A feature is "Done" (per the phase-1 workflow) when its functionality table,
> the relevant device matrix rows, and the regression pass are all ✅ (or ⚠️
> with accepted notes), and sign-off is recorded here.
