# wacrm — Client Onboarding Runbook (Manual Phase)

**Version:** 1.0 · **Date:** 9 August 2026
**Applies to:** the manual onboarding phase, before Embedded Signup is live.
**Audience:** you, running the onboarding call. Written to be followed without
needing to understand the code.

---

## 0. The one-paragraph summary

The client keeps ownership of their own WhatsApp account and their own Meta app.
You collect five items from them, paste four into wacrm, and walk them through
pasting two into Meta. Then you send a test message and watch it land in their
inbox. If a client has never set up WhatsApp API before — which is most of them —
add a separate 1–2 hour session before this one, and expect a few days of waiting
on Meta.

---

## 1. Glossary — the five things you collect

You will hear these words constantly. Here's what each actually is.

| Item | What it is | Where the client gets it |
|---|---|---|
| **WABA ID** | The ID of their WhatsApp Business Account — the container that holds their number(s). | Meta for Developers → their app → WhatsApp → API Setup |
| **Phone Number ID** | The ID of the specific number, not the number itself. Meta identifies numbers by this, not by the digits. | Same page as above |
| **Permanent access token** | The key that lets wacrm send messages on their behalf. Generated from a System User so it doesn't expire. | Business Settings → System Users → Generate Token |
| **App Secret** | Proves that incoming messages genuinely came from Meta and not an impostor. See §7 for why this matters. | Meta for Developers → their app → App Settings → Basic → App Secret → *Show* |
| **Verify token** | A password **you invent**. Meta says it back to you once, to confirm you're the right recipient. Any random string. | You generate it — nothing to fetch |

Two more terms you'll use on the call:

- **Callback URL** — the postal address where Meta delivers incoming messages.
  Your app doesn't ask Meta for new messages; Meta pushes them to this address.
  No callback URL = the inbox stays empty forever, no matter what else is right.
- **Business Portfolio** (formerly Business Manager) — the client's company
  account at Meta that owns the app and the WhatsApp account.

---

## 2. Before you onboard anyone

**Get off ngrok and onto a real web address.** This is non-negotiable before a
paying client. On ngrok the app only exists while your laptop is on and the
tunnel is running — when it stops, the client's inbox goes dark and messages sent
during that window are gone. Deployment steps are in `Deploy.md`.

Once deployed, your two fixed addresses become:

- **App link (for clients to log in):** `https://<your-domain>`
- **Callback URL (for Meta):** `https://<your-domain>/api/whatsapp/webhook`

There is only ever **one** app link. Every client logs in at the same place and
sees only their own data. You never issue a per-client URL.

---

## 3. Which path is this client on?

Ask one question on the sales call: **"Are you already sending WhatsApp messages
through software, or only through the WhatsApp app on a phone?"**

- **"Through software"** → Path A. They likely have everything. Go to §4.
- **"On a phone"** or **"not at all"** → Path B. Nothing exists yet. Go to §5,
  then §4.

Getting this wrong is the single most common way an onboarding call overruns.
Path B is not a 45-minute call.

---

## 4. Path A — the client already has WhatsApp API set up

**Time:** 45 minutes, one call, screen shared.

### Before the call
- Confirm they can log into their Meta Business Portfolio as an admin. If the
  person on the call isn't an admin, the call will stall halfway. Check first.
- Generate a verify token (any long random string) and keep it handy.

### On the call

1. **Create their wacrm account.** They sign up at your app link, confirm their
   email, and log in.

2. **Collect the four items** (§1). Have them read them off their screen. Do not
   accept these over email or chat in advance — half the time the wrong value
   gets copied, and it's faster to watch them do it.

3. **Paste them into wacrm** — Settings → WhatsApp connection. Save.

4. **Set up the callback URL on their side.** Meta for Developers → their app →
   WhatsApp → Configuration:
   - Callback URL: `https://<your-domain>/api/whatsapp/webhook`
   - Verify token: the one you generated in step 3
   - Click Verify and Save. It should confirm immediately.

5. **Subscribe to the right events.** On the same page, tick:
   - `messages` — without this, nothing arrives. Ever.
   - `message_template_status_update` — without this, template approvals and
     rejections never show up in wacrm.

6. **Smoke test.** Send a WhatsApp message from your own phone to their business
   number. It must appear in their wacrm inbox within a few seconds. Then have
   them reply from wacrm and confirm it arrives on your phone.

   **Onboarding is not complete until both directions work.** Everything before
   this step can look perfect while the connection is dead.

7. **Now do the enjoyable part.** Show them the inbox, invite their team members,
   set up their first automation, import their contacts. This is what they're
   actually paying for — leave time for it and don't let the plumbing eat the
   whole call.

