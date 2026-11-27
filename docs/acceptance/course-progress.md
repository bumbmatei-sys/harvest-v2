# Courses follow-up, slice 2: stable lesson saves, learner progress and notes

Founder decision, 25 Nov 2026 (the courses follow-up list). Slice 1 (#306, migration 0130) added Level → Section → Lesson and lesson video links. This slice adds **real progress** and **student notes**, and makes lesson saves stable so both survive edits. Migration **0131** (`0131_course_progress`), chained after 0130; it is stacked on #306 and will be re-chained after main.

## Delivered

| Area | Contract |
| --- | --- |
| Stable saves | Authoring now upserts levels, sections and lessons by id and deletes only the rows the owner removed (after everything kept has moved). The catalogue position uniques are checked at commit (`DEFERRABLE INITIALLY DEFERRED`), so reorders and moves between sections do not collide midway. A kept lesson keeps its row, so progress and notes on it survive edits, renames, reorders and moves. Removing a lesson removes its progress and notes (foreign key cascade). |
| Progress | One row per (learner, lesson) in `catalog_progress`. `PUT /api/catalog/{slug}/lessons/{lessonId}/progress` `{ completed }` marks a lesson complete or not complete. The learner sees a percentage of published lessons, completed marks in the lesson list, and "Continue where you left off" on the course page (the first open lesson after the last completed one). Opening the lessons without a lesson address also starts there. |
| Notes | One private plain-text note per (learner, lesson) in `catalog_notes`, up to 4000 characters (line breaks and tabs allowed, no other control characters; checked by the API and the database). `PUT /api/catalog/{slug}/lessons/{lessonId}/note` `{ body }`; an empty note deletes it. `/account/notes` lists the learner's notes across courses, newest first, with the course and lesson titles while they are published. |
| Owner view | Owners and admins with catalogue rights see, on the course's Publish step, the enrolment count and per-lesson completion counts only (`GET /api/workspaces/{tenantId}/catalog/{itemId}/progress`). Counts of 1 to 4 are withheld by the database (`public.connect_suppress_small`, the shared small-group rule) and again by the server (`suppressSmall`). No learner, row or note is returned. |
| Shelves | Progress and notes do not depend on a community shelf: unlinking a hidden course keeps them (the learner cannot open the course meanwhile), and relinking shows them again, as with enrolment. |

## Database

- `catalog_progress` and `catalog_notes`: composite foreign key to the lesson (`ON DELETE CASCADE`), foreign key to the account (`ON DELETE CASCADE`), FORCE row security.
- The app (`harvest_app`) has **SELECT only**, on its own rows (`user_id = app.user_id`). It cannot insert, update or delete either table directly.
- Writes go through `public.catalog_learner(slug, lesson, action, body)` (SECURITY DEFINER, pinned `search_path`, schema-qualified names). It first calls `public.catalog_access(slug, 'content')`, so the same rules that decide what the learner may open (published, the hidden-shelf rule, an active grant, a published lesson) decide what they may mark. It then writes only the caller's row under its own `app.catalog_learner_tenant` flag, which it clears on entry and exit.
- `public.catalog_my_notes()` reads the caller's notes under its own flag and each ministry's titles under `app.catalog_tenant`, set and cleared per note.
- `public.catalog_progress_summary(tenant, item)` follows the 0120 pattern: it clears every other `app.*` flag for the call, checks the caller's own membership through `public.access_role(..., 'catalog', ...)` in their own ministry (owner or admin only), counts, and restores the settings. The scoped helper is not granted to the app.
- **There is no staff policy on `catalog_notes`.** The only owner-role policies on it are keyed on the caller's own `user_id`.
- `public.catalog_access` is replaced from its 0130 form with one addition: course content also returns the caller's own `completed` lesson ids and `notes` (published lessons only). The hidden-shelf path and every reset are unchanged.
- No data moves, so there is no backfill. `tests/integration/course-progress-upgrade.test.ts` still checks the migration as the NOBYPASSRLS migration owner (hook `beforeCourseProgressMigration`, idx ≤ 130): existing lessons and sections are kept, position uniques are deferrable (a swap commits, a real duplicate still fails at commit), and FORCE row security holds.

## Data export and erasure

There is no learner data export and no account deletion flow in Harvest today (audit logs are append-only and keep the account row). Progress and notes cascade with the account row and with a removed lesson, so a future erasure path that removes the account removes them too. **Gap:** a learner cannot yet export or erase their notes and progress themselves; this needs its own decision and PR.

## Evidence

- Unit: `tests/unit/course-progress.test.ts` (percentage, continue target, note rules).
- Integration: `tests/integration/course-progress.test.ts` covers:
  - only the enrolled learner writes their own rows;
  - another learner cannot read or write them, even with forged settings;
  - owners, admins and viewers read no row and no note;
  - notes are capped and plain text;
  - counts only, with small groups hidden;
  - the upsert keeps progress and notes across an edit, a reorder and a move, and a removed lesson takes its rows;
  - shelf unlink and relink;
  - two ministries;
  - definers leave no setting behind and keep a pinned `search_path`.

  `tests/integration/course-progress-upgrade.test.ts` checks the upgrade as the migration owner, and the slice-1 and catalogue integration files still pass.
- Browser: `tests/e2e/course-progress.spec.ts`. A learner completes two lessons (33%, then 67%), undoes and redoes one mark, writes a note, reloads, continues from the course page and finds the note on My notes. The owner's summary withholds counts under 5. Axe runs at 1280 and 360 in light and dark. Screenshots are in `docs/screenshots/course-progress/`.

## Not in this slice (remaining 25 Nov items, follow-ups)

Lesson attachments, Resources tab, course cover, author page, visibility work beyond hidden, unlisted and listed, and the public catalogue. Also open: a learner data export and erasure flow (above). The definers name their flags explicitly (pg_settings does not list custom settings), blank them on entry and on exit, and a test pre-sets them before each call. The routes stay off in production (`freeCatalogEnabled`). No production migration has been applied. All five HC-02 gates remain **UNAPPROVED**.
