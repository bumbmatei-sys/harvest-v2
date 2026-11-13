# CRM soft follow-ups (server-side pass) design

Date: 2026-11-13. Branch `crm-soft-followups`. No migration. No component, page, layout or UI message change (the UI is being rebuilt on a new kit).

## Backlog found

Sources: `docs/acceptance/crm-05` to `crm-08`, `cw-01`, `crm-filters`, `docs/decisions/0010`, `0012`, `docs/reviews/*`.

| Item | Where | Decision |
| --- | --- | --- |
| CRM-07 N1: concurrent redelivery with one external id returns 409, not `duplicate` | `recordAssociation` | Do. Server only. |
| CRM-07 N2: a withdrawal racing the insert surfaces as a 500 | `recordAssociation` | Do. Server only. |
| CRM-07 N3: phone matching over the payload digits can over-redact | SQL `erase_contact` | Skip: needs a migration; safe direction. |
| CRM-07 N4: identifiers dropped by a merge not used to scrub others | SQL `erase_contact`/`merge_contacts` | Skip: needs a migration and a product rule. |
| CRM-07 N5: erased person's activity shows as "removed" on the organization timeline | timeline display | Skip: display wording, a UI decision. |
| CRM-05 F1: task title/details naming an erased person | ADR 0010 section 8 | Skip: product decision, needs its own design and a migration. |
| CRM-05 N1 to N7 / CRM-06 N1 to N8 | review file `v2-15-r1-REVIEW.md` | Skip: ids only, the review text is not in the repository. Cannot be actioned without guessing. |
| CRM-06: raw import rows and CRM-08 delivery/outbox rows never pruned | retention | Skip: needs DELETE grants (migration) and a retention-period decision. |
| CRM-08: approval TTL constant and row-lock concurrency | `crm-tools.ts` | Already on main (`APPROVAL_TTL_MINUTES`, tests). Nothing to do. |
| CRM-08: cap on pending approvals per person | `requestToolApproval` | Skip: the refusal needs a new error message string (user-visible copy) and the limit is a product choice. |
| CRM-08: first endpoint receives the outbox backlog | webhook endpoints | Skip: changes delivery semantics; founder decision. |
| CRM-08: `ENDPOINT_INACTIVE` reused for unsubscribed type; at-least-once delivery | webhooks | Accepted in the CRM-08 record. |
| CW-01 | `cw-01.md` | No open soft items. |

## N1

The pre-check `select` finds a duplicate only when the first write has committed. Two simultaneous deliveries both pass it, and the loser hits the unique index `crm_associations_external_idx`, which became a 409 "stale". Now the insert uses `ON CONFLICT (tenant_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING`. The loser waits for the winner's commit, inserts nothing, re-reads the winner's row and returns `{ stored: true, duplicate: true }` with no second audit row or outbox event. If the row cannot be re-read (it was erased in between) the old 409 `stale` remains.

## N2

The insert guard trigger locks the person row, then re-checks consent and raises a generic exception, which was a 500. The service read consent before taking that lock. It now takes `SELECT ... FOR UPDATE` on the person first (the same lock the guard takes and the one `recordConsent` conflicts with via `FOR SHARE`). Under READ COMMITTED the following consent read sees any withdrawal that committed first, and a withdrawal that arrives later waits for this transaction. The guard remains the authoritative backstop.

## Tests

`tests/integration/crm-associations-races.test.ts` (wide pool): four simultaneous deliveries, five rounds, give one stored and three duplicates and one row; a withdrawal held behind the person-row lock and committed during `recordAssociation` yields `consent_withdrawn` and no row. Both tests failed before the change.
