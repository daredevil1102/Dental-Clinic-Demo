# claude-00 — Architecture overview (read this first)

- **Status:** Draft
- **Last updated:** 2026-08-10
- **Audience:** Claude Code, before implementing `claude-01` or `claude-02`.

Shared context for both build specs: the system, the invariants, the
environments, and how code reaches production.

### Precedence

| Set | Location | Authority |
| --- | --- | --- |
| Codex | `docs/architecture/` | **Governing.** Business decision, guardrails, release gates. `CODEX-ADR-001` is Accepted. |
| Claude (this set) | `docs/phase-1/claude-0*.md` | **Implementation.** The build plan Codex's index asks for at Review-order step 5. |

`claude-00`–`claude-03` implement `CODEX-ADR-001` and `CODEX-SDD-WA-001`, gated
by `CODEX-RAS-WA-001`. Where this set contradicts an approved Codex decision,
**Codex wins and this document is wrong** — raise it rather than coding around
it. Two Codex requirements are deliberately not adopted (§4, §7); both are
scale exceptions, not architectural disagreements.

### Document roles — settled, do not blur

| Document | Role |
| --- | --- |
| `TEST-PLAN.md` §5A.6 / §5B.8 | **The criteria define the output.** Canonical, approved, restated nowhere else. |
| `TEST-PLAN.md` (rest) | **How we prove it.** |
| `claude-00`–`claude-03` | **How to build it.** |
| `archive/rejected-alternatives.md` | What was considered and rejected. Not a build document. |
| `docs/architecture/` (codex set) | Governing business decision and release gates. |

Historical arguments and rejected designs belong in the archive, not in these
specs. Meta dashboard details may change without reopening the architecture, so
long as P1-11 criterion 12 is ultimately satisfied.

**Build P1-10 first, and do not revisit P1-11 design while doing so.**

**Read in this order:**

1. `claude-00-architecture-overview.md` — this file
2. `claude-01-P1-10-manual-onboarding.md` — ship first, goes to market
3. `claude-02-P1-11-embedded-signup.md` — built second, ships dark
4. `claude-03-meta-dashboard-checklist.md` — Manish's manual work in Meta; not code

---

## 1. What the system is

ConnectsWA is a single hosted multi-tenant WhatsApp CRM: Next.js + Supabase, one
deployment, one database, one domain. Every customer gets an **account**
(workspace). All tenant data is scoped by `account_id` with RLS.

The operating model is **hosted and hand-held**: Manish runs the deployment and
sets up each client's WhatsApp connection with them. Client counts are single
digits. Design for correctness and diagnosability, not for scale.

### The connection model — the central idea

Each account has **exactly one** row in `whatsapp_config`, enforced by
`UNIQUE(account_id)` (migration 017) and `UNIQUE(phone_number_id)`
(migration 013). One slot per account holding "how we reach this client's
WhatsApp."

Everything else — contacts, conversations, messages, automations, flows,
templates, team members — is keyed by `account_id` and **independent of that
slot**. So CRM history is structurally independent of how a client connects, and
no future connection change can ever require moving data. Preserve this: no
second active connection row, no credential snapshot table, no per-method
duplicate of tenant data.

That property is not a licence to build a connection-change feature now (§7).

### Two connection methods

| | `manual` (claude-01) | `embedded` (claude-02) |
| --- | --- | --- |
| Meta app | The **client's own** | The **ConnectsWA provider app** |
| Credentials | Client hands them over; we store them | Meta issues a token to us; client never sees one |
| Webhook signature verified with | That client's App Secret, per row | One deployment-wide provider App Secret |
| Callback URL | One shared URL for every manual client | A separate provider-only URL |
| Availability | Permanent — never remove it | After Meta App Review |

`manual` is permanent, not a stopgap: Meta test numbers cannot use Embedded
Signup, self-hosted installs have no approved app, and browsers block Facebook's
SDK often enough to matter.

---

## 2. Invariants — do not break these

1. **Tenancy.** Every read and write is scoped by `account_id`, and **a verified
   signature only authorises the workspace it authenticates**. A payload signed
   with one client's App Secret may never cause a write to another workspace —
   every manual client knows their own secret, so this is a real trust boundary,
   not a theoretical one (`claude-01` §4.1.2).

   > ⚠️ **False today; `claude-01` §4.4 fixes it.** `handleStatusUpdate`
   > (`webhook/route.ts:364`) updates `messages` by `.eq('message_id', …)` with
   > the service-role client, and `message_id` is not unique across numbers
   > (migration 009). `messages` has no `account_id` — it scopes through
   > `conversations.account_id`, `broadcast_recipients` through
   > `broadcasts.account_id`.

