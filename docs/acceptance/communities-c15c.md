# Communities C15c: email frequency control and unsubscribe confirmation page

Builds on C15b (#72, migration 0042). **No migration.** No new UI kit items: only existing Harvest shared components (`PublicFrame`, `Card`, `Button`, `Sheet`, `RadioGroup`, `FieldSet`/`FieldLegend`, `Switch`, `Label`, the `notify` toast helper). Everything stays behind the communities feature flag. Live delivery stays hard-disabled (`COMMUNITY_EMAIL_LIVE_DELIVERY = false`); no email is sent.

## Delivered

- **Email frequency in the notification settings sheet** (`src/components/communities/notification-settings-sheet.tsx`): an "Email" radio group with Off, Important only (default), Daily summary and Weekly summary, one short line each. Save sends only what changed: the switches through `PUT .../notifications/preferences` and the frequency through `PUT .../notifications/email`. Success shows the existing toast; an error shows the toast and keeps the inline alert. The current value comes from the member's forum context (`prefs.email`), so every place that opens the sheet (bell, welcome card, member profile settings) shows it.
- **Unsubscribe confirmation page** at `/communities/unsubscribe` (`src/app/communities/unsubscribe/page.tsx`, `src/components/communities/unsubscribe-confirm.tsx`), in the public frame other community pages use.
  - The email links to `/communities/unsubscribe#token=...`. The token stays in the fragment, so it never reaches the server on GET. The page reads it in the browser (`src/lib/community-unsubscribe.ts`), removes the fragment from the address bar and asks "Stop emails from this community?".
  - Opening the page changes nothing. The token is posted to `POST /api/communities/unsubscribe` only when the person confirms.
  - Every outcome (valid, invalid, expired or missing token) shows the same neutral result, matching the route's uniform answer. A missing or malformed token sends no request. Only a network failure shows an error toast.
  - No sign-in, no personal data, no community name. `noindex`, `no-referrer`; the proxy also sends `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer` for this path.
- **Slug guard:** new and renamed communities can no longer take the slug `unsubscribe`, which the page's static route would shadow (application check in `src/server/communities.ts`).
- **Browser test plumbing:** the local e2e server writes its throwaway auth secret to `<mailbox>.auth-secret` (mode 0600), next to the existing QA token file, so a spec can sign a real unsubscribe token.

## Evidence (local, author-executed)

- `npx tsc --noEmit`, `npm run lint` (ESLint and source guards): clean.
- Unit: `vitest --project unit`, 162 files, 1841 tests passed (new: `community-unsubscribe` fragment parsing and frequencies; `communities-flag` now also covers the email route, the unsubscribe route and the page in production).
- Integration: all 29 `tests/integration/communit*` files, 210 tests passed, including the new `community-email-screens` (frequency save through the route for member and moderator, refusals for bad input, other origin, signed out, outsider, pending and banned; the unsubscribe route answering a valid, expired, forged, tampered, malformed, missing and query-string token identically, with only a valid token switching email off; the reserved slug).
- Browser (`E2E_WEBPACK=1`, one worker): `community-email-screens` passed: a member changes the frequency and it persists after reload; opening the unsubscribe link sends no request and changes nothing; confirming switches email off (checked in the settings sheet); a forged token and a missing token show exactly the same result; axe (WCAG 2.2 AA) clean and no horizontal scroll at 1280 and 360 px in light and dark for the sheet and both page states.
- Browser regressions: `community-member-profile` passed (opens the sheet from member settings). `community-notifications` did not pass locally: it fails before the sheet is reached (the join redirect to the forum exceeds the 15 s wait on a cold webpack compile, or the dev server restarts at its memory threshold). The same spec fails the same way on unmodified `main` on this machine, so it is environmental; CI must confirm it.

## Decisions and limits

- The confirmation page shows no community name, because naming it would need the server to read the token and would make valid and invalid links look different.
- `unsubscribe` is reserved in application code only. Adding it to the database check `community_slug` needs a migration; follow-up, not done here.
- Mute and email frequency stay independent, as in C15b: mute does not change the radio and does not stop application or appeal decisions.
