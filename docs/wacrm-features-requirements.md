# wacrm (Model B) — Features & Requirements

*Product requirements reference for the hosted, multi-client WhatsApp CRM.
"wacrm" is the working codename — rebrand is a Phase 1 item.*

**Document order:** Overview → Business model & decisions → Feature
inventory (Have → Phase 1 build → **Platform & Operations** → Phase 2) →
**WhatsApp / Meta onboarding (detailed)** → Constraints → Effort summary →
Open decisions.

---

## 1. Purpose & scope

We are adopting an open-source WhatsApp CRM template ("wacrm", MIT-licensed)
and turning it into a **hosted product we sell to many client businesses**
(Model B). We operate one platform; each client gets a private, isolated
workspace, their own team logins, and connects their own WhatsApp/Meta
account. Clients see only the product interface — never the source code,
the database, or any n8n automations behind it (the Gmail / Google Docs
model).

This document lists what the product already does, what we must build, and
the platform and Meta requirements to run it.

---

## 2. Product overview

wacrm is a WhatsApp-based CRM built on Next.js + Supabase, using the
official WhatsApp Business (Meta Cloud) API. It runs as a website, so any
authorised user reaches it from a browser on mobile, tablet, or desktop.
Core capability: a **shared team inbox** for one WhatsApp number, plus
contacts, sales pipelines, broadcasts, no-code automation, and an AI reply
assistant — all multi-tenant and role-based.

---

## 3. Business model (Model B) & key decisions

**What we sell:** a hosted WhatsApp CRM. Each client business = one private
workspace ("account"). Example: *Laione* gets Account 1, *Cladens* gets
Account 2. We give the business owner their login; the owner invites their
team via a link that only ever adds people to *that* account. Every person
has their own login credentials. No client can see another client's data,
the source code, or our automations.

**Decisions on record:**

| # | Decision |
|---|---|
| D1 | Build for **Model B** (hosted multi-client), not single-tenant. |
| D2 | **Native-app feel:** Phase 1 = PWA Level 1; Level 2 (push) = Phase 2 roadmap. |
| D3 | **Billing:** start **manual** (invoice / payment link, set plan by hand); automated (Stripe) is Phase 2. |
| D4 | **WhatsApp onboarding:** start **manual credential collection** for pilots; **Embedded Signup + Meta Tech Provider** is Phase 2 (see §5). |
| D5 | **AI provider:** support **OpenRouter** alongside the existing OpenAI/Anthropic options. |
| D6 | **Rebrand** the surface (name, logo, colours) in Phase 1; leave internal code names untouched. |

---

## 4. Feature inventory

### A. Already have (out of the box — the core product)

These exist and work today; no build required beyond configuration.

| Ref | Feature | Notes |
|---|---|---|
| H1 | Shared team inbox | Multiple agents, one number, real-time updates, assignment, notes |
| H2 | Contacts, tags, custom fields | CSV import, phone deduplication |
| H3 | Sales pipelines (Kanban) | Deals linked to conversations |
| H4 | Broadcasts | Approved templates, delivery/read tracking, per-recipient variables |
| H5 | Automations | Simple "if this, then that" rules |
| H6 | Flows | Visual conversation builder (labelled Beta) |
| H7 | AI reply assistant | BYO key, one-click drafts, auto-reply bot, knowledge base, human handoff |
| H8 | AI usage tracking | Token/reply usage **already counted** (foundation for caps) |
| H9 | Multi-tenancy | Every client workspace isolated at the database level (row-level security) |
| H10 | Team roles | Owner / admin / agent / viewer; invite-by-link; ownership transfer |
| H11 | Public REST API + API keys | Scoped, revocable — the "door in" for n8n |
| H12 | Outbound webhooks | 3 events (message received, status changed, conversation opened) — the "door out" |
| H13 | MCP server | Drive the CRM from AI assistants |
| H14 | Security primitives | Encrypted tokens, RLS, signed webhooks, SSRF guard, rate limiting |
| H15 | Voice messages | Send/receive as media in the inbox |
| H16 | Click-to-WhatsApp inbound | Any wa.me link / QR / ad message lands in the inbox automatically |
| H17 | Notifications + analytics dashboard | Real-time activity, response times, volume, pipeline value |
| H18 | Inbound routing by phone number | Webhook already routes each message to the right account by phone-number-id (key for multi-client) |

### B. Phase 1 — build for the sellable MVP

Requirements to build. Effort assumes one capable developer (AI-assisted,
human-reviewed).

