# Rejected alternatives — P1-10 / P1-11

- **Status:** Archived. Not a build document.
- **Purpose:** One place for designs that were proposed, examined and rejected
  during review, so they are not silently re-proposed.

The build specs (`claude-01`, `claude-02`) state decisions. This file states what
was *considered and rejected*, and why. **If you are implementing, you do not
need this file.** Read it only when tempted to reintroduce one of these.

Each entry: what was proposed → why it was rejected → where the decision now
lives.

---

## 1. Embedded Signup may overwrite an existing connection (`confirm_replace`)

**Proposed.** Let Embedded Signup replace an account's existing connection once
`subscribeWabaToApp` succeeded, behind a `confirm_replace: true` flag. Argued to
be free, because `UNIQUE(account_id)` makes it an update and the duplicate check
already excludes the account's own row.

**Rejected.** The mechanics were right; the conclusion wasn't. Trace a `manual`
client running Connect: exchange succeeds → subscribe succeeds (fatal-on-failure,
so this is the commit point) → the row is overwritten with the provider token and
`app_secret`/`verify_token` cleared → `registerPhoneNumber` fails, which is
**non-fatal and therefore a normal outcome** → the no-downgrade guard preserves
`status='connected'`.

Result: the client's working credentials are gone, the number is not registered
under the provider app, and the row reads `connected`. A status label is not a
connection.

The escape hatch offered alongside it was also incoherent — re-entering details
in the manual form stores *client-owned-app* credentials, restoring a manual
connection rather than moving anyone to the provider app. And Meta's behaviour
for a number already registered under a client-owned app was never verified.

`CODEX-ADR-001` §Guardrails already forbade it: *"never automatically prompt or
force a healthy manual client to reconnect."*

**Decision now lives in:** `claude-02` §5.3 rule 2, §6 step 3, §8. Migration is
out of scope; a future client-requested move is separate approved work per
`CODEX-SDD-WA-001` §5.4.

---

## 2. A shared `persistConnection` doing an `upsert`

**Proposed.** One helper for both connection methods: duplicate check → encrypt →
**upsert** → status decision.

**Rejected.** An upsert updates an existing row when one exists — exactly what
entry 1 forbids. An `allowOverwrite` boolean is no better: a flag deciding
whether a live client's credentials get replaced is the argument that gets passed
wrong once, in a hurry, with no test covering that combination.

**Decision now lives in:** `claude-02` §5.4 — `createEmbeddedConnection` (insert
only) and `saveManualConnection` (may update), sharing the non-writing helpers
but never the final statement. The dangerous operation is *unreachable*, not
merely unrequested.

---

## 3. A registration failure saved as `status='connected'`

**Proposed.** After a failed `/register`, persist the row as `connected` on the
grounds that the credentials were valid and the client could retry.

**Rejected.** Until `/register` completes the customer cannot send or receive, so
the row would describe a connection that does not work — the same "UI says fine,
nothing works" failure `claude-01` exists to eliminate, delivered to a brand-new
client whose first impression is a green label over a dead number.

**Decision now lives in:** `claude-02` §5.3.2 (`disconnected` + error retained)
and §5.3.3 (a retry endpoint, because `disconnected` is only honest if there is a
way out).

---

## 4. `last_outbound_at` alongside `last_inbound_at`

**Proposed.** Stamp an outbound timestamp in `send-message.ts` to sit beside the
inbound health signal.

**Rejected.** Three paths send without going through `send-message.ts` —
`automations/meta-send.ts:157`, `flows/meta-send.ts:97`,
`broadcast-core.ts:275` — so the column would read "never" on a workspace whose
broadcasts and automations were sending perfectly. A diagnostic that lies is
worse than none, and covering all four call sites is a bigger change than P1-10
should carry. Inbound has a single funnel and cannot be incomplete — and inbound
is the direction that actually breaks.

**Decision now lives in:** `claude-01` §3.1 — `last_inbound_at` only.

---

## 5. Cleaning up "450 modified files" of CRLF churn

**Proposed.** Two variants, in order: add `.gitattributes` with `* text=auto`
and renormalise; then, less drastically, `git checkout` the ~448 files whose only
difference was line endings.

**Rejected — the premise was wrong.** There was never any churn to clean. The
Windows global git config sets `core.autocrlf=true` (Git for Windows' installer
default), so git normalises CRLF→LF into the index on read: `git status` on the
development machine shows only real content changes, and `git add -A` cannot
commit line-ending noise.

The ~450-file count came from reading the repo with a git that lacked that
config — a Linux container mounting the same folder. **It was an artefact of the
reader, not a property of the repo.** Both proposed cleanups would have been
destructive no-ops at best; the `checkout` variant risked destroying real
uncommitted work in the two genuinely-modified files.

**Lesson worth keeping:** before acting on a large modified-file count, check
`git config --get core.autocrlf` and compare `git diff --name-only` with
`git diff --ignore-cr-at-eol --name-only`. If they differ, suspect the
environment before the repository.

**Decision now lives in:** `claude-00` §3 — verify only, change nothing.

---

## 6. Build Embedded Signup on the existing app, swap in the final one later

**Proposed.** Keep developing against the Meta app already wired to ngrok, and
switch to the final ConnectsWA provider app once it was ready.

**Rejected.** App Review is tied to one specific app and cannot be transferred,
and it requires a screen recording *of the app being submitted*. Building on app
X and submitting app Y throws the recording away and forces the OAuth settings
and the per-app `config_id` configuration to be rebuilt and retested on Y.

**Decision now lives in:** `claude-03` § Before you start, and `claude-00` §4 —
one provider app from the first line of code to production; only its URLs change
(ngrok → Hostinger). The old app stays for manual / P1-10 testing only.

---

## 7. Larger architectures considered and parked

Two full designs were written and set aside as over-built for single-digit client
counts. They are complete documents in this directory, not summaries:

- `P1-10-full-multi-app-architecture.md` — server-only credential repository,
  expand/contract migration pair, connection state machine, per-client callback
  URLs, sanitized config API.
- `P1-11-full-provider-and-migration.md` — migration as a first-class subsystem,
  attempts table, assisted-provider path, transactional swap.

**Revive from these if:** client teams grow beyond one or two trusted people (the
credential-repository work in the first), or a validated business requirement for
bulk migration appears (the second). `claude-01` §11.2 tracks the first as the
open hardening item.
