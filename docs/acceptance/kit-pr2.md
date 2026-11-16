# Kit PR 2 — Shell review and ministry switcher: acceptance record

Plan: `docs/plans/shadcnuikit-adoption.md` section 7, row PR 2.

## Founder approval (gate, section 2)

Approved 2026-11-16. Both items are **premium**; the founder owns the licence and public-repository consequences (CLAUDE.md). Recorded in `src/lib/ui-provenance.ts` and the table in `docs/ui-sources.md`.

| Area | Kit item | Decision |
| --- | --- | --- |
| Shell | `dashboard-shell8` (premium), https://shadcnuikit.com/blocks/dashboard-ui/dashboard-shell#dashboard-shell-8 | Visual reference only. Keep Harvest's `AppShell` and the typed navigation registry. Not chosen: `dashboard-shell1`, `sidebar-layout`, `dashboard-shell2`, `dashboard-shell3`. |
| Ministry switcher | `dashboard-dropdown7` (premium), https://shadcnuikit.com/blocks/dashboard-ui/dropdown-components#dashboard-dropdown-7 | Pattern for the switcher: list with search, initials marks, role and member count per ministry, a check on the current one. Founder instruction: it appears in the dropdown that opens from the profile picture, not in the sidebar. Not chosen: `dashboard-dropdown1` to `dashboard-dropdown10` (the other nine). |

No kit code was copied. Both items were fetched into a scratch directory only to read them; the files carry the provenance header because the provenance test requires it for any listed file.

## Shell keep/adjust decision

**Keep `AppShell`.** The floating sidebar that collapses to icons, the header with trigger and breadcrumb, the typed navigation registry, permissions and audience logic are unchanged (`src/lib/navigation.ts` and its tests are untouched). Findings against `dashboard-shell8`:

- Floating sidebar, icon-collapse and header already match; no polish change was made because none was clearly better than the current Studio Admin tokens and spacing.
- Quick Create and the inbox button in the kit header have no Harvest counterpart yet (no inbox module, no creation menu); they are not added as dead controls.
- The kit header holds the profile avatar on the right; Harvest's avatar lives in the sidebar footer. Moving it is **not** part of this PR (see follow-ups).

## What changed

- `src/components/app-shell.tsx`: the ministry switcher is removed from the sidebar (and its tooltip logic); the sidebar keeps the "Ministries" link. The profile-picture menu (`AccountMenu`, label "Account menu") now starts with the switcher. New optional prop `header?: { actions?, search? }` (`AppShellHeaderSlots`): a `role="search"` region and a `role="group"` named "Page actions" in the header, rendered only when a page passes them. No page in the product passes them yet, so there is no dead control; `/dev/ui` exercises both.
- `src/components/ministry-switcher.tsx` (new): inside the account menu, up to five ministries are menu items that navigate like links (initials mark, name, role and member count, check and `aria-current` on the current one, 44px rows below 1024px). Above five ministries the menu shows the current ministry and a "Switch ministry" item that opens a searchable list (`Dialog` + `Command`: type to filter, arrow keys, Enter, Escape, focus returns to the avatar button). "Your ministries" (`/workspaces`) and "Create a ministry" (`/workspaces#create-workspace`, anchor added to the create card) stay reachable from the menu.
- Why a dialog above five and not a field inside the menu: a text field is an unallowed child of `role="menu"`; axe reports `aria-required-children` (critical) even inside a `role="group"` wrapper. The kit item uses a Popover with a Command; moving the whole account menu to a popover would change the roles of the theme radios and sign-out for every existing spec, which is out of scope. The consequence is that people with more than five ministries get a dialog rather than an inline search; that is a founder-visible difference from `dashboard-dropdown7` (see decisions).
- `src/lib/ministry-switcher.ts` (new): threshold (5), initials, filter, href helpers (unit-tested).
- Member count: **included.** `listWorkspaces` (`src/server/workspaces.ts`) now adds `memberCount` inside the same per-ministry tenant transaction it already uses, with an explicit `tenant_id` filter on top of row-level security. A person only gets counts for ministries they belong to; no cross-ministry read exists (integration test). Any role can see the count of its own ministries.
- Catalogue (`messages/en.json`): `ComponentsAppShell` gains switcher, role, member-count and header-slot strings; `chooseWorkspace` and `switchWorkspaceValue` are removed (no longer used); `UiShowcase` gains the "Shell" group.
- `/dev/ui`: new "Shell" group; the page passes an example search field and action through the header slots.
- Provenance and docs: `src/lib/ui-provenance.ts`, `docs/ui-sources.md`.

## Tests

- Unit: `tests/unit/ministry-switcher.test.ts` (threshold, initials, filter); provenance, token-leak, showcase-registry and copy-rule tests pass unchanged. Integration: `tests/integration/workspace-member-count.test.ts` (counts per ministry, no leakage).
- E2E added: `tests/e2e/kit-pr2-shell.spec.ts`: (1) avatar menu lists ministries, marks the current one, shows role and member count (including another person's Admin role), no switcher in the sidebar, header slots absent by default, selecting navigates, Enter/ArrowDown/type-ahead/Escape with focus return; (2) five ministries have no search item, six open the searchable list: filter, empty state, Escape focus return, Enter navigates; (3) 360/390/768/1280/1440 in light and dark with the menu and the search list open: axe (wcag2a, wcag2aa, wcag21aa), 44px targets below 1024px, panel bounds, long-name truncation, no horizontal overflow, phone sidebar sheet closes on select. Screenshots: `docs/screenshots/kit-pr2/`.
- E2E updated, none weakened: `tests/e2e/pr01b.spec.ts` (the sidebar switcher and tooltip assertions now assert the switcher is absent from the sidebar and present, truncated and marked current, in the account menu); `tests/e2e/ui-showcase.spec.ts` (header slots, the two new kit records, the Shell group).

## Not done

- No change to navigation, permissions, audience logic or any server contract besides the extra `memberCount` field.
- Quick Create, inbox button and header search have no consumer, so they are not shipped.
- No CI run is claimed; no merge, deployment or production activation.

## Follow-ups and decisions

- Profile avatar placement: it is in the sidebar footer (also in the icon rail). On a phone the sidebar sheet must be opened first. Moving the avatar menu to the header's right edge (as in `dashboard-shell8`) would put the switcher one tap away on every width; it touches the footer layout and several specs, so it needs a founder decision.
- Inline search for more than five ministries would need the whole account menu to become a popover (and the theme radios and sign-out to change roles); decide whether the dialog is acceptable.
- A real consumer for the header search and actions (for example CRM list pages) is a later PR.
