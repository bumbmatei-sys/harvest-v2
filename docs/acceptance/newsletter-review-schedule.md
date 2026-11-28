# Newsletter review, scheduling and NL-08 (signup to unsubscribe)

Launch roadmap item: Newsletter "schedule and review before sending" screens, plus NL-08 "full test, signup to unsubscribe". Sending stays off: nothing reaches a provider, no worker or scheduler is installed, and `LIVE_NEWSLETTER_ENABLED` stays `false`. The five HC-02 activation gates remain UNAPPROVED. Founder approved parallel work on 26 Nov; reschedule-in-place approved by the coordinator on 26 Nov.

## Done

- **Review step** (third step of the campaign editor on the shared `EditorShell`: Write | Send | Review), `src/components/newsletter/review-step.tsx`:
  - "Sending is off" notice at the top, always visible: a scheduled email waits in the queue and nobody receives it.
  - Summary: audience (lists and saved groups), recipient count (eligible of selected, same estimate API as Send), subject, preview text, from (display name and address), reply-to, when (in the ministry's time zone).
  - Checklist with a fix control per problem: no list, no consented recipients (opens Audience), no subject, no content, buttons without links, no mailing address, no from/reply-to (Send step, or Sender when none is verified), no or invalid time (past, or beyond 60 days), plus non-blocking warnings (preview text, image descriptions). Unsubscribe always passes: the renderer appends it to every message. The count of blocking problems is announced.
  - Test send: the last result of "Send me a test" (synthetic sink) with its time, and the button again.
  - Schedule: runs the server review (one-use token bound to the stored revision, recipients and time) and confirms in a dialog that shows the server count and time before queueing. "Send now" stays disabled.
  - Scheduled: status, time and zone, "Change time" (reschedule), "Cancel schedule" (confirmation). Cancelled or finished: "Duplicate as a new draft". Scheduled and cancelled campaigns open on Review; Write and Send are inert with a one-line reason; autosave is off.
- **Send step**: the time picker reads in the ministry's time zone (`workspaces.time_zone`, UTC default) and says so; the disabled button is replaced by "Continue to review". `src/lib/newsletter-schedule.ts` turns the picked wall time into the server format (seconds plus the zone's own offset); nonexistent spring-forward times are refused, a repeated fall-back hour uses the earlier instant.
- **Reschedule in place** (server): `POST campaigns/:id/reschedule` `{version, schedule:{at,timezone}}` -> `rescheduleCampaign`. Only a `scheduled` campaign; conflicts `STALE_VERSION`, `SCHEDULE_IN_PAST`, `NOT_RESCHEDULABLE` (any claimed, attempted or provider-held delivery); `SCHEDULE_TOO_FAR` (400) beyond 60 days from the original selection. Audited as `newsletter.campaign.reschedule`.
- **Migration `0122_newsletter_reschedule`** (reserved number; journal idx 122, snapshot chained after 0120, no table change, drizzle-kit generates no DDL):
  - `newsletter_input_guard` (0073) replaced with one added branch: scheduled -> scheduled may change only `scheduled_at` and `timezone` (version +1, future, within frozen time + 1440 h), and only when `current_user` is the owner of `newsletter_reschedule_campaign` (looked up through `pg_proc`, as 0006 does for `erase_contact`) and the transaction-local marker `app.nl_reschedule = tenant:campaign` is set. The rest of the function is byte-for-byte the 0073 body.
  - `public.newsletter_reschedule_campaign(tenant, campaign, version, at, timezone)`: SECURITY DEFINER, `search_path=pg_catalog,pg_temp`, schema-qualified; caller checked through `public.access_role(...)` and `newsletter_capability(..., 'newsletter:delivery')`; zone checked against `pg_timezone_names`; locks the campaign and then every one of its deliveries `FOR UPDATE` before checking them (the worker claims with `FOR UPDATE SKIP LOCKED`, so it cannot lease one in between), then updates the campaign and the queued, unleased, unattempted deliveries' `next_check_at` together; restores `app.nl_send_tenant` and `app.nl_reschedule` before returning. EXECUTE revoked from PUBLIC (so the worker role cannot call it), granted to `harvest_app`.
