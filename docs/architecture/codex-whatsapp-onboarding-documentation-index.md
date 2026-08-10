# ConnectsWA WhatsApp Onboarding Documentation Index

| Document control | Value                     |
| ---------------- | ------------------------- |
| Document ID      | CODEX-DOC-WA-001          |
| Status           | Proposed for final review |
| Version          | 1.0                       |
| Date             | 2026-08-10                |
| Author           | Codex                     |
| Business owner   | Manish                    |

## Document set

| Order | Document                                                                                    | Purpose                                                                                                 | Approval state        |
| ----- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------- |
| 1     | [Architecture decision](decisions/codex-adr-001-one-product-two-onboarding-methods.md)      | Records the approved choice of one ConnectsWA product with manual and embedded connection methods.      | Accepted              |
| 2     | [Unified system design](codex-unified-whatsapp-onboarding-system-design.md)                 | Defines scope, outcomes, architecture, data ownership, security, failure handling, and delivery phases. | Final review required |
| 3     | [Rollout and acceptance specification](codex-whatsapp-onboarding-rollout-and-acceptance.md) | Defines release gates, evidence, stop conditions, acceptance tests, and rollback.                       | Final review required |

## Review order

1. Confirm that the architecture decision matches the intended business model.
2. Review the system design for scope and operating behavior.
3. Review the rollout specification for acceptable release gates and stop
   conditions.
4. Record requested changes before implementation planning begins.
5. After written approval, create a separate `codex-` prefixed implementation
   plan that traces every task to this document set.

## Precedence

After final written approval, this document set is the governing specification
for the unified manual and Embedded Signup architecture.

The existing P1-10 and P1-11 drafts remain source material and implementation
references. If they conflict with an approved decision in this set, the approved
`codex-` document takes precedence. Current Meta primary documentation and the
repository's `AGENTS.md` rules must still be rechecked when implementation
begins because external APIs and framework behavior can change.

## Change control

- Business-scope changes require approval from Manish.
- Security, tenancy, credential-handling, data-ownership, or rollback changes
  require an ADR amendment or a new ADR.
- Implementation details may be refined in the implementation plan only when
  they do not alter the approved outcomes or guardrails.
- Every revision increments the document version and updates the date.
- Replaced documents are marked superseded rather than silently overwritten.

## Implementation gate

No implementation plan or code change is authorized by this document set until
the system design and rollout specification have completed final review.
