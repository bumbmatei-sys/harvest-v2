# Docs slice 2 acceptance

Comments, relationships, templates, export and import, page history, sharing and permissions, attachments, the full "..." menu and the right rail, on top of slice 1 (`docs/acceptance/docs-slice1.md`, merged as #220). Migration `0093_docs_collaboration` (see "Migration" below). Nothing is activated: the module stays development-only (`docsEnabled()`), the public link is off by default and impossible in production.

## Done

- **Per-doc privacy.** Docs are private by default; `visibility` is `private` or `ministry` with `ministry_access` view, comment or edit; per-person shares with roles view, comment or edit. Owners and admins keep read and manage of private docs (the Share dialog says so). One rule in `docRank` (src/lib/docs.ts) and the SQL function `docs_rank`; a ministry viewer is capped at comment. Docs that existed before keep ministry-wide read (backfilled through the column default, see "Migration").
- **Share dialog**: invite by name with a role, people with access (change role, remove), ministry toggle with access level, private link (copy), export, protect doc, and a public-link switch that is disabled unless `HARVEST_DOCS_PUBLIC=synthetic` outside production and the owner explicitly approves it. The public page (`/shared-docs/[token]`) is read-only; the token is stored hashed.
- **Comments panel**: threads on selected text or on the page, tabs Open / Assigned to me / Resolved, replies, resolve and reopen, assign, @mentions (ministry members only), delete. Anyone who can comment may resolve, reopen or assign any thread on the page (a deliberate, collaborative choice, as in a shared doc); only the author edits the text of a comment, enforced by a database trigger. In-app notifications only (mention, reply, assigned, shared) with a bell in the Docs list header; nothing is sent outside the app.
- **Relationships panel**: This page / Entire doc tabs, "Link a task, person or doc" with Tasks, Docs and People tabs, backlinks. People and tasks respect CRM and task permissions and links never change CRM records; an unavailable target shows as "unavailable".
- **Templates panel**: search, category chips, My ministry and Starter templates (six original starters), apply to this page (replace) or as new pages, save as template (page or entire doc), update an existing template, delete.
- **Export and import**: Markdown, HTML, PDF (the print view, `/docs-print/...`, with the browser's Save as PDF) and Print; import HTML, HTML with page splitting, Markdown into this doc or as a new doc. Content is sanitised (known nodes and marks, https links only, 512 KB doc, 1,000,000 characters of import, depth and node caps).
- **Page history**: snapshot at most every 10 minutes and before a restore (50 kept), list, view, restore (the restore is itself undoable).
- **Attachments** from Harvest Storage uploads (ready, non-social files only), shown as chips under the page header.
- **"..." menu** (Settings popover): Entire doc and This page tabs with nested fly-outs; includes protect doc and page, wiki badge, move, duplicate, archive, trash, import, export, history, save as template.
- **Right rail**, one to one with the reference order: Comments, Page styles (Aa), Relationships, Templates, Export. Each opens its own side panel with a header and a close button (docked at 1280px and wider, a sheet below).
- **Page styles panel**: font style (System, Serif, Mono), font size (Small, Default, Large), page width (Default, Full width), "Apply typography to all pages"; header toggles (cover image, page icon and title, owners, contributors, subtitle, last modified); sections (subpages table or list, relationships dialog or inline, page outline); focus mode (block, page); stats (word count, characters, reading time, show stats on page). Cover image (from Storage), contributors, subtitle, focus mode and the stats line were added in this slice and work.

## Parity checklist against the 22 reference screens

Legend: S1 = delivered in slice 1, S2 = delivered in this slice, Dev = deliberate difference, Later = on the founder's explicit later list, Open = not built (decision below).

| Area | Element | Status |
|---|---|---|
| List | Doc list with title, owner, updated; search; sort; star | S1 |
| List | Folders as cards, nested, breadcrumb (founder change, like Storage) | Dev (deliberate) |
| List | Notifications bell with mentions and shares | S2 |
| List | Import button | S2 |
| Shell | Breadcrumb, star, save state, Share, "...", close in the header bar | S1 and S2 |
| Pages | Pages tree: nest, reorder, duplicate, archive, delete with count, collapse | S1 |
| Pages | Doc title row, "Pages" label, Add page row at the bottom | S2 |
| Page | Cover image, icon picker, title, subtitle, owner and contributors line, last modified | S2 |
| Page | Attachment chips, subpages table or list, relationships inline | S2 |
| Page | Empty page "Start writing / Add new" block, "+" and drag handles, placeholder | S1 and S2 |
| Editor | Fixed formatting toolbar (founder addition) with 44px phone targets | Dev (deliberate) |
| Editor | Slash menu with section names: text, lists, table, columns, callouts, divider, toggle, TOC, checklist | S1 |
| Editor | Slash menu: badges, pull quote, button block, mentions (person, page, task), sticky TOC, template item, remove highlight | Open |
| Editor | Block focus and page focus | S2 |
| Rail | Five icons in the reference order, each with its own panel, header and close | S2 |
| Comments | Tabs, comment box at the bottom, replies, resolve, assign, mentions | S2 |
| Relationships | This page / Entire doc, link search with Tasks and Docs tabs, backlinks | S2 |
| Templates | Search, category chips, My ministry and starter sections, Update existing, Save as | S2 |
| Export | Markdown, HTML, PDF, Print, import | S2 |
| Page styles | Every item listed above | S2 |
| Menu | Entire doc and This page tabs, fly-outs, sharing and permissions button | S2 |
| Menu | Favorite placement "Sidebar / Top" | Open (the shell sidebar is not extensible; the star in the header is the only placement) |
| Menu | "Share this page" with a per-page link and permissions | Open (sharing is per doc; page links copy the doc link with the page) |
| Menu | "Blank wiki" create option | Open (a doc can be marked wiki from the menu; no separate create entry) |
| Share | "Select task or location" share target | Open |
| Share | Invite by name, roles, private link, ministry, public link, protect | S2 |
| Insert | Website link block, Markdown block, layout block | Open |
| Later | AI writing, standup, whiteboard, slides, synced content, third-party embeds, spreadsheets | Later (omitted, no dead buttons) |

## Decisions needed

1. The Open rows above: build, or accept as documented differences? The slash-menu additions (badges, pull quote, button, mentions, sticky TOC, template item) each need a new editor node and are the largest group; recommend one follow-up slice for them.
2. Per-page sharing: the reference offers "Share this page". Per-page permissions would need `doc_page_shares`; recommended only if the founder wants it.
3. Public link: stays hard-off. Enabling it in production needs the same explicit privacy decision as other public surfaces.

## Migration

`0093_docs_collaboration` (renumbered from 0090 so its `when` is above every other journal entry, including CRM's 0091 and the reserved 0092; journal entry last). Chained on the 0089 snapshot for now; after #223 lands, merge main and set `prevId` to the 0091 snapshot id. It creates `doc_shares`, `doc_comments`, `doc_links`, `doc_templates`, `doc_page_versions`, `doc_attachments`, `doc_notifications` (all FORCE RLS, no SECURITY DEFINER read paths) and adds columns to `docs` and `doc_pages`. The existing-docs backfill uses the column default (add as `ministry`, then default `private`) instead of an UPDATE, because FORCE RLS hides every row from a restricted owner with no tenant set; `tests/integration/docs-migration-owner-upgrade.test.ts` proves it fresh and over populated 0089 data.

## Evidence

- Integration: `docs.test.ts` and `docs-collab.test.ts` (access ranks, shares, comments, links, templates, history, import and export, public link gates, notifications, folder delete 409 on a name clash), `docs-migration-owner-upgrade.test.ts`. Unit: `docs.test.ts`, `docs-convert.test.ts`.
- E2E: `tests/e2e/docs.spec.ts` (slice 1, updated for the new layout) and `tests/e2e/docs-collab.spec.ts` (every panel, comments flow, link, template save, export, print view, history, share dialog, menu). Axe at 360, 768 and 1280, light and dark, on the editor with the comments panel open.
- Screenshots: `docs/screenshots/docs-slice2/` (each panel, share dialog, menu, print view, editor with panel at three widths and both schemes). Side-by-side with the reference is done by eye; the reference images are not copied into the repository.

## Review fixes on #225

- `doc_shares` rows are readable only by the person they name, the doc's owner, and owners and admins (a member can no longer learn who a private doc is shared with); tested by direct SQL as a viewer.
- Contact links follow the person: a merge moves them to the kept contact (deduplicated against `doc_links_uq`) and an erase removes them. Done with the same pattern as the form-source tag (0082): a SECURITY DEFINER trigger on erase, a text patch of `merge_contacts_scoped`, and a tenant-scoped policy for the function owner. The restricted-owner merge test now includes `doc_links`.
- A trashed doc is no longer served through its public link.
- The notification insert now needs read access to the doc; the tenant-less public-read policy is documented in the migration (unique hash, 32 random bytes, hard-off in production).
