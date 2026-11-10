# Typed module navigation (PR A) — acceptance record

Design: `docs/superpowers/specs/2026-11-10-audience-typed-navigation-design.md`. Plan: `docs/superpowers/plans/2026-11-10-typed-navigation-pr-a.md`. Author-executed evidence; independent review pending.

## Outcome

The sidebar and breadcrumb section in `AppShell` are rendered from one typed registry (`src/lib/navigation.ts`) through a pure resolver, with no behavior change. Pure role rules moved to `src/lib/permissions.ts` and are re-exported by `src/server/permissions.ts`, so server routes and the sidebar share one `can()`.

- Parity rule: same items, order, groups, routes, labels, icons and active states. "Imports hidden from viewers" is now the `crm:import` permission (owner, admin, member), the same roles.
- Audience support exists in the resolver (`audiences`, `audienceLabels`), proven with test fixtures only. No audience-specific entries ship; audience storage arrives in PR B.
- No migration, no new dependency, no new user-facing string. The server still enforces every route's permission; the sidebar is presentation.

## Evidence (author-executed, local)

- `npx vitest run --project unit tests/unit/permissions.test.ts`: 8 passed, including `can` and `roleIds` being the same bindings on server and client.
- `npx vitest run --project unit tests/unit/navigation.test.ts`: 35 passed. Covers today's sidebar for owner, admin and member; Imports hidden from viewer and unknown membership; every route and label; at most one active item and the old breadcrumb chain reproduced on all 24 real workspace routes; deals under Pipelines; audience filtering, label override and empty-group removal with fixtures; no audience entries shipped.
- `npm run lint` (ESLint and source guards), `npx tsc --noEmit`: pass. `npm test`: 30 files, 343 tests passed.
- Browser: `layout`, `studio-foundation`, `crm06` (viewer limits) and `foundation` specs: 5 passed.
- Visual parity: 26 screenshots (desktop sidebar and header breadcrumb on People, Pipeline settings, Campaigns, legacy Contacts, Files and Appearance; mobile sidebar sheet; light and dark) taken on `main` and on this branch with the test email masked. All 26 are pixel-identical.

## Not covered here

Audience storage, onboarding choice and settings (PR B); workspace → ministry wording (PR C).
