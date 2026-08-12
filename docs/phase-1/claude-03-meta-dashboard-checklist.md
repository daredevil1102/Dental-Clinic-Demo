# claude-03 — Meta dashboard checklist (Manish, not Claude Code)

- **Status:** Draft
- **Last updated:** 2026-08-10
- **Owner:** Manish. None of this is code.

Embedded Signup is two halves. This is the half done by hand in
`developers.facebook.com`. It produces the five values that `claude-02` §10 needs,
and four of these items **block** development — the code has nothing to point at
until they exist.

---

## Before you start

**Create the final ConnectsWA provider app now, and build Embedded Signup on
that app from day one.** Do not build on the app currently wired to ngrok.

Three reasons, and the third is the one that bites:

1. Clients see the app's name inside the popup, so it should read like a company.
2. App Review is tied to one specific app and cannot be transferred.
3. **App Review requires a screen recording of the working flow — on the app you
   are submitting.** Build and record on the old app and the recording is
   evidence for an app you aren't submitting. You would have to redo item 2's
   OAuth settings, recreate the configuration in item 3 (the `config_id` is
   per-app and ships to the browser), and re-test and re-record the whole flow
   on the new app before you could submit anything.

> ⚠️ **There is no swap.** Developing on one app and submitting another was
> considered and rejected — it contradicts reason 2 and throws away the
> recording. See [`archive/rejected-alternatives.md`](archive/rejected-alternatives.md)
> §6. One app, from first line of code to production.

**What the old app is still for:** manual / P1-10 testing, where it stands in for
a client-owned app. Keep it and its test number for that. It plays no part in
P1-11.

**Development mode is enough.** The final provider app in development mode lets
anyone with an App Role complete the entire flow, so nothing here has to wait for
approval. The only thing that changes between development and production is
*which URLs the app points at* — ngrok now, Hostinger at rollout stage 4
(`claude-02` §14). Same app, same configuration, same recording.

**Decide the name clients will see before creating the app.**

---

## Blocking — do these first

### 1. Create the app

`developers.facebook.com` → Create App → type **Business**. Owned by the business
portfolio you intend to verify, not a personal account.

**Record:** App ID, App Secret.
→ `NEXT_PUBLIC_META_PROVIDER_APP_ID`, `META_PROVIDER_APP_SECRET`

### 2. Facebook Login for Business → Settings → Client OAuth settings

Set **all** of these to Yes:

- Client OAuth login
- Web OAuth login
- Enforce HTTPS
- Embedded Browser OAuth Login
- Use Strict Mode for redirect URIs
- Login with the JavaScript SDK

Add **every host that will run the flow** — your ngrok domain now, your Hostinger
domain later — to **both**:

- Allowed Domains for the JavaScript SDK
- Valid OAuth redirect URIs

> ⚠️ Missing either field produces a popup that completes and returns nothing to
> the page. It is the hardest Embedded Signup failure to diagnose — everything
> looks correct and nothing happens. If that symptom appears, check here first.

HTTPS with a valid certificate only. `localhost` will not work.

### 3. Facebook Login for Business → Configurations → create one

- Login variation: **WhatsApp Embedded Signup**
- Products: **Cloud API only** — every extra asset is another screen a client can
  abandon on
- Token expiry: **create a custom configuration with no token expiry**

> ⚠️ **Do not use Meta's suggested template.** It is named "WhatsApp Embedded
> Signup Configuration With 60 Expiration Token" and issues credentials that die
> after 60 days. Taking it commits the build to a background renewal system, and
> if that system ever fails every client goes dark on day 60.
>
> This choice is baked into the configuration and cannot be changed afterwards.
> If one has already been created from the template, create a new one instead.

One configuration serves **all** clients — it is your flow definition, not a
per-customer thing. Creating a new configuration is also the only way to be on
version 4.

**Record:** Configuration ID (it is public; it ships to the browser).
→ `NEXT_PUBLIC_META_PROVIDER_CONFIG_ID`

### 4. Webhooks

Subscribe the app to the **WhatsApp Business Account** object, fields:

- `messages`
- `account_update` — **mandatory**, Meta requires it for Embedded Signup
- `message_template_status_update`

Callback URL: `https://<host>/api/whatsapp/webhook/provider`
Verify token: a value you invent, matching exactly.
→ `WHATSAPP_PROVIDER_VERIFY_TOKEN`

Use your ngrok address during development; change it to the Hostinger domain at
rollout stage 4 (`claude-02` §14).

> Never point the provider app at the manual callback URL
> (`/api/whatsapp/webhook`). They are separate on purpose.

You also need a six-digit registration PIN — any six digits, chosen once.
→ `WHATSAPP_PROVIDER_REGISTER_PIN`

---

## Non-blocking — run these in parallel with the build

### 5. App Settings → Basic

- Deauthorize Callback URL: `https://<host>/api/meta/deauthorize`
- Data Deletion Request URL: `https://<host>/api/meta/data-deletion`
- Privacy Policy URL and Terms of Service URL

App Review checks all four. The privacy and terms pages need to exist and be
reachable.

### 6. Tech Provider enrolment and business verification

Enrol as a Tech Provider and complete business verification for the portfolio
that owns the app. This takes days and is outside your control — start early.

### 7. App Review → Advanced Access

Request Advanced Access for:

- `whatsapp_business_management`
- `whatsapp_business_messaging`
- `business_management` — Meta's Tech Provider material states the system user
  must have granted this when working with Embedded Signup, and Advanced Access
  is required once the app touches WABAs your business does not own. That is
  every client.

> **Confirm the final set in the dashboard before submitting.** App Review →
> Permissions and Features lists exactly what your app requests, and it is
> authoritative. The required set has shifted across Embedded Signup versions,
> so treat this list as a starting point rather than gospel — request what the
> dashboard shows, and nothing you don't need.

Each requires a short **screen recording of the working flow**. This is why the
code has to be finished before you submit — you're demonstrating, not promising.

Until approval, only people with an App Role (admin / developer / tester) can
complete the popup. That is exactly enough to build, test and record.

---

## The five values, collected

| From | Value | Goes to |
| --- | --- | --- |
| Item 1 | App ID | `NEXT_PUBLIC_META_PROVIDER_APP_ID` |
| Item 1 | App Secret | `META_PROVIDER_APP_SECRET` |
| Item 3 | Configuration ID | `NEXT_PUBLIC_META_PROVIDER_CONFIG_ID` |
| Item 4 | Verify token (you invent it) | `WHATSAPP_PROVIDER_VERIFY_TOKEN` |
| Item 4 | Six-digit PIN (you invent it) | `WHATSAPP_PROVIDER_REGISTER_PIN` |

During development these go in `.env.local`. At rollout stage 5 they go into
hPanel → Environment variables, followed by a rebuild.

---

## After a client connects

They must add a payment method in WhatsApp Manager
(`https://business.facebook.com/wa/manage/home/`) or sends fail with billing
errors. Meta lists this as onboarding step 5. `claude-02` §8 surfaces a nudge in
the UI — otherwise it arrives as a ConnectsWA bug report.

---

## Client prerequisites — unchanged, and not solved by any of this

Send these before the first call, for both connection methods:

- The phone number must **not** currently be in use on WhatsApp or WhatsApp
  Business. Deleting that account to free the number permanently loses its chat
  history.
- Display name is reviewed by Meta.
- Business verification takes days.
- The client adds their own payment method.

Embedded Signup removes the developer work. It does not remove Meta's queues.
