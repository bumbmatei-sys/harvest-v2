# Communities C15b: notification email, digests and unsubscribe (backend only)

Design: `docs/superpowers/specs/2026-11-13-communities-c15b-email-design.md`. Plan: `docs/superpowers/plans/2026-11-13-communities-c15b-email.md`. Migration `0042_community_email`. Builds on C15a (#67, migration 0041). **No screen, component or template changed.**

## Delivered

- **Pure pieces** (unit-tested):
  - `src/lib/community-email.ts`: plain-text rendering for an instant email or a digest. It reuses the bell's summary keys and links (`src/lib/notifications.ts`), so the wording stays in one place. Member-written text is limited to display names and post titles, each trimmed to 80 characters, with control and direction-override characters removed and link-like text (URLs, `www.`, addresses and common domains) replaced by `[link removed]`, because mail clients link-ify plain text and the mail comes from the community's own sender.
  - `src/lib/community-email-token.ts`: signed one-click unsubscribe tokens (HMAC-SHA256 with a key derived from the server secret for this purpose, constant-time comparison, 180-day expiry).
- **Migration 0042:**
  - `community_memberships` gains `email_frequency` (`off`, `important` by default, `daily`, `weekly`) and `email_digest_cursor`.
  - New table `community_email_deliveries` (FORCE RLS, no application grants): one row per email with an idempotency key, status (`queued`, `sending`, `sent`, `failed`, `skipped`), attempts, lock and a short error code. It holds no address and no message text.
  - Definers: `community_email_enqueue`, `community_email_claim`, `community_email_complete` (worker); `community_email_prefs_save` (member); `community_email_unsubscribe` (token holder). `community_purge_notifications` now also removes deliveries older than 90 days; `community_definer_reset` clears the worker setting.
  - Owner policies are named `community_definer_email_*` and keyed on settings only the definers set and clear.
- **Worker** (`src/server/community-email.ts`, `scripts/send-community-email.ts`, `npm run communities:send-email`): queues what is due, claims batches, renders, sends through a `CommunityMailSender` and records the result. It prints counts only.
- **Senders** (`src/server/community-email-sender.ts`): a local test mailbox (JSON lines, mode 0600) and a live sender hard-disabled by `COMMUNITY_EMAIL_LIVE_DELIVERY = false`.
- **Routes** (behind the flag): `PUT /api/communities/:slug/notifications/email` with `{ frequency }`, and `POST /api/communities/unsubscribe` (token in the query or a JSON body, no sign-in, always the same answer).

## Behaviour (founder decision, 13 Nov: important instant, digest opt-in)

- **Instant:** application decisions, warnings, held-post decisions and appeal decisions, to the person they are about. Nothing else is emailed instantly.
- **Digest:** replies, thread replies, likes and host alerts, only for members who chose `daily` or `weekly`. The window starts when they opt in. An empty window sends nothing and still moves the cursor.
- **Mute** stops warnings and held decisions and digests, but not appeal decisions (C15a decision). A banned appellant still gets the appeal decision. An applicant without a membership gets the application decision as a one-time message with no unsubscribe link.
- **Off** stops everything, including emails already queued (checked again at claim time). An instant event the member already read in the app is skipped.
- **Retries:** a failed send backs off 10 minutes per attempt and stops after 5. A claimed row stays locked for 15 minutes (a full batch of 25 sends at the 15 s timeout takes about 6.5 minutes), and the script takes a session advisory lock so only one run works at a time. Delivery is at-least-once: if the worker crashes after sending but before recording the result, the row is sent again after its lock expires, and the idempotency key passed to the sender is what prevents a visible duplicate.
- **Digest windows** end one minute in the past, so a notification written by a transaction that commits a moment late lands in the next window instead of being lost.
- **Claim re-checks** the recipient: a member who was muted, banned or left since queueing gets no warning, held decision or digest. Application and appeal decisions still go.

## Evidence (local)

- `npx tsc --noEmit`, lint and source guards on the changed files: clean.
- Unit: 43 files, 433 tests (renderer including link neutralising, token).
- Integration: `community-email-db` (16 tests: routing per kind, off, mute, banned appeal, applicant, digest window and cursor, retry and lock, two concurrent workers, a row locked by another worker is skipped, a late-committing notification, claim-time re-checks, ministry isolation, preferences and unsubscribe, no address in the log, purge) and `community-email` (6 tests: the one-run-at-a-time lock, end to end into a temporary mailbox, no double send, unsubscribe by token, failure code with no address leak, preferences validation, live sender refusing).
- Restricted-owner suite as the non-superuser `tester`: `community-joining-definer-owner` with the new definers and table, plus a new flow test, 7 tests passed.

## Decisions and limits

- **The worker functions were first granted to the application role** (no separate worker role), so code running as it could ask the claim function for recipients' addresses across ministries, and `complete` could mark any delivery sent or failed. The independent review (#72) asked for a dedicated role. **Resolved in code by migration 0044** (`docs/acceptance/worker-db-role.md`): `harvest_worker` has EXECUTE on enqueue, claim and complete (and the three retention functions) only, they are revoked from the application role, and the worker script connects as it through `WORKER_DATABASE_URL`. `prefs_save` and `unsubscribe` stay with the application role. The role still has to be provisioned in each real environment (`docs/setup/worker-role.md`).
- The unsubscribe link in the email points at `/communities/unsubscribe#token=...`, a confirmation page that is **not built yet** (UI kit). The one-click POST works now. The frequency control in the notification settings sheet is also not built; the API accepts it.
- Plain text only. No HTML, no @mentions, no per-kind choices.
- An unsubscribe token stays valid for 180 days, so an old email can switch email off again after the member re-enabled it. Off is the only change it can make; a per-membership epoch would end it if wanted.
- The script also refuses to run unless `WORKER_DATABASE_URL` is a local database.
- A reply notification that is already queued as part of a digest is not removed if the post is later held or removed; the digest shows no title for it.

## Activation gates

- Dedicated worker database role: code and migration 0044 delivered; provision `harvest_worker` and `WORKER_DATABASE_URL` per `docs/setup/worker-role.md` (unapproved, not run anywhere).
- Choose and review an email provider, then replace the constant in `src/server/community-email-sender.ts` in a separate change.
- Schedule `npm run communities:send-email` every few minutes and `communities:purge-notifications` daily. The worker refuses to run outside test mode today.
- Build the unsubscribe page and the frequency control.
- Production migration 0042 after 0041; not applied.
