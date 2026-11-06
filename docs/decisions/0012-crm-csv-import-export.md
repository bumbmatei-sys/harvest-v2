# ADR 0012: CRM CSV import, export, deduplication, merge and rollback

Accepted 2026-11-06 for CRM-06 (PRD v2.5 §5A.4: "CSV import/export, mapping, deduplication and rollback/error reporting"; companion PRD §5: explicit merge with preview, CSV formula injection, and a 1,000-row import that reports errors and matches deterministically).
- **Builds on:** ADR 0003 (RLS), ADR 0007 (identity), ADR 0008 (views and filters) and ADR 0010 (timeline, outbox and erasure).
- **Reference study:** Twenty was studied for behaviour only ([notes](../research/twenty-crm-reference.md#crm-06-csv-import-export-deduplication-and-merge)).
- **Number:** this is ADR 0012 because 0011 is Harvest Connect.

## Migration numbers

The migrations are `0022_crm_imports` (generated) and `0023_crm_imports_policies_merge` (custom).

**0021 is deliberately skipped:** the Campaign Wizard branch (CW-01) owns `0021_campaigns`.
- Drizzle's journal stays contiguous (entries 21 and 22) with the tags `0022_…` and `0023_…`, and snapshots are named by journal index, as the repository's migration test requires.
- If another open PR lands a conflicting number first, CRM-06 renumbers on rebase: tags, files and snapshots move together.

## Decision

1. **An import is a server-side, tenant-scoped record.**
   - `crm_imports` holds:
     - the entity (`person` or `company`) and the status (`draft` → `preview` → `running` → `completed` / `failed` → `rolled_back`);
     - a client key, unique per tenant, so re-sending the same upload returns the same import;
     - the file name, the headers, one mapping target per header, the match strategy (`skip` or `fill`), the row count and the stats;
     - creator, version and timestamps.
   - `crm_import_rows` holds one row per CSV line:
     - the raw cells as a JSON array of strings and the normalized identity keys (`email:…`, `phone:…`, `social:…`, `domain:…`);
     - the status (`pending`, `ready`, `done`, `error`, `skipped`, `rolled_back`), the action (`create`, `update`, `skip`, `error`, `conflict`), and error and warning codes;
     - the matched or created record, whether this row created it, what a fill applied, and the record's version afterwards.

   Both tables have FORCE RLS and composite tenant foreign keys (row → import, row → contact, row → company). The app gets column-scoped UPDATE grants that **exclude `raw`**, and no DELETE grant. Guards make an import's file, headers and row count immutable and a rolled-back import final. Only erasure may empty a row's cells.

2. **Limits.** At most 5 MB, 5,000 data rows, 100 columns and 5,000 characters per cell. The CSV parser is a small RFC 4180 implementation (`src/lib/csv.ts`):
   - it handles quotes, escaped quotes, line breaks inside cells, CRLF and a BOM;
   - it detects comma, semicolon or tab from the header line;
   - it adds no dependency.

3. **Mapping.** Header suggestions use a fixed synonym list per field, after lower-casing and stripping separators. There is no fuzzy matching, so the same file always maps the same way.
   - **Person targets:** name (required), email, phone, social, notes, company (name or domain) and job title (needs company).
   - **Company targets:** name (required), domain and description.
   - Each target can be used once, and "Don't import" is always available.
   - Every change autosaves with the import's version and returns the import to the mapping step, so a closed tab resumes where it stopped.

4. **Deduplication: tenant-unique identifiers only.**
   - **Validation** reuses the CRM-01/02 rules: email syntax, an E.164 phone, the handle pattern, and the normalized registrable domain.
   - **In-file duplicates:** a later row that repeats an identifier already used by an earlier row is a `conflict` (`duplicate_in_file`). The first occurrence wins, in row order.
   - **Matching against existing data:**
     - People match only on `contact_identifiers` (normalized email, phone or handle); companies match only on the normalized domain.
     - One match follows the strategy. **Skip** leaves the record alone. **Fill empty fields** adds only what the record lacks (notes if empty, identifier kinds it does not have, and a company link) and never overwrites the name or anything else.
     - Identifiers that match **two different people** make a `conflict` (`matches_several_records`). Nothing is merged.
   - **Names never match.** A same-name record is reported as a warning (`possible_duplicate_name`) and the row still creates a new record.
   - **Company links:** the person import's company cell links to a company by domain, or by exact normalized name when exactly one company has it. Otherwise it gives a warning (`company_not_found` / `company_ambiguous`) and no link.
   - **Consent:** imports never write, change or clear consent. An editable email match therefore cannot clear an opt-out (v1 lesson); a test records a withdrawal, imports with "fill", and checks that the withdrawal still wins.

5. **Dry run, then commit in chunks.**
   - **Preview** classifies every row against live data with set-based queries and stores the outcome. Nothing outside the import changes.
   - **Commit** processes the next 200 `ready` rows per request, in row order:
     - each row is **re-decided against the database at that moment** and written in its own savepoint;
     - a row whose identifier was taken in the meantime is skipped or reported (`identifier_taken` / `changed_since_preview`) and does not undo the others;
     - the client calls again until `remaining` is 0, so progress is real and an interrupted import resumes. A repeated call never repeats a finished row.
   - **Finalizing:**
     - writes the counts;
     - sets `completed`, or `failed` when nothing was created or updated and at least one row failed;
     - audits `crm.import.completed` / `crm.import.failed`;
     - appends the outbox event of the same kind (key `crm:import:{id}:{status}`, **counts and ids only**).
   - Each created or updated record is audited as `contact.create` / `company.create` / `contact.update` with `importId` in the metadata.

6. **Partial failure and the error report.** Successful rows stay committed. The problem report (`GET …/imports/:id/report`) is a CSV of every row not imported: the row number, the original cells and a plain-English reason. Cells are formula-safe (§8).

7. **Rollback is batch-scoped and conservative.** `rollback_crm_import(tenant, import)` is a SECURITY DEFINER function. It is callable by owners and admins, or by the member who created the import, and only on a `completed` or `failed` import, once.
   - A record **this import created** is deleted only if it is still at the version the import left **and** has no children of its own: no consents, tasks, notes, deals, custom values, relation values pointing at it, other company links, or rows from other imports.
   - A **fill** is reverted (notes emptied, identifiers it added removed, the link it added removed) only if the record is still at the post-import version.
   - Everything else is **kept and counted**. The result is `{removed, reverted, kept}`, the import becomes `rolled_back`, and the audit row `crm.import.rolled_back` and the outbox event `crm.import.rolled_back` are written.
   - Rollback never touches consent, and never deletes a record a person has worked on.

8. **CSV injection.**
   - Export (and the problem report) prefix any cell beginning with `=`, `+`, `-`, `@`, tab or carriage return with a single quote, which spreadsheet apps show as text (OWASP guidance). This also applies to phone numbers starting with `+`.
   - Import never evaluates anything. It strips only a leading quote that guards one of those characters, so a Harvest export round-trips.

9. **Export agrees with the list.**
   - `GET …/crm/export?entity=person|company&<view params>` builds its `WHERE` and `ORDER BY` through the **same functions as the People and Companies lists** (`peopleQuery` / `companiesQuery`), including the search, every filter and `marketingEmailState`. It runs in one transaction.
   - The dialog's count endpoint uses the same predicate. Tests assert that list total = count = exported rows for search, consent, custom-field and sort views.
   - **People columns:** name, email, phone, handle, primary company and job title, email-marketing state, created and updated, then active custom fields as text (option labels and related names).
   - **Companies columns:** name, domain, description, people count, dates and custom fields.
   - **Field permission:** the free-text **Notes** column is exported only for owners and admins (`crm:export_sensitive`). Erased people are excluded, as on the list.
   - Each export audits `crm.export.created` with the entity, row count and whether it was filtered. The cap is 50,000 rows; a larger view must be narrowed.

10. **Explicit merge (people).** This is owner and admin only (`contacts:merge`).
    - **Preview** (`GET …/contacts/:id/merge?sourceId=`) counts what would move or be dropped. It covers identifiers (kinds the kept person already has are dropped), company links, consent events, tasks, notes, deals, custom values, and whether the notes text is copied.
    - **Confirm** (`POST`) requires both versions the preview showed, then calls `merge_contacts(tenant, kept, merged)`, a SECURITY DEFINER function. It moves the following to the kept person in one transaction:
      - the identifiers it lacks and the missing company links;
      - **every consent event** (the ledger stays complete, so an outstanding withdrawal still wins);
      - tasks, notes and deals;
      - custom values for live fields it lacks, and relation values that pointed at the merged person;
      - import rows;
      - the notes text, when the kept record has none.

      It writes `contact.merge` and then **erases the merged person through `erase_contact`**, so no row keeps their id and their own change history leaves with them.
    - **Outbox:** `crm.merge.completed` carries the kept id and counts, never the merged id (its key is random, because erasure cannot scrub keys).
    - **Guards:** two narrow exceptions let the merge definer re-parent consent events and notes. They apply only while the merge is running for that person: `current_user` must be the function owner and a transaction-local `app.merge_source` must match. They fail closed when the setting is unset, which is tested. Every other path still raises.
    - Companies are not merged in this slice.

11. **Permissions.**

    | Permission | Who | What it allows |
    | --- | --- | --- |
    | `crm:import` | owner, admin, member | run imports |
    | `crm:export` | owner, admin, member | export lists |
    | `crm:export_sensitive` | owner, admin | the Notes column in exports |
    | `contacts:merge` | owner, admin | merge people |

    Viewers get 403 for all of them, in the service and over HTTP. The Imports navigation link is hidden for viewers.

12. **Erasure.** `erase_contact` (replaced in 0023) also empties the cells and identity keys of every import row:
    - that matched or created the person;
    - or that carries one of the person's identifiers, including rows that failed validation.

    It does this before the identifiers are deleted, so nothing in an import points at or contains the erased person. The merge and rollback definers have `erasure_owner_tenant` policies on `crm_imports`, `crm_import_rows`, `companies` and `crm_field_definitions`. Both are tested under a non-superuser, non-BYPASSRLS owner, as on Neon.

## Deviations and limits

- **Raw rows are kept** for the import's problem report and rollback; there is no retention job yet (soft follow-up).
- **There is no custom-field or consent import.** Consent needs evidence and provenance that a CSV cannot honestly carry.
- **People-only merge.** There is no company merge and no multi-record merge.
- **There is no in-place mapping of select options or relations**, because custom fields are not import targets.
- **The upload is a JSON body (≤ 5 MB)**, not an R2 object. The raw file is not stored, only its rows.
- **Exports are built in memory** (≤ 50,000 rows) inside one snapshot, not streamed.
- **Out of scope:** the CRM-05 soft follow-ups F1 and N1–N8 are untouched, as are CRM-07+ and Connect.
