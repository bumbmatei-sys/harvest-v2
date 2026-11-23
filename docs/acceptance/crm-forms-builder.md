# CRM forms builder acceptance

Branch `feat/crm-forms-builder`. Screens only plus the minimum server glue that already fits existing tables. **No migration, no public form, no response storage.** All five HC-02 activation gates remain UNAPPROVED; nothing here sends a message, calls a provider or collects real data, and nothing is published or deployed.

## What is done

- **Forms list** (`/workspaces/:id/crm/forms`, Operations > People > Forms, owners and admins): three template cards, a table (Name, Saves to, Created by, Last viewed, row menu with Open and Duplicate), Search, Sort (recently opened, recently edited, name, newest), a New form button and an empty state. Favorites (star) and Recents are in the contextual sidebar (the same slot the Inbox uses, behind the shell-modes flag); without the flag the panel sits inline beside the table. Favorites, recents and "Last viewed" are per-browser (`localStorage`, guarded); nothing is stored on the server.
- **New form** (`/crm/forms/new`): a 3x2 template grid (Prayer request, Event registration, Volunteer sign-up, Feedback, Visitor card, Start from scratch), then "Where should submissions be saved?" with a searchable destination list (People, Organizations, each pipeline). The chosen template is kept in the address. Picking a destination creates the draft and opens the editor.
- **Editor** (`/crm/forms/:id`): top bar with the responses count, Build / Settings / Preview, open, Copy (Copy link) and Publish; save status, Undo and Redo (also Ctrl/Cmd+Z, Shift for redo, outside text fields).
  - **Build**: Add cover (token-based presets), logo (https address), title and description; the Start page and End page rail; the Add question menu (search, groups Short text, Long text, Dates, Single-select [Dropdown, Choice list, Checkbox, Rating, Yes or no], Multi-select, Contact info [Email, Website, Phone, Location], Uploads, Number [Number, Money], Signature, Layout > Information block, and "Save to CRM field" submenus: Name, Email, Phone, Organization, Social handle, Notes, one block per field); blocks reorder by **drag** (pointer, touch and keyboard sensors, screen-reader announcements) and by **Move up / Move down** buttons; the **consent block is mandatory**: it is pinned last, cannot be dragged or removed, its text is editable, and the schema rejects a form without it.
  - **Settings**: After submitting (Save to destination, Assign owner, Labels), Submission settings (Redirect URL https only, Button label, Show resubmit, Spam check, Attach campaign, Attach QR source), Layout (One column, Two column, One per page), Colors (Light/Dark, background swatches, button colour; all theme tokens), View settings (default landing Preview or Build). There is no branding toggle.
  - **Preview**: the form as a respondent sees it; **One per page** (not the default) has a welcome screen, progress, Next, Back and Enter, per-step validation, a thank-you screen with answer recall (`{name}`) and the resubmit option. Nothing is saved or sent; the end screen says so. Hidden fields (campaign, QR source) are stored as settings for the hosted form to attach.
  - **Autosave** of the draft (900 ms debounce, revision check, 409 on a stale save, retry, leave guard while unsaved).
