# Docs slice 2b acceptance

Closes the parity items left open in `docs/acceptance/docs-slice2.md` (requires #225). Migration `0095_docs_page_shares`. Nothing is activated: the module stays development-only.

## Done

- **Slash menu additions**: pull quote (a blockquote with a flag, so it stays a quote in every export), badges (9 light, 9 strong, Remove badge; the colour is one of the editor palette values, sanitised against it), Button block (label and https address), Website link (text with a link), Markdown (pasted Markdown converted to blocks, sanitised like every import), Layout blocks of 2, 3 and 4 columns, sticky table of contents, Template (opens the Templates panel), Default colour and Remove highlight.
- **@mentions** of a person, a page of this doc or a task: typed `@` opens a menu (also reachable as the slash item Mention); the mention is inline text with the id, never a notification and never a change to a CRM record. Tasks come from the same permission-aware search as Relationships.
- **Favorite placement**: Add to favorites opens Sidebar / Top. Top shows a Favorites row on the Docs list; Sidebar shows "Favorite docs" under the Pages tree in the editor. Per person (`doc_favorites.placement`).
- **Share this page** (`doc_page_shares`, This page tab of the "..." menu): view, comment or edit on one page, and no access to the rest. The doc opens with only that page; every doc-level action (rename, other pages, history, links, export, sharing, structure, protection) still answers "not available" because the doc-level checks are unchanged and only the opted-in page endpoints (open page, save, comments on that page) honour a page share. A page editor changes the words of that page only (no protection, no snapshot, no doc rename). Managed by whoever manages the doc; a person can give up their own. A page share is read by the owner, owners and admins, and the person it names, never by other members.
- **Blank wiki**: the Docs list "New" menu offers Blank doc and Blank wiki. A wiki is a doc with the wiki flag, still private by default (nothing is exposed by choosing it).
- **History panel screenshot** and side-by-side comparisons with the reference (see Evidence).

## Differences kept on purpose

- **"Select task or location" as a share target is omitted.** A Docs folder has no permissions of its own, and sharing with "the people on a CRM task" would make access change whenever the task's assignees change: a privacy rule nobody would see. Sharing stays with named ministry members, the whole ministry, and now one page.
- Mentions do not notify (comment mentions do), by design: a doc is not a message.
- Favorite placement uses two labelled options, not thumbnail tiles.

## Evidence

- Integration: `docs-page-shares.test.ts` (page shares in SQL and server: reading, saving, commenting, structure refused, manage rules, self-removal, notifications for page commenters; favorites placement; blank wiki), `docs-migration-owner-upgrade.test.ts` (fresh and over populated 0089, now also through 0095). Unit: sanitiser and HTML/Markdown output for the new nodes and marks.
- E2E: `tests/e2e/docs-parity.spec.ts` (every slash addition, dialogs, mention, badge menu with axe in light and dark, favorite placement, history panel, share this page, blank wiki). Slice 1 and 2 specs updated for the New menu and the favorite fly-out. The slash menu no longer sets `aria-expanded` on the editor (not valid on a textbox) and its scrolling list is focusable (both found by axe).
- Screenshots: `docs/screenshots/docs-slice2b/` (our screens). Side-by-side comparison images (reference left, Harvest right) were generated for the share dialog, settings menu, comments, templates, page styles, relationships, slash menu, badges, mentions, favorite fly-out and the empty editor, but are **not committed**: the repository is public and the left side is a third-party product. They are in `docs/screenshots/docs-slice2b/compare/` in the builder's worktree (git-ignored); commit them only on the founder's say.

## Migration

`0095_docs_page_shares`: `doc_page_shares` (FORCE RLS, owner denormalised and pinned by a composite key like `doc_shares`, so its policies never read `docs`), `doc_favorites.placement`, the helper functions `docs_page_rank` and `docs_has_page_share`, and re-created policies on `docs`, `doc_pages`, `doc_comments` and `doc_notifications` that add "or has a page share" (page reads; page updates only for an edit share). Chained on 0093; its `when` is above every other journal entry here. After #223 and #224 land, merge main in and re-chain the snapshots.