### After the call
- **Day 3 check-in.** Confirm messages are still flowing.
- **Day 14 check-in.** Same.

These aren't courtesy calls. You have no alerting for a broken connection, and a
dead inbox looks exactly like a quiet week. The client will not report it — they
will assume business is slow, then churn.

---

## 5. Path B — the client has nothing set up

**Time:** 1–2 hours of your time, plus several days of waiting on Meta. Schedule
it as its own session, days before the wacrm onboarding.

This is the path most small businesses are on. Price and schedule accordingly —
it is the bulk of the real work.

### The order of operations

1. **Business Portfolio.** They create one at `business.facebook.com` if they
   don't have one, using the company's legal details.

2. **Create the app.** At `developers.facebook.com` → Create App → choose the
   Business type → add the **WhatsApp** product → link it to the Business
   Portfolio from step 1.

3. **Add their phone number.** In WhatsApp → API Setup.

   **⚠️ The number must not currently be in use on the WhatsApp app or the
   WhatsApp Business app.** If it is, they have to delete that WhatsApp account
   first — **and doing so permanently loses their existing chat history.**

   Raise this early, in the sales conversation, not on the setup call. It is the
   most common deal-breaker, and discovering it mid-call kills the momentum. The
   usual answer is a fresh number or a spare line.

4. **Choose and submit a display name.** This is the name customers see. Meta
   reviews it and can reject names that don't match the business. Submit early —
   waiting on this blocks nothing else, but a rejection late is painful.

5. **Create a System User.** Business Settings → Users → System Users → add one
   with **Admin** role. Assign it both assets — the **app** and the **WhatsApp
   Account** — with full control.

6. **Generate the permanent token.** From the System User, generate a token with
   `whatsapp_business_messaging` and `whatsapp_business_management` permissions
   and **no expiry**.

   Copy it immediately. Meta shows it exactly once and never again.

7. **Grab the App Secret.** App Settings → Basic → App Secret → *Show*. It
   already exists — it was created with the app. Nothing to generate.

8. **Business verification.** Meta verifies the business is real, using
   registration documents. **This takes days and is outside your control.** Start
   it as early as possible. Until it completes, the account is limited in how
   many people it can message.

9. **Payment method.** Added to their WhatsApp account, in their name. Meta
   charges them directly for conversations. You stay out of the billing path —
   this is deliberate and worth saying out loud to the client, because it's
   reassuring.

Once steps 1–7 are done, you have the four items. Go to §4.

### Setting expectations with a Path B client

Say this on the sales call, plainly:

> "Getting your WhatsApp connected to Meta takes about a week, mostly waiting on
> their approvals. I'll do the setup with you in one session. Once it's live,
> you're up and running the same day."

Underpromising here costs you nothing. Overpromising means the first week of the
relationship is you apologising for Meta.

---

## 6. Pilot mode — testing with a friendly number

For a pilot that only needs to prove messages arrive, you can skip most of §5:

- Meta provides a **free test number** with every new app. It can only message
  up to five pre-approved recipients, but it needs no business verification, no
  payment method, and no display name approval.
- A friendly volunteer with an existing setup works too, as long as they
  understand you'll be holding their credentials temporarily.

A pilot proves the *product* works: signup, login, inbox, message delivery, data
separation between accounts. It does **not** prove your onboarding process works,
because the pilot skips business verification, display name approval, and the
number-already-in-use problem — the three things that actually cause pain with
real clients. Don't read a smooth pilot as a validated process.

---

## 7. Trade-offs — the decisions behind this runbook

These are the choices that shape the process above. Each has a cost that shows up
later rather than now.

### 7.1 The client owns their WhatsApp account, not you

**Chosen.** The client's Business Portfolio owns the WhatsApp account and the app.
You hold credentials to operate it on their behalf.

The alternative — you create everything under your own business, so the client
touches Meta not at all — is dramatically easier to onboard. Path B would
disappear entirely.

**Why we're not doing it:** you would own your clients' WhatsApp presence. When
Embedded Signup arrives, it links accounts the client already owns — so every
client onboarded the easy way would need an ownership transfer, which is a
project per client, not a click. It also makes leaving you difficult, which reads
as a trap to a sophisticated buyer and is a hard conversation with everyone else.

**What it costs now:** Path B exists, and it's 1–2 hours plus days of waiting per
client.

### 7.2 Only one client can receive messages at a time — for now

