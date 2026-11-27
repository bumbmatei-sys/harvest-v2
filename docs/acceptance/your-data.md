# Your data: download my data (founder decision, 27 Nov)

Self-serve access and copy (GDPR Art. 15 and 20) for a signed-in person's own Harvest account. Account deletion is the stacked follow-up.

## Built
- **Where:** `/account/profile`, section "Your data", button "Download my data" (44px, light and dark, 360 and 1280 wide).
- **Route:** `POST /api/account/data` (same-origin only, signed-in only). Returns `harvest-data-YYYY-MM-DD.json` as an attachment, `Cache-Control: private, no-store`.
- **Database (migration 0134, `0134_your_data_export`):** `account_export_requests` (FORCE RLS, no app grant) and the definer `public.account_export()` (pinned `search_path`, schema-qualified names, explicit flag clear list `public.account_self_reset()`, never `pg_settings`). Owner read policies are active only under `app.account_export` and pinned to `app.user_id`; the named-reference tables (ministries, communities, channels, DM conversations, courses, lessons, events) are readable only where one of the caller's own rows points to them. `community_definer_reset()` now also blanks the two account flags.
- **Contents:** account and profile; sign-in history (each current session's sign-in, last-active and expiry times, IP address and browser; never the token; Harvest keeps no ended sessions); ministry memberships; community memberships (role, status, rules and adult confirmations, notification settings, join answers, community profile); community applications; posts, replies, channel messages and DMs the person sent (a DM counterpart appears by display name only); likes and reactions; course enrolments, progress and private notes; access grants; event answers; uploaded community files (metadata and a signed link valid for one hour; storage keys never included); Connect responses the person claimed, with purposes (when Connect intake is on).
- **Newsletters:** subscriptions are ministry contact records, not linked to a Harvest account; the export says so.
- **Limits:** 3 exports per person per rolling hour (429 with `Retry-After`); each list holds at most 5,000 rows and is named in `notes.truncated` if cut. Each export writes an audit row `account.export` (no tenant).
- **Sync only:** the export is generated in the request; the 5,000-row cap keeps it bounded. **Follow-up (founder, 27 Nov: after launch):** a background job for exports over the cap, with a download link.
- **Transaction rule:** the account definers blank `app.tenant_id` and every other `app.*` flag on entry and exit (`public.account_self_reset()`), so they must only be called in a personal (`withUser`) transaction, never inside a ministry (`withTenant`) transaction. An integration test compares the clear list with every `app.*` flag in owner-role policies (including the four `app.blog_*` flags of #315).

## Tests
- Integration `your-data-export` (4, migration-owner fixture so the owner policies are exercised): every section present; no other person's posts, replies, chat, DMs, notes, emails or event answers; rate limit and audit; no app-role access to the request log, flags blank afterwards, a self-set flag opens nothing.
- Unit `your-data` (2): link expiry clamp, file name.
- E2E `your-data.spec.ts`: download from the profile page, JSON shape, origin check, rate limit message, axe at 1280 and 360 in light and dark.