2. **One number, one account; one connection, one account.** Both unique
   constraints stay. **`waba_id` is nullable and has no constraint at all** — never
   a tenant key without an explicit single-row check (`claude-01` §4.1.1).
3. **Credentials encrypted at rest** with `src/lib/whatsapp/encryption.ts`. Never
   store plaintext, never log a token / App Secret / verify token / OAuth code,
   never return one in a response — not even ciphertext.

   > ⚠️ **Also false today; `claude-01` §6.2 fixes it.**
   > `whatsapp-config.tsx:107` does `select('*')` from the browser, so
   > credential ciphertext already reaches the client.

4. **Webhooks fail closed.** Secret, tenant or signature unresolvable → 401, no
   side effect.
5. **Never downgrade a live connection.** A retry or partial failure must not
   flip a working connection to `disconnected`.
6. **Manual behaviour remains unchanged.** Behaviour, not bytes — `claude-02`
   §5.4 does refactor the manual save path, so the code changes. The obligation
   is that observable behaviour doesn't and the claude-01 characterization tests
   still pass, amended only where a test asserted an internal call shape, never
   in the same commit as a behaviour change.
7. **Additive migrations only.** New nullable columns or columns with defaults.
   Old code must tolerate columns it doesn't know about; that is what makes
   staged deploys safe.
8. **A healthy manual client is never touched.** No prompt, banner, auto-open or
   overwrite of a workspace that already has a working connection
   (`CODEX-ADR-001` §Guardrails).

---

## 3. Repo conventions

- **This is a modified Next.js.** Per `AGENTS.md`, read the relevant guide in
  `node_modules/next/dist/docs/` before writing any Next-facing code (route
  handlers, `headers()`, script loading, metadata). Training-data assumptions
  about the App Router may be wrong here.
- **Branch naming:** `feat/<ref>-<slug>` off `phase-1`. `main` and the
  `baseline-pilot` tag stay frozen.
- **Nothing merges red:** `npm run typecheck && npm run lint && npm test && npm run build`.
- **Internationalised** (`messages/en.json`, `messages/ko.json`) — every new
  user-facing string needs both.
- Internal identifiers that still say "wacrm" (`wacrm_live_` key prefix,
  `X-Wacrm-*` headers) are contracts. Do not rename them.
