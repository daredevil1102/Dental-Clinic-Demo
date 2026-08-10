# ADR 001: One ConnectsWA Product with Two WhatsApp Onboarding Methods

| Document control | Value                                                   |
| ---------------- | ------------------------------------------------------- |
| Document ID      | CODEX-ADR-001                                           |
| Status           | Accepted                                                |
| Decision date    | 2026-08-10                                              |
| Author           | Codex                                                   |
| Decision owner   | Manish                                                  |
| Related design   | `../codex-unified-whatsapp-onboarding-system-design.md` |

## Context

ConnectsWA needs to enter the market before its own Meta provider app completes
verification and review. The immediate route is assisted onboarding through a
Meta app owned by each client. In parallel, ConnectsWA will build and submit an
Embedded Signup flow under its provider app.

The main architectural question is whether these routes should become separate
applications, deployments, domains, or databases, and whether early manual
clients must later migrate to the provider app.

ConnectsWA business history is already account/workspace scoped. Contacts,
conversations, messages, notes, deals, automations, and reports do not need to be
owned by a Meta connection record. This allows both onboarding methods to serve
one product safely.

## Decision drivers

- Reach the market without waiting for Meta approval.
- Avoid operating two customer products or two permanent hosting stacks.
- Preserve one continuous ConnectsWA workspace and CRM history per client.
- Prevent Embedded Signup development from disrupting live manual clients.
- Avoid unnecessary migration risk for clients whose manual setup works.
- Keep a usable fallback if Meta approval or browser-based signup is delayed.
- Minimize duplicated business logic and support procedures.

## Options considered

### Option A — one product, two connection methods

One production ConnectsWA application and database support both manual and
embedded connections. The methods have isolated credential and webhook
boundaries but feed the same workspace and CRM processor.

Existing manual clients stay manual. New clients use Embedded Signup after it is
approved, with manual setup retained as a fallback.

### Option B — separate manual and embedded products

Operate separate applications, domains, databases, and client onboarding paths.
Client history would need export/import or synchronization if a client moved
between them.

This creates duplicate operations, authentication, support, security controls,
monitoring, data governance, and release management.

### Option C — one product followed by mandatory migration

Launch manual onboarding first, then require every early client to complete
Embedded Signup after provider approval.

This creates migration work and client risk without delivering additional CRM
value to a client whose manual connection is already healthy.

## Decision

Choose **Option A: one product with two connection methods**.

- ConnectsWA has one permanent production deployment, domain, and database.
- The manual route is released first.
- Embedded Signup is developed in the same repository and is hidden until
  approved.
- Both methods create a connection for the same workspace model.
- Manual and provider webhook verification remain isolated.
- Verified events share the existing inbox and automation processor.
- Existing manual clients are not required to migrate.
- The manual method remains an operational fallback after Embedded Signup
  launches.
- Any future migration is a separately approved capability, not a condition of
  this release.

## Consequences

### Positive

- Market entry is not blocked by Meta provider approval.
- Clients experience one ConnectsWA product and retain one continuous workspace.
- There is no CRM history export/import project.
- Live manual clients can remain untouched during provider development.
- Embedded Signup can be disabled for new onboarding without affecting manual
  clients or already-connected embedded clients.
- One shared event-processing path reduces behavioral drift.

### Negative

- ConnectsWA must support two credential models and two webhook verification
  boundaries.
- The manual path cannot be deleted while manual clients still depend on it.
- Support and monitoring must identify the connection method when diagnosing an
  issue.
- A private isolated test environment is required for safe provider development.

### Neutral

- Early clients still own their Meta apps; later clients authorize the
  ConnectsWA provider app. This difference exists inside Meta but does not create
  a second ConnectsWA product.
- The provider app approval timeline remains external to ConnectsWA engineering.

## Guardrails

- Never use the provider App Secret to verify a manual webhook.
- Never use a manual client's App Secret to verify a provider webhook.
- Never create a new ConnectsWA workspace solely because onboarding method
  changes.
- Never automatically prompt or force a healthy manual client to reconnect.
- Never expose stored credentials in a browser response or log.
- Never test unfinished Embedded Signup behavior against production client data.
- Never remove provider routes after embedded clients are live merely to hide the
  signup button.

## Revisit conditions

Revisit this ADR only if one of the following becomes true:

- ConnectsWA adds multiple WhatsApp numbers per workspace.
- Meta discontinues the manual client-owned app route.
- Supporting the manual route creates a demonstrated security or operational
  risk that cannot be controlled.
- A validated business requirement emerges for bulk migration.
- A regulatory or contractual requirement mandates physical data separation.

Any revision must preserve workspace history or include an explicit,
tested data-migration and rollback plan.
