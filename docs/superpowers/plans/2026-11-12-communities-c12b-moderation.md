# Communities C12b implementation plan

Design: `docs/superpowers/specs/2026-11-12-communities-c12b-moderation-design.md`. TDD order:

1. Pure rules in `src/lib/moderation.ts` with unit tests.
2. Schema, migration `0040_community_moderation_b` (drizzle-kit, then hand-written RLS and definers) and `tests/integration/community-moderation-b-db.test.ts`.
3. Services, routes and `tests/integration/community-moderation-b.test.ts`; flag test; restricted-owner suite.
4. UI and `messages/en.json`: warning alert, Members tab Warn, Appeals tab, Edit history sheet, account appeal dialog.
5. Browser test `tests/e2e/community-moderation-b.spec.ts` with screenshots in `docs/screenshots/communities-c12b/`.
6. Acceptance record, CLAUDE.md migration note, ADR 0013 status.
