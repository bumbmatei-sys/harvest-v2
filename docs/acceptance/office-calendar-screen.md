# Office Calendar screen acceptance

Operations > Office > Calendar: the UI for each owner's or admin's own calendar, on top of the merged Office server (PR #185, migration 0075), in the pattern of Email (#191) and Files (#193, #194). No server change, no migration, no new dependency. Nothing is activated: the gate is closed in production, every real calendar write is hard-off, and all five HC-02 gates remain UNAPPROVED.

## Done

- **Route and gate.** `/workspaces/[tenantId]/calendar`. 404 before any session work while the Office gate is closed (`requireOfficeScreens`). Owners and admins only (`office:calendar`, already in the permission map); members, viewers and non-members get the neutral access state. The sidebar link is the existing `calendar` registry entry, promoted from planned, behind the `office` navigation feature (never reported in production) and `office:calendar`. It sits in Operations > Office after Email.
- **Connection states.** Not connected (privacy notice always on screen, one button per provider, the person's affirmative action), pending (shared `useConnectAttempt` hook, same as Email and Files), reconnect needed, needs attention (check again, Disconnect). Each admin sees only their own Calendar connection; another admin's connection id answers one neutral 404.
- **Views.** Month, Week, Day, Agenda (30 days) and Availability, switched in the URL (`view`, `date`). Live reads through the Office `events` action, following the cursor up to five pages; a list that is not complete says so ("Some events may be missing from this view"). Nothing is stored by Harvest: titles, attendees and details live in component state only. All-day events (plain dates, exclusive end) sit in an all-day row.
- **Event detail panel.** Time, calendar, join link and meeting provider name when the server returns the Meet or Teams fields, attendees and notes the provider returned. Join links are opened only if they are web addresses.
- **Availability.** Free times for the shown week from the server `availability` action (length 15, 30, 60 or 90 minutes, past time never offered, the server's partial flag shown). The tab is hidden when the connection does not report the capability.
- **Source chips and marks.** Sources are the connection's calendars (as the provider lists them) and, while the overlay is on, Social posts. With more than one source shown: All plus one chip per source (any, any combination or all; empty is All, same helpers as Files) and a small mark on each event. Calendar marks (`CalendarLogo`) are simplified Google Calendar and Outlook marks flagged subject to brand-guideline review; the Harvest logo marks social posts.
- **Link to a CRM person.** Explicit reference through the CRM `RecordPicker` and the `eventLink` action (`PersonLink`, shared with Email); unlink through `removeReference`. The server stores only the event reference and its times, never the title (the e2e asserts this).
- **Show social posts.** A toggle (URL `social=1`), offered only when the social planner is available to the person. Scheduled, queued and publishing posts from the existing planner read API (`GET .../social/planner?from&to&timezone`, the same range read the planner uses) appear read-only: time, platform mark, short title (60 characters), a detail panel that links to the planner week. Drafts, published and cancelled posts are not shown. An overlay failure or a 404 is stated and the calendar still shows. Nothing leaves Harvest.
- **Event form and Edit/Delete.** "New event" opens the form (copied from the kit's event dialog, adapted): title, notes, start and end date and time, all-day, calendar picker, time zone, attendees, video link. While the server reports writes as unavailable (always in production) every control and Save are disabled with the one notice "Creating and editing events isn't available yet", and Edit and Delete in the detail panel show the same notice. Where the server reports writes as available (the non-production fake provider) the form works as described in `docs/acceptance/office-calendar-writes.md`. Drag to reschedule is not present at all (the grids render nothing draggable).

## Hard-off

`OFFICE_CALENDAR_WRITE_ENABLED`, `OFFICE_MAIL_SEND_ENABLED`, `OFFICE_INTEGRATION_ENABLED` and `OFFICE_LIVE_NETWORK` stay literal `false`. The e2e records every Office request in all three specs and asserts that none of `createEvent`, `updateEvent` or `deleteEvent` is ever sent, and calls `createEvent` directly to confirm the server answers `disabled`. The routes use the in-memory fake provider; no real provider call, no real message.

## Writes (decided and built separately)

The open decisions that were listed here (invites, video link, which calendar, recurring events, time zones, conflicts, retries, location and all-day) were answered by the founder on 23 Nov and built as a separate slice behind the fake provider: see `docs/acceptance/office-calendar-writes.md` and `docs/decisions/founder-decisions-2026-11.md`. The form's controls are enabled only when the server reports writes as available (non-production synthetic provider); otherwise the disabled notice stays. Location was dropped from the form (no provider field).

## Deferred by design

RSVP and drag to reschedule; recurring events and invites (version 2); create, edit and delete exist only against the fake provider (see the writes record); the kit's `events-popup` (the week grid has the overlap popover, the month "+N more" opens the day); free/busy overlay of other people; several calendar connections (the server allows one Calendar connection per admin); push refresh (on demand only); Settings > Connections entry for Office.

## Server gaps found (reported, nothing invented)

1. **No read by event for person links.** `contactReferences` lists references per contact, not per event, so the panel cannot show that an event is already linked after a reload; the link state lives in the page for the session (the reference itself is stored and removable).
2. **No location field** on `EventDetail` or in the write schema; the panel shows none and the form has no location field.
3. Writes now carry all-day and the calendar time zone (see the writes record).
4. **`events` has no calendar filter in the UI** beyond `calendarRef`; the chips filter the fetched range locally (the range is complete or reported partial), they do not re-query.
5. **The fake provider** seeds one event, so realism (several calendars, all-day, meeting links, paging) comes from route stubs in the e2e.
6. **Planner range read is suitable** (from, to, timezone, paging): nothing was missing for the overlay. It returns drafts too, which the overlay drops client-side by status.

## Reuse rationale

Reused: AppShell and the typed navigation registry (promoted entry, no new group), `useConnectAttempt` (shared Office handoff), `PersonLink` and the CRM `RecordPicker`, `EmptyState`, `ConfirmDialog`, Sheet, Switch, ToggleGroup, NativeSelect, Field, Alert, Skeleton, the Files source-chip helpers (`toggleSource`, `shownSources`, `showMarks`), the planner's read API and `PlatformLogo`, the logo registry and `theme-registry.ts` for calendar marks, and the existing month and week grids, which gain only optional props (`hideHeader`, `mode="day"`, all-day row, read-only when `onDropAt` is omitted) with their social and events consumers unchanged. New: the browser client, the connect panel, the workspace, agenda view and event form (kit copies), the availability view. No module-specific shell or calendar was written.

## Provenance

Source: the paid kit, admin-dashboard `1631106`, `apps/calendar`. Copied and adapted: `event-form.tsx` from `event-dialog.tsx` (176 of 264, 66%), `agenda-view.tsx` from `agenda-view.tsx` (45 of 66, 68%); extended derived files: `week-calendar.tsx` (222 of 328, 67%), `month-calendar.tsx` (68 of 146, 46%), `calendar-days.ts` (75 of 77, 97%). Modelled on: `calendar-workspace.tsx` (6 of 203, 2%), `calendar-connect.tsx` (4 of 70, 5%). Measured with `scripts/ui-identical.sh` on 22 Nov 2026. Recorded in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`. Dependencies were checked: nothing new (`@remixicon/react` and a Drawer are not in the repository, so lucide and the shared Sheet are used).

## Evidence

Run on this branch on 22 Nov 2026 with embedded PostgreSQL as a non-root user (`LANG=C.UTF-8`), Chromium, `reducedMotion: reduce`, a private dev-server port.

- `npm run lint` (eslint with zero warnings and the source guards), `tsc --noEmit`: clean.
- Unit: 1,462 tests pass, including the new `tests/unit/office-calendar-lib.test.ts` (ranges, shifting, all-day dates, overlay statuses, planner link, join-link safety), the updated `navigation.test.ts` (Calendar promoted from planned, needs the `office` feature and the owner or admin role, leads Office after Email) and `ui-provenance.test.ts` (the new copied and modelled-on records). Two timeout failures seen while a browser run shared the CPU (`dm-view`, `hc05-http`) pass when re-run alone.
- Integration: `tests/integration/office-connections.test.ts` 12 of 12 (the Office server is unchanged).
- E2E `tests/e2e/office-calendar-screen.spec.ts` (3 tests), shell modes on and with `HARVEST_SHELL_MODES=disabled`, both 3 of 3: not connected, connect, month, week, day, agenda and availability, event detail, person link and unlink (reference stored with no name, the title never in the response, no contact created), the disabled New event form, Edit and Delete, keyboard (view switch, event row, Escape), disconnect, another admin (empty overview and a neutral 404 for `events` and `event`), a member and a stranger, the server answering `disabled` to `createEvent`, and stubbed states (two calendars, chips, marks, filter, all-day row, paging with de-duplication, partial notice, Teams join link, social overlay on, off, failing and unavailable, drafts never shown, failed refresh and retry, reconnect, attention). **Every test asserts that no `createEvent`, `updateEvent` or `deleteEvent` request is ever sent.**
- Axe (WCAG 2.0, 2.1 and 2.2 A and AA tags) and no horizontal overflow at 1280, 768 and 360, light and dark, for 12 scenes (connect, month, agenda, detail, form, availability, week with sources, meeting detail, agenda with social posts, events error, reconnect, attention): screenshots in `docs/screenshots/office-calendar/` (shell-modes-on run).
- Regression, shell modes on and off: `office-mail-screen` 3 of 3 and `social-inbox-screens` pass in both; `campaigns` passes in both after the link counts were updated (13 with shell modes on, 12 with `HARVEST_SHELL_MODES=disabled`, where Email and Calendar are not in the sidebar; `campaigns.spec.ts` was the only spec that counted sidebar links). `office-files-screen` fails in this environment in both modes at the upload step ("File uploaded and ready." never appears), and fails identically on the unchanged base commit `54ba606`, so it is not caused by this PR; the Files code is untouched.
