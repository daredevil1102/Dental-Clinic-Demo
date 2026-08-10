# ConnectsWA WhatsApp Onboarding Rollout and Acceptance Specification

| Document control | Value                                                |
| ---------------- | ---------------------------------------------------- |
| Document ID      | CODEX-RAS-WA-001                                     |
| Status           | Proposed for final review                            |
| Version          | 1.0                                                  |
| Date             | 2026-08-10                                           |
| Author           | Codex                                                |
| Business owner   | Manish                                               |
| Parent design    | `codex-unified-whatsapp-onboarding-system-design.md` |

## 1. Purpose

This document defines the release order, evidence, stop conditions, acceptance
criteria, and rollback behavior for introducing manual multi-client onboarding
and Embedded Signup into one ConnectsWA production system.

Passing a code build is not sufficient. Each gate must demonstrate the business
outcome that the next stage depends on.

## 2. Release policy

- Manual onboarding may enter production before provider-app approval.
- Embedded Signup development proceeds in parallel in the same repository.
- Unapproved or unverified Embedded Signup is never shown to production clients.
- Existing manual clients are not selected for provider testing.
- Embedded Signup is enabled only after technical acceptance, Meta approval, and
  production-safety checks all pass.
- The manual route remains available after Embedded Signup is enabled.
- No release includes mandatory manual-to-embedded migration.

## 3. Environments

| Environment             | Purpose                                          | Data                                        | Customer-facing |
| ----------------------- | ------------------------------------------------ | ------------------------------------------- | --------------- |
| Local development       | Fast implementation and automated tests          | Synthetic/local only                        | No              |
| Private preview/staging | HTTPS Meta integration and end-to-end acceptance | Isolated test database and test Meta assets | No              |
| Production              | The single live ConnectsWA product               | Real client workspaces                      | Yes             |

All environments use the same repository. Preview/staging should use the same
hosting provider where practical, but must not share the production database.

## 4. Stage 0 — baseline and release preparation

### Entry criteria

- Current production or pilot baseline is identified.
- Existing manual connection behavior is covered by characterization tests.
- Required secrets are stored outside source control.
- Unrelated working-tree changes are preserved and excluded from implementation
  commits.

### Required evidence

- Current type check, lint, test, and build results are recorded.
- A test workspace can send and receive using the pre-change manual route.
- Database backup/restore capability is confirmed before migrations.

### Exit criteria

- Baseline failures are distinguished from new regressions.
- Rollback owner and deploy procedure are known.

## 5. Stage 1 — manual multi-client market release

### Delivered outcome

At least two workspaces, each using a different client-owned Meta app, can send
and receive independently through the same ConnectsWA production application.

### Automated acceptance

- A webhook signed with Client A's secret is accepted only for Client A.
- A webhook signed with Client B's secret is accepted only for Client B.
- A payload signed with the wrong client's secret is rejected before side
  effects.
- A workspace without a resolvable secret fails closed.
- Secrets never appear in application responses or test snapshots.
- Re-saving a live connection during a registration error does not disconnect
  it.
- A failed Meta app subscription is returned as an incomplete/error result, not
  a clean success.
- Duplicate phone-number ownership across workspaces is rejected.
- Existing single-client fallback behavior remains valid during rollout.

### Manual acceptance

1. Connect Workspace A to Client Meta App A.
2. Connect Workspace B to Client Meta App B.
3. Send an inbound message to each number.
4. Confirm each message appears exactly once in the correct inbox.
5. Reply from each workspace and confirm delivery.
6. Re-save Workspace A and confirm Workspace B is unaffected.
7. Use an intentionally incorrect secret for A; confirm A is rejected while B
   continues operating.
8. Restore A's correct secret and confirm recovery.

### Stop conditions

Stop the rollout if:

- a message appears in the wrong workspace;
- a valid message is accepted with the wrong secret;
- one client's failure interrupts another client;
- a secret appears in logs or responses;
- re-saving a live connection makes it disconnected; or
- the production callback URL is not stable HTTPS.

### Rollback

- Revert the manual multi-client application release.
- Leave additive database columns in place unless a separate reviewed migration
  explicitly removes them.
- Do not onboard another client until the two-workspace acceptance sequence
  passes again.

## 6. Stage 2 — Embedded Signup private development

### Delivered outcome

A test workspace can complete the Embedded Signup flow on the private HTTPS test
environment and use the standard ConnectsWA CRM.

### Automated acceptance

- The one-time code is exchanged before nonessential database work.
- Code exchange failure creates no active embedded connection.
- Provider-app subscription failure creates no active embedded connection.
- Required number registration is attempted.
- An already-registered response is treated as success.
- Registration or metadata failure produces the documented actionable state and
  never downgrades a pre-existing live connection.
- Provider webhooks reject invalid signatures before side effects.
- Manual webhook tests remain unchanged and passing.
- Provider app removal affects only the associated embedded workspace.
- Deauthorization and data-deletion signed requests reject tampering.
- Authorization limits connection changes to owner/admin roles.
- Codes, tokens, App Secrets, and PINs never reach logs.