- **Line endings: nothing to do. Verify only.** `core.autocrlf=true` is set in
  the Windows global git config (Git for Windows' installer default), so git
  normalises CRLF→LF into the index on read. `git status` on the development
  machine correctly shows only files with real content changes, and `git add -A`
  cannot commit line-ending churn.

  The files on disk really do carry CRLF and the index really does hold LF —
  that is autocrlf working as designed, not a defect. A tool reading this repo
  *without* that global config (a Linux container, CI with a bare checkout) will
  report ~450 modified files. **That is an artefact of the reader, not the
  repo.** Confirm with `git config --get core.autocrlf` before believing any
  large modified-file count.

  Do not run `git checkout -- .`, do not add `.gitattributes`
  ([archive/rejected-alternatives.md](archive/rejected-alternatives.md) §5), and
  do not "fix" anything here.

### Files you will touch repeatedly

| Path | What it is |
| --- | --- |
| `src/app/api/whatsapp/webhook/route.ts` | Inbound webhook. GET handshake + POST. Verifies with one global secret today. |
| `src/app/api/whatsapp/config/route.ts` | Manual connection save. Contains both bugs claude-01 fixes. |
| `src/lib/whatsapp/webhook-signature.ts` | HMAC verification. Reads `META_APP_SECRET` from env internally today. |
| `src/lib/whatsapp/meta-api.ts` | All Meta Graph calls. `META_API_VERSION` pinned `v21.0` at `:12`. |
| `src/lib/whatsapp/encryption.ts` | AES-256-GCM. Reuse; do not reimplement. |
| `src/components/settings/whatsapp-config.tsx` | Settings UI (~840 lines). Reads the DB from the browser at `:107`. |
| `src/lib/auth/account.ts` | `requireRole('admin')` at `:182`. Use it. |

### Helpers that already exist — reuse, do not rewrite

- `verifyPhoneNumber({phoneNumberId, accessToken})` — `meta-api.ts:54`
- `registerPhoneNumber({phoneNumberId, accessToken, pin})` — `meta-api.ts:123`;
  already treats "already registered" as success (`:151`)
- `subscribeWabaToApp({wabaId, accessToken})` — `meta-api.ts:167`, throws on failure
- `getSubscribedApps({wabaId, accessToken})` — diagnostic, wired to "Verify Registration"
- Cross-account duplicate-number check — `config/route.ts:213-235`, service-role,
  already excludes the account's own row via `.neq('account_id', accountId)`

---

## 4. Environments

| | Development | Production |
| --- | --- | --- |
| Runs on | Manish's laptop, `npm run dev` | Hostinger Managed Node.js |
| Public address | Existing static ngrok domain | Hostinger domain (permanent) |
| Database | **Separate free Supabase project** | The live Supabase project |
| Data | Test numbers, fake accounts | Real clients |

One production deployment, one production database, **no staging server**.
Embedded Signup needs HTTPS with a valid certificate — `localhost` won't work
with Meta; the static ngrok domain satisfies this and doesn't rotate.

**Departure from `CODEX-SDD-WA-001` §6.2** (private preview deployment): not
built. The control Codex wants — unfinished provider work never touches client
data — is already met by the sandbox Supabase project plus a Meta app in
development mode. A second Hostinger plan buys nothing further at this scale.
What we keep: no production data in the test database ever, no client workspace
used as a test subject, and a test number rather than a client's.

**One Meta app throughout, though.** App Review is tied to one app, can't be
transferred, and needs a recording of the flow on the app being submitted — so
build, test, record and submit on the same provider app; only its URLs change
(ngrok → Hostinger) at rollout stage 4. Isolation comes from the database and
the phone number, not from a second Meta app. See `claude-03` § Before you start.

---

## 5. How code reaches production

Every deploy: push → hPanel Git **Pull** → `npm ci` → `npm run build` →
**Restart application**.

**Migrations are not run by the deploy.** SQL from `supabase/migrations/` is
pasted into the Supabase SQL editor manually, *before* the code deploy. Write
every migration idempotent, guarded, and loud on failure. Because they run
against old code, they must be additive.

**`NEXT_PUBLIC_*` values are baked in at build time** (`Deploy.md` step 5), not
read at runtime. So a feature gated on one is switched by setting the variable
and rebuilding — roughly five minutes. That is the kill-switch pattern in
`claude-02`: no feature-flag plumbing, and self-hosters get it off by default.

**Rollback** is redeploying the previous commit, so tag a known-good commit
before each deploy. The only tag today is `baseline-pilot`, and `phase-1` has
moved past it — **there is no rollback target until you create one**
(`claude-01` §10 step 3, not optional).

**Departure from `CODEX-RAS-WA-001` §11** (formal evidence package per stage):
not produced. It is governance for a team with separate reviewers; here the
author, reviewer, deployer and rollback owner are one person. Kept, because each
costs a line: record the deployed commit SHA and migration number in the deploy
notes, and confirm the four checks were green.

---

## 6. Glossary — business term → what it means in code

| Business term | In the system |
| --- | --- |
| Workspace / client account | `accounts` row; everything scoped by `account_id` |
| "Their WhatsApp connection" | The single `whatsapp_config` row for that account |
| "Their data and history" | `contacts`, `conversations`, `messages`, `automations`, `flows`, `message_templates` — keyed by `account_id`, never touched by connection changes |
| "Moving a client to the new app" | Not built (§7) |
| WABA | WhatsApp Business Account — the container holding a client's number(s) |
| Phone Number ID | Meta's identifier for the number; not the digits |
| App Secret | Proves an inbound webhook came from Meta, per Meta app |
| Verify token | A value we choose; Meta echoes it once when a callback URL is registered |
| Provider app | The single ConnectsWA-owned Meta app Embedded Signup runs on |

---

## 7. Build order

1. **claude-01** — ships to production immediately. This is what Manish sells:
   small, safe, quick.
2. **claude-02** — built afterwards on its own branch against the sandbox
   database and ngrok. Ships to production **switched off**, is demonstrated in
   Meta's development mode, recorded, and submitted for App Review. The button
   is enabled only after approval.

App Review requires a recording of the working flow, so the code must be
complete and demonstrable **before** submission. Development mode lets anyone
with an App Role complete the flow — exactly enough to build, test and record.

**Migration is out of scope — decided, not deferred.** Embedded Signup applies
only to a workspace with no connection; one that already has a connection gets a
409 and no button. Invariant 8 is the rule; **`claude-02` §5.3.1 is the single
place the reasoning lives.** A future client-requested move is its own spec, with
its own Meta rehearsal and rollback plan, per `CODEX-SDD-WA-001` §5.4 and
`CODEX-RAS-WA-001` §9.
