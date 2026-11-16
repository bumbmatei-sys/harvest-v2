# Shell slice 1: registry modes (no UI change)

Spec: `docs/superpowers/specs/2026-11-16-three-mode-shell-design.md` (PR #100), slice 1.

## What changed
- `src/lib/navigation.ts`: required `NavEntry.mode` (`operations | public | assistant`), `status` (`live | planned`, default live), per-mode groups (`groupsByMode`), `legacyGroup` (today's single-sidebar group, so the rendered sidebar is unchanged).
- New pure functions: `resolveMode` (mode of a path; a manual `choice` applies only when no entry owns the path), `modeAvailability` (empty mode reported unavailable), `resolveModeNavigation` (groups of one mode, not rendered yet).
- `resolveNavigation` keeps its signature and result shape and now never returns planned entries; `sectionLabel` ignores planned entries (breadcrumb unchanged).
- Modes: Operations = CRM, Follow-up, campaigns, files, CRM fields, pipeline settings, appearance, ministry settings (Settings is the last Operations group). Public = communities. Assistant = reserved chat.
- Reserved `planned` entries (hidden, never linked): Operations: Connect QR/links, responses, forms (Connect group); email, calendar, documents, spreadsheets (new Office group); church profile, volunteers, livestream, giving, events (existing Ministry group, label "Ministry"). Placeholder routes under `/workspaces/{id}`: `/mail`, `/calendar`, `/docs`, `/sheets`, `/church-profile`, `/volunteers`, `/livestream`, `/giving`, `/connect/forms`, anchored so none can capture a live path (tested). Also: composer, planner, inbox, auto-replies, articles, website, link in bio, newsletter, Discover management, courses and products (Public); assistant chat (Assistant).
- `messages/en.json` (`ComponentsAppShell`): labels for the new entries, groups and the three mode names (catalogue only; planned entries are hidden).
- `AppShell`, routes, permissions, migrations, dependencies: untouched.

## Checks run
tsc (`npx tsc --noEmit`), eslint on the changed files, `scripts/check-source.ts`, the unit project, `npm run build` and the five shell e2e specs, all re-run after the reserved-entry addition and the merge of origin/main (be84132).

## Tests
- Unit: every entry has a mode and a group of that mode; modes per founder decision; planned entries never rendered/linked/labelled for any role x audience; link set identical to origin/main for 4 roles x 4 audiences + none x communities on/off (fixture `tests/unit/fixtures/navigation-before-modes.json`, generated from the pre-change registry); per-mode filtering; mode availability; mode derivation for nested and dynamic routes; manual choice only on neutral pages; unknown-path fallback. Existing tests kept in meaning (fixtures only gained `mode`).
- E2E (unchanged specs, all green): kit-pr2-shell, layout, studio-foundation, campaigns (CW-01 mobile nav), ministry-audience. No e2e hardcodes navigation link counts.

## Deviations from the spec
- `resolveNavigation` does not return `{ mode, groups }`; it stays `NavGroup[]` so AppShell is untouched. The mode-aware result is the new `resolveModeNavigation`. Slice 2 can merge the two.
- Follow-up already exists live on main (HC-13), so it is a live Operations entry in a new `connect` group with `legacyGroup: "workspace"` (still shown where it was).
- Settings, Appearance and `/crm/settings/*` are Operations entries that own their paths, so the switcher cannot override the mode there; they are not neutral pages. Spec section 3's neutral list (home, profile, settings) should say so (neutral = home, profile, `/workspaces`, unknown). Neutral = home, profile, `/workspaces`, unknown.
- `pane`/`paneId` fields are not added (belong to the pane slices).

## Not verified
- No visual change, so no new screenshots; e2e regenerated screenshots were discarded.
- Per-mode sidebar rendering (slice 2); assistant feature gating; real routes for planned entries (placeholders, no pages exist).
- CI not run on the PR yet.

## Decisions needed
None. Slice 2 must decide whether `resolveNavigation` becomes the mode-aware resolver.
