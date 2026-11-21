# Contextual sidebar acceptance

One reusable "contextual sidebar" slot in the shared AppShell, behind the existing shell-modes flag (`HARVEST_SHELL_MODES`). Founder request of 21 Nov: the Inbox panel becomes the entire sidebar with a back arrow on top, and community creation and editing behave the same way. Nothing is activated; the hard-off switches and all five HC-02 gates are untouched.

## What changed

- **One mechanism.** `src/components/editor/editor-context.tsx` (the shell slice 3a provider) gains a second registration, `useContextualSidebar(spec)`, beside the existing `useEditorContext`. A page registers plain data (`title`, `back`, `label`); the shell draws the frame and the page **portals its own panel** into the frame's slot, so the panel keeps its state in the page. The editor's step registration is unchanged.
- **One frame.** `contextual-sidebar.tsx` exports `ContextualBack` (the 44px back arrow with its own accessible name, used by both the editing sidebar and the Inbox) and `ContextualSidebar` (frame with title and slot). `EditingSidebar` now uses `ContextualBack`.
- **Shell.** `ModeNavigation` swaps the whole sidebar (the logo row and mode switcher are hidden while a contextual sidebar or an open editor is shown; the account footer stays) under the existing rule: only while the owning mode is shown. Focus moves into the back arrow when the sidebar swaps in and to a current entry when it swaps out, never on first render.
- **Registry.** `NavEntry.exitTo` and `contextExit()` in `src/lib/navigation.ts`: the Inbox's back arrow goes to the Planner entry, defined in the registry, not in the page.
- **Inbox.** Folders, accounts (grouped by network, coloured marks, per-account counts from the existing ETag sidebar endpoint) and labels are the sidebar. Account groups collapse (disclosure button with `aria-expanded` and `aria-controls`, 44px, remembered for the visit only). The page is two panes (list and thread); the list pane collapses so the thread takes the full width (`aria-expanded` toggle, focus follows). On phones the shell drawer shows the same panel and the Filters button opens it; choosing a filter closes it. The single-pane list/thread flow is unchanged.
- **Flag off.** Without `HARVEST_SHELL_MODES` there is no provider, `hosted` is false and the Inbox keeps its previous inline three-pane layout and Sheet; the legacy single sidebar is untouched.
- **Community editor.** Uses the shared `ContextualBack` and the same swap (no logo row or mode switcher while editing; the way out is the back arrow, which the existing unsaved-changes guard still intercepts).

## Verification (author-run, local)

`hosted` is true only while a spec is registered, so a page that asks for nothing keeps its panel inline.

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` (eslint zero warnings plus source guards) | exit 0 |
| `npx vitest run --project unit` | 107 files, 1,374 tests passed |
| One Playwright run, private non-root PostgreSQL 16: `shell-slice3a`, `shell-slice3b`, `shell-slice2`, `kit-pr2-shell`, `social-inbox-screens`, `social-publish-screens` | exit 0: 26 passed, 4 skipped (the flag-off parity tests) |

Asserted in the Inbox spec: back arrow focus on swap-in and on the current entry after Back, account group and list collapse with focus, 44px (at least 43.5) targets for the back arrow, an account toggle and a folder in the phone drawer and for the list toggles at 768, the phone drawer closing on a filter choice, and the flag-off layout (inline filters, no "Inbox sidebar" group) when `HARVEST_SHELL_MODES=disabled`. The editor specs assert no mode switcher while editing and the guarded back arrow.

## Not verified

- A flag-off run (`HARVEST_SHELL_MODES=disabled`) of the shell and Inbox specs: the flag-off branch of the Inbox spec is written but was not executed here.
- Integration tests, and the campaigns and settings-popup specs. `campaigns.spec.ts:48` (flag-off link count) fails the same way on main and is tracked separately.
- Dark and 768px captures of the new sidebar beyond the Inbox spec's scenes; hosted environments.
