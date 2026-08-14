# wacrm — Sales Team FAQ & Product Notes

*Internal reference for the sales team. Plain-language answers to the
questions that come up most, plus the build decisions and dependencies
behind each. "wacrm" is the working codename — see item 7 on renaming.*

**What wacrm is, in one line:** a WhatsApp-based CRM — a shared team
inbox for the official WhatsApp Business number, plus contacts, sales
pipelines, broadcasts, automation, and an AI reply assistant. It runs as
a website (like Gmail or Notion), so anyone we give a login to can use it
from any browser.

**How to read the effort estimates:** unless noted, ranges assume **one
capable developer** (optionally paired with our AI assistant writing
code under that developer's review, which compresses the coding time).
These are *build* estimates only — they do not include Meta/WhatsApp
approvals, hosting setup, testing, or ongoing support, which are real and
separate.

---

## 1. What are "automations" and "flows"?

Both make WhatsApp do things automatically, without a human. They
overlap, which is why we have two names.

**Automations** = simple "if this, then that" rules. Example: *if a
customer messages the word "PRICING", automatically tag them as a lead
and send the price list.* One trigger, one or more actions. Good for
quick, one-shot reactions.

**Flows** = full guided conversations — a visual flowchart with branches,
buttons, and waiting. Example: *send a menu with three buttons → if they
tap "Book", ask for a date → wait for their reply → confirm.* It
remembers where each customer is in the journey. Think of the "press 1
for sales" phone menus, but on WhatsApp and drag-and-drop to build.
(Flows is still labelled "Beta" in the app.)

**Rule of thumb:** automations = quick reflexes; flows = conversations.
For anything multi-step like booking, a flow is the right tool.

---

## 2. The business model

wacrm is a **template** (open-source, MIT-licensed) that we forked to
adopt. There are two very different ways to run it, and they are
different-sized commitments:

**Model A — one CRM for one business.** Fork it, connect one WhatsApp
number, deploy. An afternoon of setup. This is what the template is
built for.

**Model B — a product we host and sell to many clients (our model).**
One system we operate, serving many client businesses, each isolated from
the others — the Notion model. The technical foundation for this already
exists (see item 3). What's missing is the commercial wrapper: billing,
pricing tiers, controlled onboarding, and ongoing operations. That's
custom work on top, and it turns "software" into "a service business we
run."

**The honest framing for prospects:** we are selling a hosted WhatsApp
CRM where each client gets their own private workspace, their own team
logins, and connects their own WhatsApp/Meta account. We operate the
platform; they own their data and their conversations.

**Key decision on record:** start lean. Launch with manual billing and a
small set of tiers rather than building a full automated billing engine
first (see item 5).

---

## 3. "Host it and give each client their own login" (Notion-style)

**Yes — this is genuinely supported today at the data level.** The system
is *multi-tenant*: one installation serves many client businesses, and
each client only ever sees their own data. The isolation is enforced in
the database, not just hidden on screen.

**How it works for a client:** the client signs up, gets their own
private workspace ("account"), connects *their own* Facebook/Meta
developer setup and WhatsApp number, invites their team, and never sees
any other client's data. Exactly like creating a workspace in Notion.

**Each client brings their own:** Facebook developer account, business
portfolio, business verification, and WhatsApp number. Every workspace
plugs in its own credentials — that is supported.

**What's still needed to turn this into a sellable service:**

- **Close public signup / controlled onboarding.** Right now anyone who
  finds the URL can create a workspace. We'd gate this to invite-only or
  add an approval step. *Effort: ~1–3 days.*
- **Billing.** Nothing charges anyone yet (see item 5).
- **We become the operator** — uptime, backups, security, updates,
  support. This is the part people underestimate; it's ongoing, not a
  one-time build.

### Dependencies needed to build Model B

- **Hosting for the app** — a managed Node.js host (e.g. Hostinger, which
  the template is tuned for; or Vercel/Railway). Gives us a public domain
  + automatic SSL.
- **Database** — a Supabase project (Postgres + Auth + Storage). Free
  tier to start; paid as clients grow.
- **A public domain per environment** with HTTPS (required — Meta's
  webhook won't talk to anything without valid SSL).
- **A Meta / WhatsApp Business setup** — note each *client* supplies their
  own; we mainly need our own for testing.
- **(For controlled onboarding)** a small amount of custom development on
  top of the existing auth + invitations system — no new third-party
  service required.

**One rule to know:** one person's login belongs to exactly one client
workspace. Fine for our model (each client is a separate business); it
only matters if one human needed to belong to two client orgs at once.

---

## 4. Why each team member needs their own login, and how they're invited

**Each team member gets their own personal login (email + password).**
This is by design — it's more secure, and it lets the business see who
did what.

**They're added by invitation, not created by hand.** The client's owner
or admin sends an **invite link**. The teammate clicks it, creates their
own login, and is automatically joined to that client's workspace with
whatever role was chosen. Exactly like adding someone to a Notion
workspace.

**How members stay tied to the right business:** the invite link already
has the client's workspace baked into it (stored safely as a scrambled
fingerprint, unreadable even if the database leaked). So Client A's staff
came through Client A's links and are bound to Client A; Client B's staff
to Client B. Two staff from different clients can be logged in at the same
second and each only sees their own company.

**Guardrails built in:** invite links expire (default 7 days) and are
one-time use, so a forwarded old link can't leak a stranger into a
client's workspace.

---

## 5. Limiting features per pricing tier

**Example the client wants:** $30/mo = inbox + notifications + up to
1,000 AI replies; $60/mo = more features shown in the left menu; hide the
Dashboard for tiers that don't need it.

**Status: not built in — this is custom work.** Today the left-side menu
is a fixed list shown to everyone, and there's no concept of "plans"
anywhere. There's no switch to flip. To get tiered pricing we'd build
three things (all standard, low-risk work — nothing experimental):

1. **A "plan" setting per workspace** — which tier a client is on.
   *Effort: ~2–3 days.*
2. **Feature-gating** — show/hide each menu item (Dashboard, Broadcasts,
   Flows, etc.) based on the plan. Hiding Dashboard is a simple version of
   this. *Effort: ~2–4 days.*
3. **Usage limits** — e.g. stop AI replies at 1,000. Helped by the fact
   that AI usage is *already counted* in the system, so we're adding a cap
   on top, not building the meter from scratch. *Effort: ~2–4 days.*

### Dependencies

- **For plans, gating, and caps:** no new third-party service — it's
  development on top of the existing account and usage-tracking systems.
- **For actual automated billing** (charging cards, auto-cutoff on
  non-payment): a payment provider — **Stripe** is the standard choice.
  *Effort: 1–3 weeks.*

**Key decision on record:** start with **manual billing** — invoice
clients or send a Stripe payment link, and set their plan by hand.
*Effort: ~2 days.* This lets us launch tiers quickly and add automated
billing later once we have paying customers.

---

## 6. Connecting wacrm to n8n

**Purpose:** let the AI answer chats, and when needed trigger a real
workflow in n8n — e.g. a booking (check availability → hold the slot →
take payment → confirm).

**How it works — two "doors" between the systems:**

- **Door out (wacrm → n8n):** wacrm's automations and flows include a
  "webhook" action, which means "call this URL." We paste an n8n workflow
  URL there. So when the AI/flow decides a customer wants to book, it
  pings n8n with the details.
- **Door in (n8n → wacrm):** wacrm has a public API secured by API keys
  (Settings → API keys). After n8n does the real work, it calls back into
  wacrm to send the customer a WhatsApp confirmation, update a contact,
  move a deal, etc.

**Booking example, end to end:**
1. Customer messages "I want to book." The AI recognises the intent.
2. wacrm pings n8n (door out).
3. n8n runs the workflow — availability, hold, payment, confirm.
4. n8n calls wacrm back (door in) to send the WhatsApp confirmation and
   move the deal along the pipeline.

**Effort & dependencies:**
- The **wacrm side is small** (~2–5 days) because both doors already
  exist. The real time is building the **workflows inside n8n**, which is
  separate and depends on how complex the booking logic is.
- **Dependency:** an n8n instance (self-hosted or n8n cloud) with its own
  public URL.
- **Two honest caveats:** (a) wacrm's *automatic* outbound pings currently
  cover only three events (message received, message status changed,
  conversation opened); for richer triggers like "AI detected a booking",
  put the webhook step *inside a flow/automation* we build. (b) The AI
  replies with text; it doesn't natively "call tools" — so the pattern is
  AI handles the chat, and a flow fires the n8n webhook at the booking
  point.

---

## 7. Changing the name (rebrand)

**Yes — the license allows it, and it's one of the easier changes.**

**The visible brand (do this — quick, low-risk):**
- Browser tab title, all on-screen text (in the app's language files),
  the logo and favicon (image files), and optionally the brand colours.
- *Effort: ~half a day including a logo swap.* We supply the logo/icon
  images; the developer swaps text and files.

**The internal name (leave it alone):** the codename also appears deep in
the code (package name, behind-the-scenes labels). None of it is visible
to clients, and changing it adds risk with no benefit. We only rebrand the
surface.

**Legal footnote:** because it's MIT-licensed, we can rename, brand, and
sell it. The only obligation is keeping the original author's license
notice inside the *source code* (a `LICENSE` file) — not shown to clients
and no barrier to presenting the product as fully ours.

---

## 8. Making it feel like a native app on a phone

The app is a website, so it already works in any phone browser. To make it
*feel* like a real app, there are three levels — we almost certainly want
the cheapest.

**Level 1 — "PWA" basics (the half-day polish).** Give the website a few
extra files so phones treat it like an installed app: own icon, opens
fullscreen (no browser address bar), splash screen.
- **Requirements:** a small "manifest" config file (the framework supports
  this natively — **no new dependencies**) + a set of **app icons** in a
  few sizes (a design asset — our logo exported at 192px, 512px, etc.).
- *Effort: ~half a day.*

**Level 2 — PWA + push notifications (the genuinely useful upgrade).**
Buzz the phone when a new message arrives, so the owner/agent doesn't have
to keep checking.
- **Dependency:** a service-worker library — standard options are
  **Serwist** (`@serwist/next`) or **next-pwa** (`@ducanh2912/next-pwa`).
- Works on iPhone too (iOS 16.4+), *if* the user first adds it to their
  home screen. *Effort: ~2–4 days.*

**Level 3 — a real app-store app (probably overkill).**
- **Dependencies:** **Capacitor** (`@capacitor/core`, `@capacitor/ios`,
  `@capacitor/android`) to wrap the existing web app; plus an **Apple
  Developer account** ($99/yr) and **Google Play account** ($25 one-time),
  and the Xcode/Android Studio build toolchains.
- Overhead: app-store review on every release, ongoing maintenance.
- *Effort: 1–3 weeks + permanent upkeep.*

**Key decision on record:** do **Level 1** for the app-like feel; add
**Level 2** if push notifications are wanted. **Skip Level 3** unless being
in the app stores is a business goal in itself. *Caveat: iPhones are
pickier than Android about PWAs — expect Android to be smoother.*

---

## 9. Main account vs. team member accounts — features & differences

**Important clarification:** there aren't two *types* of accounts. There's
**one workspace per business**, and everyone logs in with their own
personal login. The difference is the **role** each person is given.
"Main account" = the **owner**; "team members" = invited people with
assigned roles.

**Yes, team members get less access — and the owner decides how much.**
There are four levels:

| Can they… | Owner | Admin | Agent | Viewer |
|---|:---:|:---:|:---:|:---:|
| See everything (inbox, contacts, deals) | ✅ | ✅ | ✅ | ✅ |
| Reply to messages, add contacts, move deals, run broadcasts, edit automations | ✅ | ✅ | ✅ | ❌ (read-only) |
| Change account-wide settings (WhatsApp connection, templates, pipelines, tags) | ✅ | ✅ | ❌ | ❌ |
| Invite / remove people, change their roles | ✅ | ✅ | ❌ | ❌ |
| Delete the whole workspace | ✅ | ❌ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ |

**Plain-English roles:**
- **Owner** — the person who created the workspace. Everything, plus two
  exclusive powers: delete the workspace, and transfer ownership. One
  owner at a time.
- **Admin** — trusted deputy. Runs day-to-day *and* manages the team and
  settings. Can't do the two owner-only actions above.
- **Agent** — front-line staff. Handles conversations: replies, adds
  contacts, moves deals, sends broadcasts. Can't change setup or the team.
  This is the role for most staff.
- **Viewer** — read-only. Sees everything, changes nothing. Ideal for an
  owner who just wants to *watch what the agents are saying*.

**Common questions:**
- **Can permissions be changed in the app?** Yes — **Settings → Members**.
  An admin or owner can change anyone's role live (no developer needed).
- **Can a team member reply instead of the agent?** Yes — that's the point
  of a *shared* inbox. Anyone at agent level or above can reply; multiple
  people can staff the same number at once. Only viewers can't reply.
- **Can the owner make someone an admin?** Yes — Settings → Members, change
  their role to admin. Guardrails: only admin/owner can change roles;
  nobody can change the owner's role or their own; becoming owner requires
  the separate "transfer ownership" action.

---

## Quick reference — build decisions & effort

| Item | Status | Effort | Decision |
|---|---|---|---|
| Rebrand (surface) | Custom | ~0.5 day | Do it; supply logo |
| Controlled onboarding | Custom | ~1–3 days | Needed for Model B |
| Plan setting per client | Custom | ~2–3 days | Phase 1 |
| Feature-gating (hide menu items) | Custom | ~2–4 days | Phase 1 |
| AI usage caps | Custom (counting exists) | ~2–4 days | Phase 1 |
| Manual billing | Custom | ~2 days | **Start here** |
| Automated billing (Stripe) | Custom | 1–3 weeks | Phase 2 |
| n8n integration (wacrm side) | Config + small build | ~2–5 days | As needed |
| Native-app feel (PWA L1) | Custom | ~0.5 day | Do it |
| Push notifications (PWA L2) | Custom | ~2–4 days | If wanted |
| App-store app (L3) | Custom | 1–3 wks + upkeep | Skip unless strategic |
| Live voice agent | Separate project | Weeks–months, gated | Not v1 |

*A sellable tiered MVP — rebranded, controlled onboarding, plans, gating,
caps, manual billing, one n8n booking flow — is realistically ~2–3 weeks
of calendar time with an AI-assisted developer, or ~4–6 weeks solo. Voice
and automated billing are deliberate Phase 2.*
