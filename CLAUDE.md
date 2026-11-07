Continue Harvest v2 in bumbmatei-sys/harvest-v2. Read the Craft Roadmap, repository PRDs, acceptance records, and open PRs before choosing work. Treat Craft as planning guidance, not proof that code is finished. Check actual current GitHub state, because the details below may have changed since they were written.

State as of 2026-11-07:
- CRM-01 to CRM-07 are merged into main. CRM-06 (CSV import/export, merge, rollback) merged as PR #21 (66ab80d, migrations 0022–0023). CRM-07 (contact association events with per-purpose consent) merged as PR #23 (7465e6b, migration 0024). Acceptance records: docs/acceptance/crm-0*.md.
- CRM-08 (CRM event contracts on the outbox, outbound CRM webhook foundation, AI-readable CRM tools with approval gates; migration 0025) is an open PR from branch ccr-26b726e6-gec2m7. It is a phase-ready foundation only: no workflow engine, no assistant runtime, no approval screen, no delivery scheduler, no webhook settings UI. See docs/acceptance/crm-08.md "Deferred" before building on it.
- The next free migration number is whatever follows the last entry in drizzle/meta/_journal.json on main. Never renumber merged migrations.

Use Claude/Codex for coding and a separate fresh session (never the writing session) for independent review. No force pushes. No merge or deploy without my explicit approval. No real outbound messages or webhook deliveries outside tests.

Keep full-width layouts, 44px mobile tap targets, provider-neutral UI copy (no vendor names), and Organizations terminology. Report what is ready, blocked, and recommended next; don't silently expand scope.
