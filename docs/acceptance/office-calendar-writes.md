# Office Calendar writes acceptance

Create, edit and delete single events on the admin's own calendar, on top of the merged Office server (#185, migration 0075) and Calendar screen. Migration **0084** (`0084_office_calendar_writes`; main's last is 0081, #208 uses 0082, 0083 is reserved for the newsletter PR; the snapshot `prevId` chain needs a one-line fix on rebase if those land first). Everything is built and tested against the **fake provider only**. Nothing is activated: production behaviour is unchanged (writes answer `disabled`), no real provider call, no real invite or email, and all five HC-02 gates remain UNAPPROVED. Decisions: `docs/decisions/founder-decisions-2026-11.md` ("Office Calendar writes").

## Done

- **Write gate.** `calendarWritesOn` is true only for the literal `OFFICE_CALENDAR_WRITE_ENABLED` (false) or for the synthetic provider behind the non-production route gate (`officeGateOpen`, never open in production; `officeRouteDeps` supplies `calendarWrites: true` only there). The connection overview reports `createEvent`, `updateEvent` and `deleteEvent` as `available` only then, otherwise `disabled`, and the screen keeps its disabled notice.
- **Separate write grant.** Calendar connections carry grant bit 8 (read stays 2; the DB check allows 2 or 10). `startConnect` takes `access: "write"` (calendar only). Until granted, a write answers `write_access_needed` and New event shows "Allow Harvest to add events to your calendar". The fake provider grants it through the same hosted handoff the read connection uses (`startConnect`, `finishConnect`).
- **Calendars.** `calendars` takes `writableOnly`: read-only calendars are dropped and the server returns `defaultRef` (the calendar used last, else the primary calendar, else none; never a shared calendar). A write to a missing calendar answers one neutral 404; to a read-only one, 400.
- **Events created in Harvest.** Table `office_calendar_events`: tenant, owner, connection, calendar reference, event reference, created time. No titles, notes, times or attendees, and no contact link, so erase and merge are unaffected. `events` and `event` results gain `createdHere`; update and delete of any other event answer 404. The last-used calendar is `office_connections.write_calendar_ref` (a reference).
- **Create, update, delete.** Single events (no recurrence); the write schema now carries all-day (plain dates, exclusive end) and the calendar's time zone; attendees are refused by the server (400) in version 1; `createEvent` needs a request id (a retry never duplicates; the form keeps one id per unchanged form); update and delete carry the event `version`. A stale version is refused with a 409 and nothing is overwritten. The video link uses the calendar provider's own Meet or Teams (`meeting` capability reported; the toggle is disabled with a short reason otherwise).
- **Audit.** One row per create, update and delete: action, connection id, outcome (`available`, `conflict`, `disabled`, `write_access_needed`, ...) and the event reference only. The restrictive RLS insert policy was replaced to allow exactly `{outcome}` or, for the three event actions, `{outcome, eventRef}`. A refused (409) attempt commits its audit row before the error is raised.
- **UI.** The event form (kit-derived) is enabled only when the server says writes are available: title, notes, dates and times, all-day, calendar picker (writable only, account mark), time zone line, attendees (disabled, "Invites aren't available yet"), video link toggle (off by default). Edit and Delete in the detail panel are enabled for events created in Harvest only; Delete asks for confirmation; other events show "Harvest can change only events it created." Location was removed from the form (no field in the provider write contract).
- **Reuse.** Same shared pieces as before (`useConnectAttempt` for the grant, `ConfirmDialog`, Sheet, Switch, Select, Alert); no new dependency, no navigation change.

## Hard-off

`OFFICE_CALENDAR_WRITE_ENABLED`, `OFFICE_MAIL_SEND_ENABLED`, `OFFICE_INTEGRATION_ENABLED` and `OFFICE_LIVE_NETWORK` stay literal `false` (source guard unchanged). The Zernio adapter still answers `disabled` for every write before any request, and `startConnect` with `access: "write"` answers `unavailable` there. Integration tests cover: no flag, wrong provider, production env helpers.

## Unverified with real providers (nothing was called)

1. **Incremental write scope.** The documented connect call takes one scope area per kind (`calendar`); no separate calendar write scope is documented, so the real adapter refuses a write grant (`unavailable`). Enabling needs the provider to confirm incremental write consent, or a different grant model.
2. **Event version.** The adapter reads an optional `version` on events and sends it as `If-Match` on PATCH and DELETE; the live field name and the 409 or 412 mapping to a conflict are assumptions from the draft and file contracts.
3. **All-day and time zone fields** (`allDay`, `timeZone`) and the `conferencing` request shape on writes follow the read shape and are unverified.
4. **Meeting links** for non-primary or shared calendars, and Microsoft calendars that forbid them, are unverified; the fake provider always succeeds.
5. **Calendar `readOnly` and `timezone`** come from the documented calendar list; shared-calendar rules per provider are unverified.
6. An event edited on the provider side to HTML notes loses its notes in the form (the adapter drops HTML descriptions), so a save would blank them.

## Not built (version 2, documented only)

Attendees with an explicit "Send invites to N people?" confirm, off by default, never anyone marked do-not-contact; recurring events; moving events by drag; location; RSVP.

## Evidence

Run on this branch on 23 Nov 2026 with embedded PostgreSQL as a non-root user (`LANG=C.UTF-8`), Chromium, private dev-server port.

- `tsc --noEmit`, eslint with zero warnings and the source guards: clean.
- Integration `tests/integration/office-calendar-writes.test.ts` (migration owner, restricted role): flag and gate, grant required then granted (bit 10), writable-only list and default, create once per request id, no attendees, read-only calendar refused, all-day, last-used default, update, stale update and delete refused, provider-side change refused, only Harvest-created events editable, other admin cannot see or write, audit rows hold only outcome and event reference, no title or notes in any table, composite foreign key. `office-connections.test.ts` (12) still passes.
- Unit: new zone and plain-date helpers; `office-server.test.ts` updated for the new write shapes; full unit suite passes.
- E2E: `tests/e2e/office-calendar-writes.spec.ts` (grant prompt, create once, video link, edit, read-only sample event, delete with cancel then confirm; stubbed picker, all-day payload, conflict on edit and delete, video-link reason, disabled state; axe at 1280, 768 and 360, light and dark) and the updated `office-calendar-screen.spec.ts`, with shell modes on and `HARVEST_SHELL_MODES=disabled`. Results are in the PR description.