**Current state.** The app can only recognise one client's "seal" — the App
Secret that proves incoming messages are genuine — at a time. With more than one
client connected, only one of them receives messages. The others get an inbox
that is silently, permanently empty.

**Impact:** this caps you at exactly one live client. It must be fixed before the
first paying one.

**Fix:** roughly half a day of work. No visible change to you or the client;
after it, every client's messages arrive simultaneously. This is planned, not
optional.

**Pilot workaround only:** point the app at the pilot client's App Secret for the
duration of the test. Your own number stops receiving during that window —
messages sent to it are dropped and won't appear afterwards. Acceptable for a few
hours on a dev setup. Not acceptable with anyone paying you.

### 7.3 Manual onboarding now, Embedded Signup later

**Chosen.** Ship with manual onboarding rather than waiting on Meta's app review,
which is slow and unpredictable.

**The cost:** every manually onboarded client is migration debt. When Embedded
Signup goes live, each will need to reconnect through the new flow. Because the
client owns their account (§7.1), that's a short guided session rather than a
rebuild — but it's a session per client, and it's on you to initiate.

**Recommendation:** decide a cap now — say ten clients — at which you stop manual
onboarding and wait for Embedded Signup. Without a number written down, the
manual phase extends by default and the debt compounds quietly.

### 7.4 You are the support desk

Every connection you set up by hand is one you'll be called about. There is
currently no monitoring that tells you a client's messages have stopped arriving,
and the client won't tell you either — a dead inbox is indistinguishable from a
slow week.

The day 3 / day 14 check-ins in §4 are the cheap version of monitoring. Proper
alerting is worth building before client five.

### 7.5 You hold clients' credentials

The permanent token and App Secret let you operate their WhatsApp account. Stored
encrypted, but you are nonetheless the custodian.

Put it in writing — what you hold, what you use it for, and that they can revoke
it at any time by deleting the System User. Say it before they ask. A client who
discovers this later feels differently about it than one who was told up front.

---

## 8. When something doesn't work

Symptoms, in plain language, with the usual cause.

| What you see | Almost always means |
|---|---|
| Inbox stays empty, but sending works | Callback URL wrong, or the `messages` event not ticked. Check §4 steps 4–5 first. |
| Meta refuses to verify the callback URL | The app isn't running, the address is wrong, or the verify token doesn't match exactly. Watch for trailing spaces on paste. |
| Was working, now silent | The token was revoked, the System User was deleted, or — on ngrok — the tunnel restarted. |
| Sending fails, receiving works | Token problem, or their payment method is missing or declined on Meta's side. Get the error **code** before guessing — the app logs it as `[whatsapp] message … FAILED — code=…`. The two seen in practice are below. |
| Sending fails with `131005 Access denied` | The access token came from Meta's **API Setup** page. Those are temporary 24-hour User tokens and lack the permissions needed to send. Replace it with a **System User** token from Business Settings, as §4 step 3 says. Symptom appears immediately on a new connection, or overnight on one that worked yesterday. |
| Sending fails with `131031 Business account locked` | Meta has suspended the client's WhatsApp Business Account. Nothing on our side can fix it and no credential change will help — receiving keeps working, which makes it look like a partial outage. Send them to Meta Business Suite → **Account Quality** to see the restriction and request review. |
| Template approvals never appear | `message_template_status_update` not ticked. |
| Client can't sign up | Email confirmation link points at the wrong address — a deployment setting, not their problem. |

Rule of thumb: **receiving broken → look at the callback URL and event
subscriptions. Sending broken → look at the token and their Meta billing.** They
are two independent paths and almost never fail together.

---

## 9. Quick checklist

Print this. One per client.

```
Client: ______________________  Date: __________

PRE
[ ] Path A or Path B identified
[ ] Person on the call is a Business Portfolio admin
[ ] Phone number confirmed NOT in use on WhatsApp app  (Path B)
[ ] Business verification started                       (Path B)
[ ] Display name submitted                              (Path B)
[ ] Verify token generated by me

COLLECT
[ ] WABA ID
[ ] Phone Number ID
[ ] Permanent access token
[ ] App Secret

CONFIGURE
[ ] wacrm account created, client logged in
[ ] Four items saved in wacrm settings
[ ] Callback URL + verify token saved in Meta, verified
[ ] Subscribed: messages
[ ] Subscribed: message_template_status_update

PROVE
[ ] Inbound test message appears in their inbox
[ ] Outbound reply arrives on my phone

HANDOVER
[ ] Team members invited
[ ] First automation set up
[ ] Credential-handling explained
[ ] Day 3 check-in scheduled
[ ] Day 14 check-in scheduled
```