| Ref | Requirement | Description | Effort |
|---|---|---|---|
| P1-1 | **Rebrand (surface)** | Replace app name and on-screen text, swap logo + favicon, optional brand colours. Internal code names left as-is. Client supplies logo/icon assets. | ~0.5 day |
| P1-2 | **Controlled onboarding** | Close public self-signup. New client workspaces created only by us (admin action) or by approval. Existing invite system for teammates stays. | ~1–3 days |
| P1-3 | **Plan setting per workspace** | Store which tier a client is on; an internal screen for us to set/change it. | ~2–3 days |
| P1-4 | **Feature-gating** | Show/hide sidebar items and features per tier (e.g. hide Dashboard on the $30 tier; unlock more on $60). Driven by the plan setting (P1-3). | ~2–4 days |
| P1-5 | **AI usage cap enforcement** | Enforce a per-tier cap (e.g. stop at 1,000 AI replies); usage is already counted, so this adds the limit + a clear "limit reached" state. | ~2–4 days |
| P1-6 | **Manual billing process** | No card processing yet: invoice or send a payment link, then set the plan by hand (P1-3). Define the SOP. | ~2 days |
| P1-7 | **PWA Level 1 (native feel)** | Add a web-app manifest + app icons so the site installs to the home screen, opens fullscreen with its own icon/splash. No new dependencies. | ~0.5 day |
| P1-8 | **OpenRouter AI provider** | Add OpenRouter as a provider option alongside OpenAI/Anthropic (OpenRouter is OpenAI-API-compatible, so a small addition). | ~1–2 days |
| P1-9 | **n8n integration wiring** | Configure the outbound webhook / flow "webhook" step to call n8n, and use the public API for n8n → wacrm callbacks (e.g. booking confirmation). wacrm side is small; n8n workflows are separate effort. | ~2–5 days (wacrm side) |
| P1-10 | **Manual WhatsApp onboarding** | Per-client credential collection + entry into their workspace config (see §5.A). Works today; needs an SOP and light UI/QA. | ~1–2 days + process |

### C. Platform & operations (required to run Model B)

Not product features, but mandatory to operate the service. These come
**before** Phase 2.

| Ref | Requirement | Description |
|---|---|---|
| OPS-1 | **Hosting** | Managed Node.js host with a public domain and automatic SSL (e.g. Hostinger, Vercel, Railway). HTTPS is mandatory for the Meta webhook. |
| OPS-2 | **Database** | A Supabase project (Postgres + Auth + Storage). Sized/upgraded as clients grow. |
| OPS-3 | **Domain & DNS** | Production domain (and staging), managed DNS, valid SSL certificates. |
| OPS-4 | **Environment & secrets management** | Secure storage for platform secrets (encryption key, Meta app secret, Supabase service key). No secrets in source. |
| OPS-5 | **Backups & recovery** | Regular database backups and a tested restore procedure. |
| OPS-6 | **Monitoring & logging** | Uptime monitoring, error logging, webhook delivery visibility. |
| OPS-7 | **Client support process** | Onboarding checklist, support channel, and an internal admin routine for creating/suspending workspaces and setting plans. |
| OPS-8 | **Meta business verification** | Our own verified Meta Business (prerequisite for both manual scaling and Tech Provider — see §5). |
| OPS-9 | **Data & privacy posture** | Terms, privacy policy, data-processing stance (we host client conversations — set expectations and retention). |
| OPS-10 | **Update/patch routine** | Process for applying template updates and database migrations safely without disrupting clients. |

### D. Phase 2 — roadmap (after MVP + operations are stable)

| Ref | Requirement | Description | Effort |
|---|---|---|---|
| P2-1 | **Automated billing** | Stripe integration: card charging, subscriptions, automatic cut-off / downgrade on non-payment. | 1–3 weeks |
| P2-2 | **Embedded Signup + Meta Tech Provider** | Self-serve client WhatsApp onboarding via Meta's hosted popup; no manual token handling (see §5.B). Includes Meta app review + Tech Provider approval. | 2–4 weeks build + Meta approval lead time |
| P2-3 | **PWA Level 2 (push notifications)** | Buzz the phone on new messages. Adds a service-worker library (Serwist or next-pwa). Works on iOS 16.4+ once installed to home screen. | ~2–4 days |
| P2-4 | **Voice agent in front of the inbox** | A voice agent answers calls, then passes a message/summary into the inbox for a human agent to pick up or to trigger an n8n event. Separate voice platform; wacrm receives via the public API. | Separate project (weeks); gated by Meta calling access |
| P2-5 | **Click-to-WhatsApp ad attribution** | Capture *which ad* a lead came from (the ad-referral tag) and store it on the conversation. | ~1–2 days |

