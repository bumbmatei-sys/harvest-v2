# Events week and day views

Founder decision (26 Nov 2026): the Events calendar gains week and day views beside the upcoming list and the month. The rule was to reuse the existing grid if it was the most premium and complete one, and otherwise use kit item `event-calendar1`.

## Delivered
- Comparison in `docs/ui-sources.md` ("Events week and day views"). The existing premium-derived week grid already covers week, day, an all-day row, overlap grouping, the current-time line, phone sizing and theme tokens. It is reused, so no new kit code was added.
- `src/components/social/week-calendar.tsx` moved unchanged to `src/components/calendar/week-view.tsx`. It gains one optional prop, `zoneLabel`. Social Planner, Office Calendar and Events all import it now; the provenance record names the new path.
- Events switcher: List, Month, Week, Day, kept in the URL (`?view=week&date=YYYY-MM-DD`, `?view=day&date=…`, `?view=calendar&month=…`).
- Week and day views have previous, next and Today links, a heading that announces the range, and a focusable scroll region.
- Each event sits at its own wall-clock time in its own time zone. Selecting an event opens its existing detail page. Both the owner/admin Events page and the community Events tab get the new views.
- New `Events` strings are concise. Controls are 44px on phones; colours are theme tokens only.

## Evidence (author-executed)
- `tests/unit/events-week-day.test.ts`, 7 tests:
  - view and date parsing, Monday-first weeks and padded API ranges;
  - switcher links;
  - week grid render with previous/next links and the event's own zone;
  - day view, empty notes, and the overlap "+N" button.
- These unit tests also pass: `event-view`, `ui-provenance`, `source-guards`, `office-calendar-lib`.
- `tsc --noEmit` and eslint on the changed files are clean.
- The browser suite was not run (disk). The existing Social and Office e2e specs still select `[data-slot="week-view"]`, which is unchanged.

## Not included
- Arrow-key navigation between grid cells.
- Localised hour and day labels inside the grid (date-fns English, as in Office Calendar).
- A phone agenda fallback for the week view (Social Planner has one).
- No migration.
