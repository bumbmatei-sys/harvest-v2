# Docs module plan

Operations > Office > Docs: the ministry's documents, in folders, edited in a page-based editor. Founder direction (24 Nov 2026): design of the reference screenshots, style of Studio Admin, built from Harvest shared components; folders work like the Files screen; kit first. Acceptance of slice 1: `docs/acceptance/docs-slice1.md`.

## Decisions held in slice 1

- **Access rule.** Every ministry role reads every doc (viewers read only). Owners and admins create, edit and manage all docs and folders. Members create docs and folders and change the ones they own. Viewers never write. Enforced twice: in the service (`docRights`) and by row-level security (`docs_role_can`, FORCE RLS, restricted `harvest_app` role, no SECURITY DEFINER function needed). Slice 2 replaced this with private-by-default docs and per-doc sharing (`docs_rank`, migration 0093); owners and admins keep read and manage of private docs. The module stays off outside non-production. See `docs/acceptance/docs-slice2.md`.
- **Protect page.** A protected page is read-only for everyone (title, content, style, move, archive, delete) until the doc's owner or an owner or admin turns protection off.
- **Content.** Stored as the editing engine's JSON in `doc_pages.content`, with `engine` (`tiptap`) and `schema_version` per page, and sanitised on the server: known node and mark types only (anything else is refused), allow-listed attributes, https-only links, hex colours, 512 KB, depth 24, 20,000 nodes. No external fetches.
- **Kinds.** `docs.kind` is `document` or `spreadsheet`; slice 1 creates documents. Spreadsheets will live inside Docs so a folder holds both; the New button can later become a menu.
- **Engine boundary.** `DocEditorSurface` is the only component that knows Tiptap (JSON in, change signal, outline and statistics out). The server and the list never import editor types. If an engine audit chooses another engine, the surface, `components/docs/editor/` and the sanitiser change; `engine` and `schema_version` say which pages need converting.
- **Stable ids for later hooks.** `docs.id` never changes. Planned, not built: a doc selected as sermon notes for a live stream (a published read-only snapshot tied to one stream); Google and OneDrive documents imported as copies. Nothing else is added for them now.
- **Trash.** Delete moves a doc to Trash (`deleted_at`, restorable from the Trash filter). Permanent purge and retention are slice 3 work.
- **Folders.** Nested up to 8 levels, names 1 to 80 characters, unique per parent case-insensitively. A non-empty folder is never deleted silently: the interface asks to move its docs and folders up one level, the API refuses with counts otherwise. Moves cannot create a cycle (service check plus a database trigger with a per-ministry lock).
- **Migration** `0089_docs` (placeholder numbering rules: see the PR). No foreign key points to `contacts`, so erasing or merging a person cannot touch Docs.

## Slices

| Slice | Content | Needs |
| --- | --- | --- |
| 1 (this PR) | List with folders, search, favourites, archive and trash; editor with pages tree, toolbar, slash menu, block handles, tables, columns, banners, toggles, checklists, table of contents, page styles, protect, autosave with version check. | Done. |
| 2 | Sharing and permissions: invite people, per-doc roles, private docs, "anyone with the link" read-only public links, the Share dialog. | Public-route design, link tokens, an access table, audit. |
| 3 | Comments (open, assigned, resolved), page history and restore, Trash purge. | Comment and revision tables, notifications. |
| 4 | Relationships: link a task, person or doc from a page (Harvest CRM tasks and people). | Link table without foreign keys to contacts (erase and merge rules). |
| 5 | Templates (apply and save as), import (HTML, Markdown) and export (PDF, HTML, Markdown, print). | Sanitising importer, export service. |
| 6 | Embeds and AI writing; spreadsheets inside Docs; sermon notes for a live stream; imported Google and OneDrive documents as copies. | Provider decisions, engine audit. |

## Deferred inside slice 1 (by design)

Cover image, contributors and subtitle header toggles, relationships section, comments, share, templates, export panels (nothing is shown that does not work); selection bubble menu (the fixed toolbar covers it); keyboard reordering of blocks (pages reorder from the menu; blocks by drag); content search (search matches doc and page titles).