---

## 5. WhatsApp / Meta onboarding — detailed

This is the single most important platform decision for Model B: **how each
client's WhatsApp number gets connected to our hosted app.** There are two
models. We will use the manual model for pilots and move to the Tech
Provider model to scale. Both are explained in full below.

### Background: how a WhatsApp Business API connection is made up

To send/receive on the official API, four Meta assets must exist and be
linked:

1. **Meta Business Portfolio** (formerly Business Manager) — the top-level
   business container.
2. **WhatsApp Business Account (WABA)** — lives under the portfolio; holds
   phone numbers and message templates.
3. **Phone number** — registered to the WABA, identified by a **Phone
   Number ID**. This is the number customers message.
4. **A Meta app** — the technical app that holds the API permissions and
   receives the **webhook** (inbound messages). The app has an **App
   Secret** used to verify that webhooks genuinely come from Meta.

Access to send/receive is granted by an **access token**. Whose app and
whose token are used is exactly what differs between the two models below.

> **wacrm foundation that helps:** the app already routes every inbound
> webhook to the correct client account by **Phone Number ID** (ref H18).
> This is precisely the mechanism a single-app, many-clients setup needs —
> so the plumbing for both models is already in place.

---

### 5.A — Manual onboarding (Phase 1: pilots)

**How it works:** the client sets up (or already has) their own Meta
Business, WABA, and phone number. They generate a long-lived access token
and share their identifiers with us. We paste those into their workspace
configuration. From then on, their number runs inside their wacrm
workspace.

**Per-client information we collect and enter:**

| Item | What it is |
|---|---|
| Business Portfolio ID | The client's Meta business container |
| WABA ID | The client's WhatsApp Business Account |
| Phone Number ID | The specific number that receives messages |
| Permanent access token | A **System User** token (does not expire like a temporary user token) authorising API calls |
| Display phone number | For reference/verification |

**Webhook (platform-level, set once):** in the manual model the simplest
setup registers client numbers under **our** Meta app, so all inbound
webhooks arrive at our single endpoint and are routed by Phone Number ID
(H18). Our app's **App Secret** and a **verify token** are configured once
at the platform level.

**Requirements / steps (manual model):**

1. **R-M1** — The client creates a Meta Business Portfolio and completes
   **business verification** (Meta requirement for production messaging).
2. **R-M2** — The client creates a WABA and registers their phone number
   (a new number, or migrates an existing one; coexistence with the
   WhatsApp Business app is possible since May 2025 if they want to keep
   using the phone app too).
3. **R-M3** — The client generates a **permanent System User access token**
   with the WhatsApp permissions and shares it plus the IDs above with us
   securely.
4. **R-M4** — We enter the credentials into the client's workspace and
   subscribe their number to our webhook.
5. **R-M5** — Verify send + receive end to end; confirm templates can be
   submitted/approved.

**Pros:** works today, no Meta program approval needed, fast for a few
clients.
**Cons:** we handle client tokens (a security responsibility); tokens and
permissions need managing; onboarding is hands-on; **does not scale**
gracefully past a handful of clients.

---

### 5.B — Embedded Signup + Meta Tech Provider (Phase 2: scale)

**What it is:** Meta's official, OAuth-based self-serve onboarding. We
become an approved **Tech Provider**, and add the **Embedded Signup** flow
to our app. A client clicks "Connect WhatsApp," a **Meta-hosted popup**
opens, they log into Facebook, pick or create their WABA and number, and
approve access — all in one 5–15 minute flow. Their Facebook credentials
never touch us; the client **owns** their WABA and can revoke our access
anytime from Meta Business Suite. We receive delegated, scoped access to
operate on their behalf.

This is the correct model for a real SaaS: no manual token handling, faster
onboarding, better security, and clean provider-switching for the client.

**Requirements / steps (Tech Provider model):**

1. **R-T1 — Meta app (Tech Provider configuration).** Create/configure a
   Meta app with the WhatsApp product and Tech Provider settings.
2. **R-T2 — Meta Business verification.** Our own business must be verified
   (OPS-8).
3. **R-T3 — Request Advanced Access to the required permissions:**
   `whatsapp_business_management` and `whatsapp_business_messaging`
   (and `business_management` as needed).