- **NL-08** `tests/integration/newsletter-nl08-end-to-end.test.ts`, fake transport only (fetch refused, in-memory fake provider, synthetic confirmation sink): hosted sign-up form -> confirmation from the fake inbox (public confirm route) -> test send to the sink -> review and schedule -> worker does nothing without its test flag and nothing before the time -> reschedule moves campaign and queued deliveries -> test worker delivers both messages to the fake provider, campaign `sent` -> one-click unsubscribe (RFC 8058 POST to the link in the delivered message) -> list suppression recorded (digest only) -> the next campaign skips that person at selection and the provider receives only the other one.

## Reuse and exceptions

EditorShell (steps), FormSection, ConfirmDialog, StatusBadge, Alert, Input, Spinner, the recipient estimate API (extracted as `useRecipientEstimate`, used by Send and Review), the existing review/schedule/cancel/duplicate/test-sink routes. No kit item, no new dependency, `ui-provenance.ts` unchanged. Copy lives in `NewsletterCampaigns.review` (and two `send` keys); "ministry", no vendor names. 44px targets (`min-h-11`), theme tokens only.

## Evidence

- Integration (embedded DB, as ubuntu): `newsletter-nl08-end-to-end.test.ts` 5/5 (includes: a superuser that sets the marker is refused by the guard; a delivery leased by a concurrent worker while the reschedule waits on its lock leaves every delivery and the campaign unchanged); all 12 newsletter integration files 107/107.
- Unit: `tests/unit/newsletter-schedule.test.ts` 3/3; `migrations.test.ts`, `access-guard.test.ts`; full unit suite (see PR).
- Browser (webpack dev server): `newsletter-review-schedule.spec.ts` (new: ready, scheduled and cancelled screens, axe at 360/768/1280 light and dark, no horizontal scroll), `newsletter-campaigns.spec.ts`, `newsletter-sender.spec.ts` (updated for the Review step). Screenshots: `docs/screenshots/newsletter-review/`.

## Not included

- Real sending, a scheduler or cron for the worker, live provider activation, webhooks: hard-off.
- "Send now" (stays disabled), resend after cancel (duplicate instead), editing a scheduled email in place (cancel, then duplicate).
- Production migration application.

## Account and newsletter screens rebuilt from the UI kit (28 Nov 2026)

Screens restarted from the real code of the founder-approved kit items (approved 27 Nov; `kitApprovals` "Account and newsletter screens" in `src/lib/ui-provenance.ts`, table and identical-line shares in `docs/ui-sources.md`): Your data card `profile-block11` with the download row `list-block13`; delete account `dashboard-modal13` (shown in place); Review summary `list-block4`, checklist `list-block30`, scheduled status `stat-card12`, send and change-time picker `date-picker-example1`; consent wording panel `dashboard-modal24`; public subscribe page `newsletter2`. Behaviour is unchanged: download POST, 429 message and file save; typed DELETE, re-sign-in, sole-owner alert and the deleted and kept lists; dispatch states, ConfirmDialog steps, the review token, time zone text and "Sending is off"; the wordingVersion badge, v1/v2 text and the clicks line; the public consent box and the 409 wording reload. "Sending is off", the test send row and the 409 reload stay Harvest-owned. The Send step and Change time now pick a day on the calendar plus a time (days before today or past the 60-day limit are disabled) instead of the browser's date and time field; the value sent is the same.

E2E selectors updated (behaviour unchanged): the time is picked on `[data-schedule-picker]`; the scheduled time and zone are `[data-scheduled="time"]` and `[data-scheduled="zone"]` (the full time with zone stays in `[data-summary="when"]`). Evidence at 390 and 1440 wide, light and dark, device scale 2: `docs/screenshots/account-newsletter-kit/`.

Run 28 Nov (webpack dev server, as ubuntu): `newsletter-review-schedule.spec.ts` 1/1 passed, with the dev heap raised locally (not committed) after a memory-threshold restart at the default 3 GB.
