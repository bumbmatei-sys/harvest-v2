# Phase 0 design-system inventory after Communities (12 Nov 2026)

Evidence-based update to [the foundation plan](design-system-foundation.md). Observed at `origin/main` `f047440` (Communities PR 4b, #62). Moderation panel evidence comes from the unmerged branch `origin/c12a-community-moderation` and is labelled as such. Line numbers are as read on that date; re-check before editing. Nothing here approves implementation; each slice in section 3 needs its own go-ahead. [`docs/component-registry.md`](../component-registry.md) remains the canonical registry and is stale in places (see "Registry drift").

## 1. Delivered since the foundation plan (inventory)

| Piece | Path | What it is | Consumers today | Phase 0 item advanced |
| --- | --- | --- | --- | --- |
| Typed navigation registry | `src/lib/navigation.ts` (#51) | `navEntries` with permission, audience and feature filters; breadcrumb sections | AppShell sidebar and breadcrumb | 0A AppShell; 0C module registration (navigation only) |
| `EditorShell` | `src/components/editor/editor-shell.tsx` (#58) | Header with title/status/actions, step nav, centre settings, preview aside (sheet below `xl`). No autosave or publish logic | `communities/community-editor.tsx` only | 0C EditorShell; Create/Configure/Edit/Preview patterns |
| `useUnsavedChangesGuard` | `src/hooks/use-unsaved-changes-guard.ts` (#58, extracted from Connect) | In-app link, history and tab-close guard returning a pending destination | `community-editor.tsx`, `connect-admin/landing-editor.tsx` | 0C EditorShell / mutation conventions |
| `RichTextEditor` / `RichTextView` | `src/components/rich-text/` (#62) | Tiptap editor with allow-listed formats (JSON out) and a matching renderer | Editor: `forum/post-composer.tsx`. View: `app/communities/[slug]/(member)/posts/[postId]/page.tsx` | 0C rich text |
| `QuestionListEditor` / `QuestionFields` | `src/components/forms/` (#60) | Owner-side question builder (add, reorder, type, options, required) and the respondent renderer | Editor: `community-editor.tsx`. Renderer: `application-actions.tsx`, `community-editor.tsx`, `join-dialog.tsx` | 0C shared form builder plus public renderer (partial: Communities only; no conditional logic, no Connect consumer) |
| `RulesListEditor` | `src/components/communities/rules-list-editor.tsx` (#60) | String-list add/remove | `community-editor.tsx` | None yet; see B2 |
| `ForumCategoriesEditor` | `src/components/communities/forum-categories-editor.tsx` (#62) | Persisted reorderable list with per-row save | Community editor Channels step | None yet; see B2 |
| Unsaved-changes dialog | inline in `landing-editor.tsx:108`, `community-editor.tsx:154` | Same AlertDialog written twice | 2 | Candidate for 0C |
| Registry and showcase | `docs/component-registry.md`, `src/components/dev/ui-showcase.tsx` | Inventory doc and dev-only showcase | Internal | 0A registry (license doc still partial) |
| Unmerged (c12a branch) | `communities/moderation-panel.tsx`, `report-dialog.tsx`, `banned-words-editor.tsx` | Tabs plus four tables, review sheet, row menus, ban AlertDialog; report dialog; chips input | Moderation page only | None yet; see B1, B3, B4 |

Reality check on Phase 0 items: the wizard engine, reusable Basics/Appearance/Access & Pricing/Review steps, access/pricing/entitlement contracts, module registration beyond navigation, standard loading/caching states and the composable table/selector/media/timeline set are **not delivered**. `EditorShell` has one consumer, so it is not yet proven universal (the plan requires two); the Connect landing editor shares the guard but not the shell. React Hook Form is still not installed; Communities forms use local state.

### Registry drift

`docs/component-registry.md` still says EditorShell and the form engine "remain subsequent bounded work" and has no entries for EditorShell, the guard, rich text, question components. Updating it belongs with slice 1.

## 2. Duplication found

**B1. Table + empty state + responsive wrapper.** The pattern (`overflow-x-auto` wrapper, `Table aria-label`, header row with an `sr-only` actions column, `Empty` fallback) is hand-written in `communities/community-invites.tsx:59`, `community-applications.tsx:41`, `community-editor.tsx:143`, `app/workspaces/[tenantId]/communities/page.tsx:32`, `crm/deals/deals-page.tsx:82`, `crm/field-settings.tsx:119`, `crm/company-people.tsx:45`, `crm/imports/import-rows.tsx:34`, `files/file-list.tsx:32`, and four tables in the moderation branch. Wrapper classes vary (`@container ... Card`, `rounded-lg border`, bare `overflow-x-auto`). Empty states are inconsistent: `community-applications.tsx:42` uses a plain `<p>`, while other sites use `Empty` with different class sets (`crm/list-page.tsx:47`, `deals-page.tsx:69`, `forum/page.tsx:48`, `access-state.tsx:8`).

**B2. List editors with add/remove/move.** `forms/question-list-editor.tsx:29-33` (swap-move, remove, 44px icon buttons), `communities/rules-list-editor.tsx:12-17`, `forum-categories-editor.tsx:28-36` (move up/down again, server-side direction), and the options list in `question-list-editor.tsx:71-77`. Each re-implements add-at-limit, remove, `ArrowUp`/`ArrowDown` disabled at the ends and the aria-label conventions.

**B3. Chips input.** One instance, on the c12a branch (`banned-words-editor.tsx:21-24`, a `Badge` with an inner remove button). Do not extract until a second consumer (tags, keyword lists) exists.

**B4. Confirm dialogs.** AlertDialog confirmations are repeated in `landing-editor.tsx:108`, `community-editor.tsx:154`, `crm/deals/deal-controls.tsx:139`, `crm/view-menu.tsx:98`, `erase-contact.tsx:27` and the moderation ban dialog. The "block close while busy" and Cancel/Action `min-h-11` boilerplate repeats; the leave-page variant is identical in two files.

**B5. Status badges.** `variant={x === "pending" ? "secondary" : "outline"}` is repeated at `community-invites.tsx:63` and `community-applications.tsx:46`; `community-editor.tsx:83` maps published/draft; the moderation branch adds banned/muted/active. CRM has separate one-offs (`crm/deals/stage-badge.tsx:13`, `crm/marketing-badge.tsx:7`) with hand-set tint classes. No shared status-to-tone mapping exists.

**B6. Request/mutation hook and busy/error state.** `useCrmRequest` (`src/components/crm/request.ts`) is imported by about 14 files outside `components/crm`: `contact-form.tsx`, `connect/response-form.tsx`, `connect/rights-form.tsx`, `connect-admin/*`, `forum/*` and `communities/*`. The name and location are CRM-specific while the behaviour (JSON fetch, mapped errors, 401 redirect) is generic. Beside it, the `busy`/`error` `useState` plus `setBusy(true); setError("")` sequence is repeated in `create-community-dialog.tsx:19-23`, `community-invites.tsx:21-26`, `application-actions.tsx:28-32`, `join-dialog.tsx:26-39`, `forum-categories-editor.tsx:17-20` and the report dialog. There is no shared loading/error/conflict convention (0C "standard loading/caching/mutation/error states").

**B7. Row detail sheet and tabs scaffolding.** `community-applications.tsx` and the moderation panel both open a right `Sheet` (`w-full overflow-y-auto sm:max-w-lg`) from a table row. Two real consumers once c12a merges.

## 3. Proposed next Phase 0 slices (proposals, not commitments)

Each slice is its own PR; none needs a migration or new dependency. Common acceptance: axe clean on touched screens (existing e2e specs use axe), light and dark screenshots, 44px targets below 1024px, no overflow at phone width, no visual regression on listed consumers, unit tests for new logic, and the PR records reuse/exception rationale per `studio-admin-adoption.md`.

1. **Registry catch-up (docs only).** Add EditorShell, guard, rich text, question components and navigation registry rows to `docs/component-registry.md`; verify and record licenses (Tiptap). Acceptance: every path exists; consumers match grep.
2. **Neutral request hook.** Introduce `useRequest` outside `components/crm`; keep `crm/request.ts` re-exporting `useCrmRequest`, then migrate the roughly 14 non-CRM importers. No behaviour change. Acceptance: existing unit and e2e suites unchanged and green.
3. **`DataTable` shell + `EmptyState`.** Compose wrapper + `Table` + `Empty` + optional actions column; no column engine, no TanStack. Migrate `community-invites`, `community-applications`, the workspace communities page and `files/file-list`; c12a tables after it merges. Acceptance: at least two real consumers; uniform empty states; `aria-label` retained.
4. **`StatusBadge` tone map and `ConfirmDialog` (incl. leave-page variant).** Migrate invites, applications, community-editor status, both leave dialogs, `deal-controls` and `view-menu`. Acceptance: focus return and busy-close tested; badge contrast checked in both themes.
5. **`ListEditor` primitive (add/remove/move, limits, labels).** Migrate `RulesListEditor`, `QuestionListEditor` rows and `ForumCategoriesEditor`. Defer chips input until a second consumer. Acceptance: keyboard reorder tested; aria-label keys preserved so existing e2e selectors pass.
6. **EditorShell second consumer (Connect landing editor).** Only if the layout fits; otherwise record the exception and keep the shared guard. Acceptance: save/publish/conflict and unsaved-leave unchanged (`connect-landing.spec.ts`).

Not proposed now: wizard engine, form engine with React Hook Form, access/pricing contracts. They need their first real workflow (course or community creation) to validate them.