4. **R-T4 — App Review.** Submit the app for Meta review of those
   permissions (expect a lead time of days to weeks; plan for iteration).
5. **R-T5 — Build the Embedded Signup flow** into wacrm: the Facebook JS
   SDK popup, then exchange the returned code for the client's access
   token on our server.
6. **R-T6 — Auto-subscribe the client's WABA** to our webhook and store the
   connection against their workspace (reuses the Phone-Number-ID routing,
   H18).
7. **R-T7 — Token & permission lifecycle** — handle refresh/rotation,
   revocation, and error states (client removed access, number moved).
8. **R-T8 — Build to Embedded Signup v4.** Older versions are being
   deprecated; **v2 is retired on Oct 15, 2026**, so target v4 from the
   start.
9. **R-T9 — Commerce Policy / template categorisation** flows are handled
   inside the official signup — verify they surface correctly to clients.

**Pros:** scales to many clients, no manual credentials, more secure,
client owns their assets, faster onboarding.
**Cons:** requires Meta approval (business verification, app review, Tech
Provider status) which takes time; a real build; a hard v4 deadline to
respect.

---

### 5.C — Recommendation

Run **7.A (manual)** for the first pilot clients (Laione, Cladens) to
launch without waiting on Meta approvals, and start the **7.B (Tech
Provider)** application and build in parallel, since the approval lead time
is the long pole. Cut over to Embedded Signup once approved — the
underlying app and routing don't change, only the onboarding front door
does.

---

## 6. Constraints & assumptions

- **Message-initiation window:** outside 24 hours from the customer's last
  message, WhatsApp only allows pre-approved **template** messages. So
  "wacrm starts the conversation" always means sending a template. (Point 2
  workaround.) Templates are supported (H4).
- **One login = one workspace:** a person's login belongs to exactly one
  client workspace. Fine for Model B (each client is a separate business).
- **HTTPS everywhere:** every integration (Meta webhook, n8n, public API)
  is an HTTPS call to a public URL; no piece can run on a private/local host.
- **Clients bring their own WhatsApp/Meta assets** and are responsible for
  their business verification.
- **n8n richer triggers:** wacrm's automatic outbound events are limited to
  three; for intent-based triggers (e.g. "booking detected"), put the
  webhook step inside a flow/automation we build. The AI replies with text
  and does not natively call tools.
- **iOS PWA caveats:** push (Phase 2) requires the user to add the app to
  their home screen first; Android is smoother than iPhone.
- **Effort estimates are build-only** — they exclude Meta approvals,
  hosting setup, testing, and ongoing support.

---

## 7. Effort summary

| Phase | Item | Effort |
|---|---|---|
| P1 | Rebrand (surface) | ~0.5 day |
| P1 | Controlled onboarding | ~1–3 days |
| P1 | Plan setting per workspace | ~2–3 days |
| P1 | Feature-gating | ~2–4 days |
| P1 | AI usage caps | ~2–4 days |
| P1 | Manual billing (process) | ~2 days |
| P1 | PWA Level 1 | ~0.5 day |
| P1 | OpenRouter provider | ~1–2 days |
| P1 | n8n wiring (wacrm side) | ~2–5 days |
| P1 | Manual WhatsApp onboarding | ~1–2 days + SOP |
| — | **Phase 1 MVP total** | **~2–3 weeks** (AI-assisted dev) / ~4–6 weeks solo |
| C | Platform & operations | Setup + ongoing (see §4C) |
| P2 | Automated billing (Stripe) | 1–3 weeks |
| P2 | Embedded Signup + Tech Provider | 2–4 weeks + Meta approval |
| P2 | PWA Level 2 (push) | ~2–4 days |
| P2 | Voice agent in front of inbox | Separate project, gated |
| P2 | Click-to-WhatsApp ad attribution | ~1–2 days |

---

## 8. Open decisions (to confirm)

1. **Tier definition** — exact features and limits per price point
   (e.g. $30 = inbox + notifications + 1,000 AI replies; $60 = + which
   modules; Dashboard hidden on which tiers).
2. **Rebrand name + brand assets** — final name, logo, favicon, colours.
3. **Hosting choice** — Hostinger vs Vercel vs other.
4. **Manual-billing tooling** — invoices vs Stripe payment links from day 1.
5. **Tech Provider timing** — when to start the Meta application (recommend:
   immediately, in parallel with Phase 1).
6. **Data retention & privacy terms** — how long we retain client
   conversation data; client-facing policy.
