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

## Verification

See the PR description for the exact commands, counts and screenshots. Not verified: see the "Not verified" list there.
