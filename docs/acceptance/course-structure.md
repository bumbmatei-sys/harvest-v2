# Courses follow-up, slice 1: course structure and lesson video

Founder decision, 25 Nov 2026: Levels, Sections and Lessons with the course's own names (and renameable labels such as "Week"); VK or YouTube video in lessons; attachments; Resources tab; student notes; real progress; cover; author page; visibility; public catalogue. This slice delivers the first two items only. Migration **0130** (`0130_course_structure`).

## Delivered

| Area | Contract |
| --- | --- |
| Structure | A course is Level → Section → Lesson. Levels are optional: a course without levels (every course before 0130) works as before. Every lesson sits in a section; level and section titles may be empty, and the screens then show the course's label and number ("Week 2"). Up to 10 levels, 50 sections and 50 lessons per course. |
| Labels | Each course can rename its levels, sections and lessons (for example "Module" and "Week"). Stored per course on `catalog_items` (`level_label`, `section_label`, `lesson_label`); null is the default label; 1 to 24 characters, no control characters; downloads cannot carry labels (database check). A save without labels keeps the stored ones. |
| Ordering | Up and down buttons (the existing catalogue pattern, no drag library). At the edge of a section a lesson moves into the previous or next section; a section moves the same way across levels. Positions run across the whole course, so the learner's lesson order stays the single lesson position it always was. |
| Editor API | `PUT /api/workspaces/{tenantId}/catalog/{itemId}` and `POST .../catalog` accept a course as `levels` (each with `sections`), as `sections`, or as the original flat `lessons` (which become one untitled section). Supplied level, section and lesson ids must belong to the same course and appear once; anything else is the same unavailable answer as a missing item. |
| Video | The owner pastes a video link. The server parses it to a strict allow-list (youtube.com/watch, youtu.be, youtube.com/embed, youtube-nocookie.com/embed, vk.com/video…, vkvideo.ru/video…, and the `video_ext.php` embed form of both) and stores only `video_provider` (`youtube` or `vk`) and `video_id`, never the link or any HTML. Other schemes (`javascript:`, `data:`), other hosts, look-alike hosts, credentials, ports and malformed ids are refused; the database checks the stored id shape. |
| Learner | `catalog_access(..., 'content')` now also returns the course labels, the levels and sections that hold a published lesson (in course order), and each published lesson's section and video. The learner's side list groups lessons under level and section headings; a course that is one untitled section shows the plain list. "Lesson n of m" uses the course's lesson label. |
| Video player | A click-to-load facade: nothing is requested from the video host (no frame, thumbnail or script) until the learner presses play. The frame then loads `https://www.youtube-nocookie.com/embed/{id}` or `https://vkvideo.ru/video_ext.php?oid=…&id=…`, with a sandbox and the origin as the only referrer. UI copy says "video link"; provider names appear only in the owner's own link. |

## Database

- New tables `catalog_levels` and `catalog_sections`: composite tenant/item foreign keys to `catalog_items` (kind `course` only), section → level and lesson → section composite foreign keys inside the same course, FORCE row-level security, and the grants and policies of `catalog_lessons` (`catalog_staff_write` through `public.catalog_staff`, which asks `public.access_role` since 0113; a read-only `catalog_resolver_scope` for the catalogue definer keyed on `app.catalog_tenant`).
- `catalog_lessons.section_id` (not null after the backfill), `video_provider` and `video_id` with a shape check.
- Backfill: one untitled section per course that has lessons; every lesson keeps its position. The tables force row security, so the backfill lifts FORCE for its block only and restores it exactly (the 0091 pattern). `tests/integration/course-structure-upgrade.test.ts` seeds a course before 0130 as the NOBYPASSRLS migration owner (hook `beforeCourseStructureMigration`, idx ≤ 129 in `tests/database.ts`) and checks every lesson lands in one section in the same order with FORCE still on.
- `public.catalog_access` is replaced from its 0123 form with the content additions only: the hidden-item path through community shelves, the community settings reset on entry and exit, `SET search_path = pg_catalog, pg_temp` and schema-qualified names are unchanged.

## Content security policy

The app sends no Content-Security-Policy header today, so there was no `frame-src` to narrow. The player only ever frames the two hosts in `videoEmbedHosts` (`src/lib/lesson-video.ts`); a future CSP should allow exactly those in `frame-src`.

## Evidence

- Unit: `tests/unit/lesson-video.test.ts` (accepted and refused links, canonical and embed addresses), `tests/unit/course-structure.test.ts` (labels, moves across sections and levels, add and remove without losing lessons), `tests/unit/catalog.test.ts` (form and payload).
- Integration: `tests/integration/course-structure.test.ts` (CRUD by role, ordering and moves, labels, validation and forged rows, enrolment and learner content, the hidden community-shelf path, RLS across two ministries), `tests/integration/course-structure-upgrade.test.ts` (backfill), and the existing `free-catalog`, `community-shelf`, `community-shelf-upgrade` and `discover-server` files.
- Browser: `tests/e2e/course-structure.spec.ts` (owner adds a level and sections, renames the labels, moves a lesson across sections, rejects a bad link, saves a video link; the learner sees the structure and the click-to-load video, with no request to the video host before play; axe at 1280 and 360 in light and dark). Screenshots: `docs/screenshots/course-structure/`.

## Not in this slice (remaining 25 Nov items, follow-ups)

1. Lesson attachments.
2. Resources tab.
3. Student notes.
4. Real progress (stored completion). Note for that slice: authoring saves still replace a course's lessons, sections and levels by id (delete and reinsert, as since 0061), so progress or notes keyed to lessons will need upserts instead, or they would be removed on every save.
5. Course cover.
6. Author page.
7. Visibility work beyond the existing hidden, unlisted and listed choice.
8. Public catalogue.

Also open: a real VK and YouTube playback check in a browser with network access (the tests answer the embed host locally), and the hosted migration. The routes stay off in production (`freeCatalogEnabled`). No production migration has been applied. All five HC-02 gates remain **UNAPPROVED**.