### End-to-end acceptance

1. Launch Embedded Signup from an unconnected test workspace.
2. Complete the Meta popup with approved test-role assets.
3. Confirm ConnectsWA reports an actionable success state.
4. Send an inbound message and confirm it reaches the test workspace once.
5. Reply from ConnectsWA and confirm delivery.
6. Confirm contacts, conversations, automations, and reporting behave exactly as
   they do for a manual workspace.
7. Abandon the popup at multiple points and confirm no active connection is
   created.
8. Block the Facebook SDK and confirm the UI explains the problem and offers the
   manual route.
9. Disable the Embedded Signup entry switch and confirm the button disappears.
10. Confirm the existing embedded test connection continues sending and
    receiving after the button is hidden.

### Stop conditions

Stop provider testing if:

- Meta indicates an unexpected deletion, ownership transfer, or unsupported
  migration;
- production client data or production credentials are present in the test
  environment;
- Embedded Signup code changes manual webhook behavior;
- the UI reports a ready connection without working inbound and outbound; or
- the provider app secret is stored in a workspace row.

### Rollback

- Disable the public provider configuration in the preview environment.
- Preserve sanitized failure evidence for diagnosis.
- Do not modify production manual clients.

## 7. Stage 3 — production dark release

### Delivered outcome

Embedded Signup code exists in production, but no production user can start a
new embedded connection.

### Preconditions

- Stage 1 remains healthy.
- Stage 2 automated and end-to-end acceptance is complete.
- Database changes are additive and tested on a disposable database.
- Provider routes, callbacks, and shared processing have production build
  coverage.

### Acceptance

- Embedded Signup entry is hidden because the public provider configuration is
  unset/disabled.
- All existing manual workspaces continue sending and receiving.
- Manual connection settings remain usable.
- Provider routes fail closed when production provider configuration is absent.
- Monitoring can distinguish manual and provider paths.

### Stop conditions

Stop or roll back if any existing manual workspace regresses after the dark
release.

### Rollback

- Prefer a forward fix if database migrations are already applied.
- The first operational action is to keep new Embedded Signup disabled.
- Revert application code only if no embedded production connection depends on
  the new routes.

## 8. Stage 4 — Embedded Signup production enablement

### Preconditions

- The ConnectsWA provider app has the required Meta approval and permissions.
- Required production callback URLs and webhook subscriptions are verified.
- A controlled production test workspace passes inbound and outbound smoke
  tests.
- Manual production workspaces remain healthy after the dark release.
- Customer-facing support copy and recovery actions are available.

### Enablement sequence

1. Enable Embedded Signup for an internal production test workspace.
2. Complete one real production-safe signup.
3. Verify inbound, outbound, status updates, and reconnect handling.
4. Enable the entry point for new/unconnected client workspaces.
5. Keep existing manual workspaces unchanged.
6. Retain the manual fallback.

### Production acceptance

- A new client can connect without supplying Meta developer credentials.
- The connected client uses the same CRM capabilities as a manual client.
- No manual client is prompted to migrate.
- A provider onboarding failure does not affect manual clients.
- Disabling the entry point stops new embedded onboarding without interrupting
  existing embedded or manual clients.

### Rollback

If new onboarding is unreliable:

1. Disable the Embedded Signup entry point immediately.
2. Keep provider webhook and callback routes deployed for existing embedded
   clients.
3. Direct new clients to the manual fallback while the issue is corrected.
4. Re-enable only after the failed acceptance case passes in preview and in the
   internal production test workspace.

## 9. Existing manual-client policy

- A healthy manual client remains on the manual connection.
- The release does not display a forced migration banner.
- Support may explain Embedded Signup, but no automated replacement occurs.
- A future client-requested move requires a separate approved design, a proven
  Meta path, an end-to-end rehearsal, and a rollback plan.
- Regardless of future connection method, the existing ConnectsWA workspace must
  remain the source of truth for CRM history.

## 10. Operational health checks

For each active workspace, support must be able to determine without viewing
secrets:

- connection method;
- connected/incomplete/reconnect-required state;
- last successful inbound event;
- last successful outbound operation;
- whether Meta app subscription is confirmed;
- whether phone registration is confirmed or needs attention;
- most recent sanitized failure category; and
- whether the issue is isolated to one workspace or one connection method.

## 11. Release evidence package

Each production stage retains:

- commit identifier and deployment timestamp;
- database migration identifiers;
- type-check, lint, unit-test, and build results;
- automated test summary by connection method;
- manual acceptance checklist with workspace-safe identifiers;
- screenshots of customer-visible states without credentials;
- known limitations and approved exceptions;
- rollback decision and owner;
- Meta approval evidence for Stage 4.

## 12. Final acceptance statement

The unified onboarding architecture is accepted for general production use only
when all of the following are true:

- manual multi-client isolation is proven;
- Embedded Signup is approved and proven end to end;
- both methods feed one ConnectsWA CRM and database without cross-tenant data;
- existing manual clients require no action;
- new embedded onboarding can be independently disabled; and
- rollback does not require deleting or copying client CRM history.
