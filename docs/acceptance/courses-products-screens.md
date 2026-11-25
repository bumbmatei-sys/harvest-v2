# Courses and products screens

Screens for the free catalogue server ([free-courses-products](free-courses-products.md), migrations 0061 and 0067). The server is hard-off in production, so these screens are too: they are reachable only where `freeCatalogEnabled()` is true (non-production, Communities on). Founder priority of 25 Nov: finish the screens first, polish the design later. Design is the [proposal](../superpowers/specs/2026-11-17-free-courses-products-design.md) plus the Eden type picker (structure only); style is Studio Admin through the shared Harvest components and the kit items approved on 25 Nov (recorded in `docs/ui-sources.md` and `src/lib/ui-provenance.ts`). All five HC-02 gates stay **UNAPPROVED**. Free only: no price, checkout or coupon anywhere.

## Requirement to screen

Status: **Done** (built in this PR), **PR 2** (public and learner screens, stacked on this PR), **Next** (needs a server slice, recorded below).

| # | Requirement (source) | Screen or component | Status |
| --- | --- | --- | --- |
| 1 | Owner list of courses and products with status, search, empty state (task 1) | `/workspaces/{id}/products` (all) and `/courses` (courses only), `CatalogList` on `DataTable` and `StatusBadge`, `EmptyState` | Done |
| 2 | Nav entries `courses` and `products` live only behind the feature gate (task) | `navigation.ts` entries get `feature: "catalog"`; the workspace layout reports `catalog` from `freeCatalogEnabled()` | Done |
| 3 | New product type picker; each supported type has its own art (task, Eden products-013/032/033) | `/products/new`, `CatalogTypeCards` with `CatalogTypeArt` for course and download (the only kinds the server has), tokens `--art-N-*` only | Done |
| 4 | Editor in the shared `EditorShell` with a stepper (spec section 8) | `CatalogEditor`: Details, Lessons or Files, Access, Publish. The spec's separate Page step is the live preview card instead | Done |
| 5 | Course: ordered lessons, reorder, add, remove, rich text, per-lesson published flag (server: `lessons[]`) | Lessons step: `LessonListEditor` with move up/down, `RichTextEditor`, published switch | Done |
| 6 | Course: video link and document per lesson (task) | Not supported by the server (a lesson holds a title, a published flag and sanitized rich text; no video field, no lesson files). A video or document link goes into the rich text as a link | Next |
| 7 | Course progress settings (task) | No settings exist server-side. See 20 | Next |
| 8 | Download: protected files through the existing private file service (server: `fileIds[]`) | Files step: `CatalogFilePicker` lists the ministry's private files (ready, scanning, rejected shown as such), uploads through the same signed-slot flow as Files, reorders and removes | Done |
| 9 | Access step: visibility hidden, unlisted, listed; free for signed-in people (spec 6) | Access step radio group; copy states free access only | Done |
| 10 | Publish step: checklist from the server rules (title, address, visibility not hidden, one published lesson or one ready file), publish, return to draft, archive with the expected version | Publish step and header action; Publish needs a saved draft | Done |
| 11 | Optimistic concurrency: stale version shows "changed elsewhere, reload" | `CatalogEditor` conflict alert (409), unsaved-changes guard | Done |
| 12 | Owner and admin author; member and viewer read editorial metadata only (spec 8, `catalog:manage`) | List for every role; "New" and the editor controls only for owner and admin; member and viewer see a read-only summary | Done |
| 13 | Give a community's members the item: same-ministry shelf link (server `PUT/DELETE .../communities/{id}/catalog/{item}`) | Access step "Community shelf": one switch per ministry community. Linking confers no access (server doc, spec 2); the copy says so. Adds a read of an item's linked community ids to the author draft read | Done |
| 14 | Community classroom and products tab entry points (task, PRD C13 and C16) | No community-side reader of linked items and no `community_included` grant exist. Needs a C13/C16 server slice | Next |
| 15 | Public catalogue and detail pages, sign-in to enrol (spec 6) | `/courses/{slug}` and `/products/{slug}` (kind-checked), Discover Courses and Products tabs | PR 2 |
| 16 | Free enrolment, then learner view with lessons (server enrolment and content routes) | `/courses/{slug}/learn` | PR 2 |
| 17 | Protected downloads, 60 second URLs (server file route) | Download rows on `/products/{slug}` after enrolment | PR 2 |
| 18 | Study progress in the learner view (task, kit study-progress card) | The card shows the learner's place (lesson n of m), which is real. Completion marks need a server slice | PR 2 and Next |
| 19 | Copy: concise, provider-neutral, "ministry", no payments, no routine helper text under fields | Message namespace `Catalog`; source guard passes | Done |
| 20 | Learner progress, questions, workshops, community-link products, Discover for these types beyond the listing, payments | Server slices C4 and later; not in the catalogue server today | Next |

## Cross-cutting acceptance

- Reuse: `AppShell`, `EditorShell` (with the editing sidebar), `WizardLayout`, `FormSection`, `StickySaveBar`, `DataTable`, `EmptyState`, `StatusBadge`, `RichTextEditor`, `RichTextView`, `ConfirmDialog`, `AccessState`. New shared pieces: `CatalogTypeArt` (real consumers: type picker, list rows, editor preview, public detail) and `CatalogFilePicker`.
- Full width, 44px tap targets below 1024px, light and dark, theme tokens only (no fixed colour), axe clean at 360, 768 and 1280 in both schemes. Screenshots in `docs/screenshots/courses-products/`.
- Permissions: server enforces everything; the screens only hide controls (`can(role, "catalog:manage")`). A denied or missing item shows the same unavailable state.
- No payments, no real messages, no provider calls. The server stays hard-off in production.

## Open questions for the founder

1. **Linking is not access.** The server doc says a community shelf link confers no access, and the design says included access is a later `community_included` grant. The Access step therefore offers "Community shelf" (show in the community) and not "give members access". Should a member of a community get automatic access to its shelf items (needs C16)?
2. **Learner progress.** Completion needs a table and routes (migration 0112 or later). Build it next, before more screens?
3. **Lesson video and documents.** Add a video link field (YouTube click-to-load rules from the Live design) and lesson file attachments to the server, or keep links inside the rich text?
4. **Public catalogue.** Only Discover lists public items (needs owner opt-in and platform approval). Should a ministry also have a public catalogue page of its own?
5. **Route names.** `/courses/{slug}` and `/products/{slug}` are proposed here (the design left public routes to the routing owners).
