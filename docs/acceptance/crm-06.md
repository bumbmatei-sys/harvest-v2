# CRM-06 acceptance record: CSV import, export, deduplication, merge and rollback

Date: 2026-11-06. Scope: PRD v2.5 §5A.4 CRM-06 ("CSV import/export, mapping, deduplication and rollback/error reporting") and companion PRD §5:
- 1,000-row import with deterministic errors and matching;
- merge with child records and an explicit preview;
- CSV formula injection;
- soft-deleted or archived items;
- GDPR-aware export.

Design: [ADR 0012](../decisions/0012-crm-csv-import-export.md). Reference study: [Twenty and v1 notes](../research/twenty-crm-reference.md#crm-06-csv-import-export-deduplication-and-merge).

**Migrations:** `0022_crm_imports`, `0023_crm_imports_policies_merge`. 0021 is reserved for CW-01 (`0021_campaigns`). 0022 may need renumbering on rebase if another open PR lands a conflicting number first.

**Out of scope, unchanged:**
- CRM-05 soft follow-ups F1 (erased-person names in task text) and N1–N8;
- CRM-07 / CRM-08;
- email and calendar sync, Social Studio, AI, Connect (HC-*), the Campaign Wizard (CW-*) and the Eden switcher;
- auto-merging on a name or an editable email.

## What a user can do

- **Imports** (`/workspaces/:tenantId/crm/imports`; "Imports" in the CRM sidebar for owners, admins and members, hidden for viewers). It shows the import history (file, type, status, result, author, date) or an empty state.
- **Import from People or Companies.** An **Import** button opens the upload dialog with that type preselected. The file is chosen there: a CSV of up to 5 MB and 5,000 rows, with comma, semicolon or tab separators.
- **Step 1, map columns.**
  - Each column of the file shows sample values and a "Harvest field" select. The suggestions are deterministic, and "Don't import" is always available.
  - Problems such as "Map a column to Name" are listed, and Preview stays disabled until they are fixed.
  - The match strategy is a choice between **Skip it** and **Fill empty fields**.
  - Every change autosaves, so a closed tab resumes on this step.
- **Step 2, preview.** Nothing has been saved yet.
  - The counts show New, Updates, Skipped and Problems, with tabs to filter the rows by outcome. Each row shows its outcome and reason:
    - "Matches *name*" (with a link to the record);
    - "An earlier row in this file has the same email…";
    - "The email address is not valid.";
    - "Its email, phone or handle belong to different people. Nothing was merged.";
    - "No company matches…".
  - **Change mapping** returns to step 1.
- **Step 3, import.** "Import N rows" runs in 200-row chunks with a real progress bar. An interrupted import shows **Resume import**; rows already done are never repeated.
- **Step 4, results.** Created, Updated, Skipped and Not imported counts, the row outcomes, **Download problem report** (a CSV of every row not imported with the original cells and the reason), and **Open People/Companies**.
- **Roll back import** (behind a confirmation that says exactly what it removes, reverts and keeps). The result reads "rolled back: N removed, N reverted, N kept because they changed afterwards".
- **Export** on People and Companies (owners, admins and members):
  - the dialog shows how many records the **current view** will export;
  - whether Notes are included (owner or admin) or left out;
  - and that erased people are never included and formulas are neutralized.
  - **Download CSV** downloads exactly that view.
- **Merge** (owners and admins): **Merge…** in the person header, and **Merge** next to each same-name suggestion.
  - The dialog previews what moves to the kept person (identifiers, links, consent records, tasks, notes, deals, custom values) and what is not kept.
  - **Merge and erase duplicate** confirms.

## Security and data rules verified

- **FORCE RLS** on `crm_imports` and `crm_import_rows`, with composite tenant FKs and no DELETE grant. The raw cells cannot be updated by the app; only erasure empties them.
- **Two tenants, both directions:**
  - **Services and SQL** (`tests/integration/crm-imports.test.ts`): get, preview, commit and rollback across tenants give 404, or 403 for a foreign workspace. Raw select, update and insert of another tenant's import or rows are refused.
  - **HTTP** (`tests/e2e/crm06.spec.ts`): A's user against B's import and B's against A's (403 or 404), plus export by an outsider (403).
- **Permissions:**
  - viewers get 403 for upload, list, export and merge (service and HTTP), and see no Import or Export buttons and no Imports link;
  - members get 403 for merge;
  - a member cannot roll back an owner's import;
  - the SQL definers refuse non-owner/admin callers themselves.
- **Deduplication:**
  - matches use only tenant-unique normalized identifiers; names never match;
  - a row matching two people is a conflict and both people are left untouched;
  - later in-file repeats are conflicts;
  - an identifier taken between preview and commit is re-decided and never duplicated (tested).
- **Opt-outs:** an import with "fill" on a person who withdrew marketing consent leaves the withdrawal effective, in the record's effective consent and in the list filter.
- **1,000 rows:** one 1,000-row CSV, imported into two different workspaces, gives identical per-row outcomes and counts. That is 5 commit calls of 200 rows. The known error rows are at the expected row numbers:
  - invalid email every 97th;
  - duplicate every 50th;
  - missing name every 113th;
  - invalid phone every 131st.

  The problem report has exactly one line per problem row.
- **Formula injection:** export and the problem report prefix `=`, `+`, `-`, `@`, tab and CR cells with `'` (for example `'=SUM(A1:A9)`, `'+4915…`). Import stores formulas as text and never evaluates them.
- **Export = list.**
  - For the unfiltered, search, `marketing~any_of~withdrawn`, custom-select and sorted views, the export row count equals the list total and the count endpoint, and the export rows are in list order.
  - Erased people are never exported.
  - Notes are only in owner and admin exports.
- **Rollback.** It removes only untouched records the import created, and reverts fills only on records still at the post-import version. A record edited after the import, or one that gained a task, is kept. A second rollback is 409.
- **Merge.**
  - **Moves to the kept person:** identifiers, links, consent events (the withdrawal still wins), tasks, notes, deals, custom and relation values, and the notes text.
  - **The merged person:** erased (404), with no remaining reference to their id in identifiers, links, consents, tasks, notes, deals or relation values.
  - **Audit and outbox:** audit `contact.merge` then `contact.erase`; the outbox payload has no merged id.
  - **Version checks:** a stale version gives 409, and self-merge gives 400.
  - **Guards:** consent events and notes cannot be re-parented outside the merge definer, even by a superuser session or with a forged setting.
- **Definers without superuser or BYPASSRLS.** Merge and rollback work when owned by a `NOSUPERUSER NOBYPASSRLS` role under FORCE RLS, and erasure's restricted test now also covers `crm_import_rows`.
- **Erasure** empties the cells and keys of import rows that matched or created the person, or that carry one of their identifiers (including a row that failed on another field). This holds on fresh and upgraded databases.
- **Outbox:** `crm.import.completed|failed|rolled_back` and `crm.merge.completed` carry counts and ids only (asserted: no names or emails).

## Commands and results (this branch)

Database-backed tests used `TEST_DATABASE_URL` against a local PostgreSQL 16, as in CRM-01 to CRM-05. Browser runs used an uncommitted local Playwright config (Chromium at `/opt/pw-browsers/chromium`) against `scripts/e2e-server.ts`.

| Command | Result |
| --- | --- |
| `npm run lint` | exit 0; ESLint and source guards clean |
| `npm run typecheck` | exit 0 |
| `npm test` (unit) | 14 files, **156 passed** (new: `crm-import.test.ts`, 11: CSV reading and writing, formula safety and round trip, mapping, validation, identity keys, permissions) |
| `TEST_DATABASE_URL=… npm run test:rls` | 23 files, **228 passed** (new: `crm-imports.test.ts`, 14; `crm06-upgrade.test.ts`, 1; `erasure.test.ts` restricted definer extended to `crm_import_rows`) |
| `npx drizzle-kit check` / `generate` | "Everything's fine" / "No schema changes, nothing to migrate" |
| `npm run build` | exit 0; `public/offline.css` regenerated and committed |
| `npx playwright test` (13 tests) | full run: **12 passed, 1 failed**. The failure is `pr01b.spec.ts`, the known dev-only flake recorded in CRM-05: Next's dev "issues" badge covers the sidebar toggle. It passed when rerun alone. `crm06.spec.ts` passed in the full run and twice alone. |

`npm run test:rls:neon` was **not** run (no Neon credentials; not authorized).

## Browser proof (`tests/e2e/crm06.spec.ts`)

1. People → **Import** → upload dialog (People preselected) → choose a 5-row CSV. Then, from the keyboard, upload and map: the suggested mapping is Name, Email, Phone, Company and Job title. Switching the match strategy autosaves ("Saved").
2. **Preview** (keyboard). The counts are New 2, Skipped 1 and Problems 2, with the rows "Matches Synthetic Existing" and "No company matches…". Nothing is created yet (API check). The Problems tab shows the in-file duplicate and the invalid email.
3. **Import 2 rows** (keyboard), then **Results**. Created 2 and Not imported 2. The downloaded problem report has the header `Row,Full name,…,Problem` and rows 3 and 5.
4. The new person is on the People list. Exporting the `q=Synthetic` view counts N in the dialog and downloads a CSV whose header is the People column set and whose row count equals the list total. The phone appears as `'+49…`.
5. **Merge** from the same-name suggestion. The preview shows the phone that moves; after confirming, the duplicate is gone (404) and the kept person has both identifiers.
6. **Roll back import** shows "2 removed, 0 reverted, 0 kept", and the imported person is gone. The history shows "Rolled back".
7. A second account: HTTP isolation in both directions. As a viewer: no Export, Import or Imports, and 403 for imports, export and merge.
8. Layout: the results page and the People, Companies and Tasks lists keep the full-width shell at 390 and 1440. axe finds no violations at every capture, and the page logged no errors.

Screenshots (`docs/screenshots/crm06/`):
- `import-upload-light`
- `import-map-{light,dark}`
- `import-preview-{light,dark}`
- `import-preview-conflicts-light`
- `import-results-{light,dark}`
- `export-dialog-{light,dark}`
- `merge-dialog-light`
- `import-rolled-back-light`
- `imports-history-{light,dark}`
- `import-390-light`

## Migration notes

- `0022_crm_imports` (generated): the two tables with checks and indexes (including a GIN index on the identity keys).
- `0023_crm_imports_policies_merge` (hand-written):
  - RLS, grants and the definers' tenant policies;
  - the `guard_crm_import` and `guard_crm_import_row` guards;
  - the `rollback_crm_import` and `merge_contacts` functions;
  - replacements for `guard_consent_redaction` (0008's rule plus the merge branch) and `guard_crm_note` (0020's version plus the merge branch);
  - `erase_contact` (0020's version plus the import-row scrub).
- Upgrade: `tests/integration/crm06-upgrade.test.ts` seeds a database at 0020 (post-CRM-05) with two people, an identifier, a task and a note. It then upgrades, imports (match and create), exports, merges the twin with its task and note, rolls back and erases.
- Rollback before deploy:
  - drop the two tables, the four new functions and the new policies;
  - restore `guard_consent_redaction` from 0008, `guard_crm_note` and `erase_contact` from 0020.

  No production data exists, and no production Neon, R2 or Vercel settings were touched.

## Deviations, limitations and soft follow-ups

- Raw import rows are kept until erasure scrubs them; there is no retention job (soft follow-up).
- Imports do not set custom fields or consent; there is no company merge; exports are built in memory up to 50,000 rows.
- CRM-05 soft follow-ups F1 and N1–N8 remain open and are not part of this PR.
