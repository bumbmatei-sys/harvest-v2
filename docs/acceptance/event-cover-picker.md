# Event cover picker

PR #197. A cover image control on the owner event form (`/workspaces/[tenantId]/events/[eventId]`, Details step). Uses the existing server (#153, #156): safe uploads, signed delivery, server-side cleanup of retired and abandoned covers. No migration, no new dependency, no navigation entry.

## Done
- Choose, drop or Select an image (JPG, PNG, WebP, up to 10 MB; the browser repeats the server's type, extension and size checks first). SHA-256, signed slot, direct PUT with progress and Cancel, server verification and scan, then the cover is set.
- States: preparing, uploading with progress, checking, scan pending (Check again, Dismiss), and the errors type, size, rejected, interrupted (Try again), failed (Try again), scan failed (Choose another), stale version (Reload).
- Replace and Remove (Remove asks first). 16:9 zone and preview, as forum covers. A cover is its own request, so it applies at once; the new event version reaches the next Save, and an upload in progress guards leaving the page.
- The picture is read only through the signed address from the cover route (60 s); it is fetched again once if the picture fails to load. No storage address is built in the browser.
- A new, unsaved event shows "Save the event to add a cover." (the server needs the event to exist). Cancelled events are read-only. Owners and admins only; members, viewers and strangers get the access state and 403/404 from every cover route.
- Cover also shows in the editor's live preview.

## Server change (small, no migration)
Event cover confirmation now follows the community upload rule (`communityUploadReleased`): a skipped scan releases the image outside production only; in production it stays "uploaded" and can be checked again (`noOpScanner` behaviour unchanged). Without this no cover could ever become ready. Production stays closed until a real malware scanner exists (activation gate).

## Deferred
- The member event page and the event lists have no cover slot, so nothing was added there (not redesigned). Showing the cover there is a follow-up.
- Real malware scanner. Cancelled-event picker state is not covered by e2e.

## Hard-off
Events and covers stay off in production (`eventsEnabled`); unchanged. No real outbound traffic: loopback storage mock only.

## Evidence
- Lint, typecheck, unit (`tests/unit/event-cover.test.ts`, 8 tests), integration `tests/integration/event-covers.test.ts` (9, including the release rule).
- Playwright `tests/e2e/event-cover-picker.spec.ts`: new event, empty zone, wrong type, wrong extension, too large (no request made), rejected slot, interrupted upload, storage refusal, progress, scan pending, scan failed, signed URL and decoded picture, reload, Save after cover change, replace, keyboard, Remove, drag and drop, stale version, roles; axe WCAG 2.2 AA and no horizontal overflow at 360, 768 and 1280 in light and dark; 44px targets.
- Existing `events-c14` spec re-run, flag on and `HARVEST_SHELL_MODES=disabled`.
- Screenshots: `docs/screenshots/event-cover/`.

## Provenance
Modelled on the premium kit's pos-system image drop zone (admin-dashboard 1631106); 4 of 123 lines (3%) identical, so no kit code is copied. See `docs/ui-sources.md` and `src/lib/ui-provenance.ts`.
