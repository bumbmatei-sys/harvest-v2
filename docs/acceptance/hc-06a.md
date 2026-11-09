# HC-06A — Canonical contact source history

Implementation from main `51fcbd6`, on `feat/hc06a-source-history-20261109`. This is the first HC-06 slice, not complete verified association or source segmentation.

## Delivered

- Migration 0031 adds a minimal tenant/contact source ledger, FORCE RLS, owner/admin-only reads and no direct application writes. No backfill: pre-existing unproven origins remain Unknown.
- Manual contact insertion records a creation event atomically. Successful person imports record create/fill events, suppressing the temporary manual event for an import-created contact. Preview/skip/failure/company-only imports do not produce acquisition events.
- Person-row application moves into a controlled database writer that reads immutable CSV cells/mapping, normalizes/validates them, chooses the canonical tenant contact and computes its own rollback delta. Callers cannot choose a contact, source kind, creation outcome or rollback metadata. Direct final import-row mutations are denied. Existing TypeScript preview/matching and URL/IDN company resolution remain; tenant company links require a live tenant reference and retain existing writer authority.
- The writer revalidates identifiers after acquiring the contact lock. It avoids locking the import row before the contact, preserving merge/erase lock order. Per-row savepoints and existing retry/chunk behavior remain.
- Merge preserves independent origins before erasure. Controlled contact erasure deletes source linkage. Rollback removes origins with removed contacts, marks reverted fills honestly and preserves kept rows. No separate indefinite-retention policy or sensitive payload copies.
- An optional Source column reuses the People grid/column selector; bounded Source history reuses the existing record card/layout. Members/viewers receive no source payload or column option. Source is not advertised as a sort/filter or new export/AI/webhook projection.

## Validation

Author-executed evidence:

- 298 unit tests passed.
- Targeted CRM import, import/export isolation and association suites: 40 tests passed.
- Source-history suite: 10 tests, including actual populated 0030→0031 upgrade, retry/skip/rollback/merge/erase, direct SQL denial, invalid ready rows, NBSP/BOM normalization and a real lock-wait identifier-change race. Final rerun recorded with the PR.
- TypeScript and lint/source guards passed; production build passed.
- Browser test passed on local Chromium: existing contact creation → detail Source history → optional list column; six phone/tablet/desktop light/dark screenshots in `docs/screenshots/hc06a/`. No horizontal overflow at 390/768/1440.
- Independent source review found and drove corrections to provenance trust, post-lock identity validation, lock ordering and whitespace parity. Final exact-commit approval is tracked in PR review evidence; do not infer it from earlier working-tree review.

Hosted exact-head CircleCI/browser/Neon checks are not claimed by this local acceptance record. Keep the PR draft until required hosted validation and final independent review are complete. No live migration, merge, deployment or production activation occurred.

## Scope and reuse

Uses canonical contacts/identifiers, existing import transactions and rollback/merge/erase services, ListPage/grid/column state, record cards, shadcn and Studio Admin tokens. No dependencies or external UI sources added. The React best-practices checklist was applied: authorization remains server-side, projections are bounded, there is one page-level source-summary query rather than per-contact queries, and UI remains server-rendered without new client data fetching/hooks.

B1–B3 own verified claim association, immutable notices, durable subject rights and purpose provenance. C owns source Include/Exclude and separate newsletter/follow-up predicates. D owns integrated closeout. Five HC activation decisions remain unapproved.