- **Server (existing tables only)**: a form is a `forms` row with one **draft** `form_versions` row whose `definition` is kind `crm-form-v1` (Zod schema in `src/lib/crm-forms.ts`, 64 KB table cap). `src/server/crm-forms.ts`: list, create from template, get, save with revision, duplicate; owner/admin only (new permission `crm:forms_manage`, same roles the forms tables' RLS policies already allow); destinations are checked against the ministry's own pipelines; audit rows for create and duplicate. API: `GET/POST /api/workspaces/:id/crm/forms`, `GET/PUT /api/workspaces/:id/crm/forms/:formId`, `POST .../duplicate`. Connect intake reads only `connect-intake-*` kinds and published versions, so the two never mix.

## Update: publishing wired (follow-up PR)

Items 1 and 3 below are now wired to the hosted-forms server (PRs #190 and #195), which remains hard-off in production: the bar shows the real response count and a Draft / Published / Unpublished badge; Publish opens a confirmation (the version is frozen, the consent text becomes its privacy notice, the address is chosen once and then fixed); Unpublish confirms and keeps collected responses and the reserved address; Copy link and Open work once published; editing a published form shows "Published, unpublished changes" and Publish changes. Autosave and revisions are unchanged (the server starts a new draft version after a publish). Where the server answers 404 (production, or outside synthetic mode) the controls show a neutral notice and change nothing. Evidence: `tests/e2e/crm-forms-publication.spec.ts` (publish, bad and reserved address, copy, count after a real submission, republish, unpublish, unavailable state, named form in the People source filter; axe and overflow at 360, 768 and 1280 in light and dark), screenshots in `docs/screenshots/crm-forms-publication/`. The e2e server now sets `HARVEST_CRM_FORMS=synthetic` with a random key on its disposable `harvest_test` database. No new kit-derived UI: AlertDialog, Badge, Button, Input and DropdownMenu are the existing shared components. Still open and unchanged: public form rate-limit shape, response retention and purge schedule, consent wording, and all five HC-02 gates.

## What the server lacks (deferred, reported precisely)

The hosted form and its submission path do not exist and are **not a small glue job**, so they were not invented:

1. **Publish / Unpublish and Copy link / Open**: `form_versions` can only publish with a privacy notice version, offered purposes and a pending-data retention window (Connect semantics, trigger-enforced), and `forms` has no UPDATE grant (no rename, archive or slug). A CRM form needs its own published state and public address. The buttons are present, focusable, announced as unavailable (`aria-disabled`) and show a notice; nothing is faked.
2. **A public route and anonymous access**: reading a published form and writing a response without a session needs a SECURITY DEFINER resolver and insert path, rate limiting and spam handling (the Spam check setting is stored only).
3. **Response storage and the responses count**: there is no submissions table; the bar shows 0.
4. **Save to CRM on submit**: creating or reusing a person (and organization), the consent record, owner assignment, labels and hidden-field source attachment must go through the existing consent gate and HC-06 association rules. The mapping, owner, labels and destination are captured in the definition so that path can read them. CRM "lists" do not exist; the destinations are People, Organizations and pipelines (labels are free text, there is no tag table).
5. **File uploads** and **branching, ranking, payments, server-side partial answers**: out of scope by instruction. The Files block shows an inert drop zone that says uploads are not available; the signature pad keeps the drawing in memory only.

The definition size is bounded (see Size limit below). A follow-up migration would be 0076+ (check `drizzle/meta/_journal.json`, 0075 is the Office server PR): published form state and slug, a responses table with FORCE RLS, and definers for public read and insert.

## Reuse and exceptions

- Reused: `DataTable`, `EmptyState`, `Collapsible`, `Popover`, `DropdownMenu`, `Tabs`, `Progress`, `NativeSelect`, `useContextualSidebar` (editor-context), `useUnsavedChangesGuard`, `useCrmRequest`, the navigation registry (one entry, `crmForms`), `withTenant`, the `forms` and `form_versions` tables, `notify`. The question list in Communities (`QuestionListEditor`) was inspected and **not** extended: it is a four-type flat list with no mapping, drag, layout or per-page mode; this builder's block schema is a superset, and the Communities consumer stays on its own contract (a migration of it to the new block model is a possible later step).
- **EditorShell exception**: EditorShell is a step-sequence layout (steps, centre, preview column). The requested layout is top Build / Settings / Preview tabs with a settings sidebar, so the page composes the shared pieces directly and registers nothing with the editing sidebar.
- New shared pieces with real consumers: `PublicForm` and `FormField` are used by Preview and the Settings canvas (and will be the hosted form's renderer); the three kit blocks are used by `FormField`.
- Provenance: see `docs/ui-sources.md` (CRM forms builder). Founder rule (21 Nov): paid kit where suitable, otherwise free. Radio and checkbox cards derive from premium `form-layout20` (50% identical lines each), the drop zone from premium `form-layout15` (55%); rating and signature have no suitable kit item (reasons in ui-sources.md) and are Harvest-written. No product code, text, icon or branding from the reference screenshots is used.
- Dependencies (founder-approved 21 Nov): `@dnd-kit/sortable` 10.0.0, `@dnd-kit/modifiers` 9.0.0, `@dnd-kit/utilities` 3.2.2.

## Evidence

- `tests/unit/crm-forms.test.ts` (17): schema, consent pinned last and mandatory, mapping and option rules, https-only addresses, move/insert/remove, validation, recall, one-per-page steps, undo history, list preferences. `tests/unit/navigation.test.ts` updated (Forms is owner/admin only and the only change to the sidebar link set).
- `tests/integration/crm-forms.test.ts` (6, local PostgreSQL, RLS as the app role): create, list, load, save with revision (409 on stale, invalid rejected), pipeline destinations scoped to the ministry, duplicate, owner/admin only, no cross-ministry read, drafts only.
- `tests/e2e/crm-forms-builder.spec.ts`: template to destination to editor, add by search and by submenu, Move up/down, Undo/Redo, **keyboard drag** (Space, ArrowUp, Space), consent cannot be removed, settings, publish notice, one-per-page preview (validation, Back, Enter, consent, recall in the thank-you), autosave persisted after reload, stale save 409, list star/search/sort/duplicate, anonymous 401. axe (WCAG 2.2 AA) and no horizontal overflow at 360, 768 and 1280 in light and dark for the list, new-form, Build, Settings and Preview screens.
- Screenshots: `docs/screenshots/crm-forms-builder/` (list-empty, list, new-destination, build, settings, preview; phone/tablet/desktop; light/dark).
- The e2e saw and fixed three real defects: the template was lost on reload (now in the URL), the add-question search kept its text after a pick, and unsaved edits inside the debounce window were not guarded on leave.

- Full runs on this head: lint, source guards and typecheck clean; unit 1400 passed; integration 117 files, 989 tests passed (local PostgreSQL); Playwright: the builder spec, `kit-pr2-shell` and `layout` (6 tests) passed. The Neon check does not apply (no migration).

## Size limit

`form_versions.definition` has a 65,536-byte table check. The schema alone allowed about 92 KB, so create, save and duplicate now measure the serialized definition and answer 400 ("This form is too large to save...") before the database check can fail; the editor shows that message and does not retry (retrying cannot help).

## Reproducing the provenance measurements

Fetch each premium item (`curl -s https://shadcnuikit.com/r/<item>.json`, concatenate the `files[].content` into a file, here `fl20.tsx` for `form-layout20` and `fl15.tsx` for `form-layout15`) and run `scripts/ui-identical.sh <kit-file> <harvest-file>`. Output on this head:

```
15 of 30 (50%) src/components/forms/kit-radio-cards.tsx      (form-layout20)
15 of 30 (50%) src/components/forms/kit-checkbox-cards.tsx   (form-layout20)
10 of 18 (55%) src/components/forms/kit-drop-zone.tsx        (form-layout15)
```

## Known limits

- Colour swatches use theme tokens, so the form follows the active theme; a "chart" button colour can have lower contrast in a custom theme (the default button and the checked screens pass axe).
- "Created by" shows the user's name or email; "Last viewed" is this browser only.
- The Settings canvas shows the start of the form (in One per page mode, the welcome screen).
- No real outbound messages, webhooks or provider calls anywhere in this change.
