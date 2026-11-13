# Communities C15b: notification email, digests and unsubscribe (design)

Status: approved by the founder on 13 Nov 2026 ("Important instant, digest opt-in"; backend only). Plan: `docs/superpowers/plans/2026-11-13-communities-c15b-email.md`. Migration `0042_community_email`. Builds on C15a (#67, migration 0041).

References: C15a design (`2026-11-12-communities-c15a-notifications-design.md`, founder decision 1), PRD §6.7, ADR 0013 §4a.

**Backend only.** No screen, template or component changes. The frequency control in the notification settings sheet and the styled unsubscribe confirmation page come later with the new UI kit. Email text is plain text.

## Hard limits

- Nothing sends real email. The sender is a local test mailbox. The live sender exists behind a constant that is `false` (the Connect invitation pattern) and needs a separate activation change.
- The worker refuses to run unless `HARVEST_COMMUNITY_EMAIL=test`, a test mailbox path is set and `BETTER_AUTH_URL` is localhost.
- Communities stay off in production behind the existing flag.

## Founder decisions

1. Email defaults: **important instant, digest opt-in.**
2. Instant kinds: `application`, `warning`, `held_decision`, `appeal_decision`. Replies, likes, thread replies and host alerts (`host_queue`) appear only in a digest the member turned on.
3. `appeal_decision` ignores mute and still reaches a banned appellant (C15a decision). `application` also reaches the applicant, who has no active membership.
4. `off` stops all community email for that member and community, instant ones included.

## Data (migration 0042)

**`community_memberships` gains:**
- `email_frequency text not null default 'important'`, one of `off`, `important`, `daily`, `weekly`;
- `email_digest_cursor timestamptz`: the end of the last digest window. It is set to `now()` when a member moves to `daily` or `weekly`, so a digest never reaches back before the opt-in.

**`community_email_deliveries`:**
- Columns: `id`, `tenant_id`, `community_id`, `recipient_id` (users, cascade), `kind` (`instant` or `digest`), `notification_id uuid null` (instant), `window_start`, `window_end` (digest), `idempotency_key text unique`, `status` (`queued`, `sending`, `sent`, `failed`), `attempts`, `locked_until`, `last_error text null` (a short code only), `created_at`, `sent_at`.
- It stores no email address and no message text.
- FORCE RLS. The application role has no direct access. Owner policies are keyed on a worker setting (`app.community_email_worker`) and a purge setting, like 0041.

## Definers

All are `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, and granted to the application role only where listed.

- **`community_email_enqueue(p_limit)`** (worker) returns the number queued.
  - Instant: notifications of an instant kind from the last 7 days that have no delivery yet.
    - Idempotency key `n:<notification id>`.
    - Skipped when the recipient's `email_frequency` is `off`.
    - For `warning` and `held_decision`, also skipped when the member muted notifications or can no longer read the community.
    - `application` and `appeal_decision` skip those two checks.
    - A recipient with no membership row uses the defaults.
  - Digest: members with `daily` or `weekly` whose cursor is at least one or seven days old.
    - The window is `[cursor, now)` and the cursor moves to `now()` in the same transaction.
    - The digest holds unread notifications updated in the window that are not instant kinds, for members who can read the community and have not muted it.
    - Key `d:<recipient>:<community>:<window end>`.
    - An empty window queues nothing.
  - Rows are locked with `FOR UPDATE SKIP LOCKED`, so two workers never queue the same email.
- **`community_email_claim(p_limit)`** (worker) returns jsonb.
  - Takes `queued` rows, `failed` rows with fewer than 5 attempts and a backoff that has passed, and `sending` rows whose lock expired. It sets `sending`, `locked_until = now() + 5 minutes` and `attempts + 1`.
  - For each it returns the recipient's address and name, the community's name and slug, and the items. Each item has the kind, the count, the actor's name and the post title. Digest items are the notifications in the window. For a deleted or removed post the title is null.
  - This is the only place an address leaves the database, and only to the worker.
- **`community_email_complete(p_id, p_outcome)`** (worker) records `sent`, or `failed` with a code (`send_failed`, `render_failed`).
- **`community_email_prefs_save(p_slug, p_frequency)`** (member): active members only. Moving to `daily` or `weekly` from another value sets the cursor to `now()`.
- **`community_email_unsubscribe(p_tenant, p_community, p_user)`** (application role): sets `email_frequency = 'off'` and nothing else. The caller verifies a signed token first. This is the lowest-impact write possible.
- **`community_purge_notifications()`** is replaced (`CREATE OR REPLACE`, same signature) to delete deliveries older than 90 days too.
- **`community_definer_reset()`** is extended to clear the worker setting.

## Server

- **`src/lib/community-email.ts`** (pure): renders an instant email or a digest.
  - Plain text. Copy comes from message keys under `CommunityEmail`. No vendor names.
  - Member-written text is limited to a post title, trimmed to 80 characters with control characters removed.
  - Links use the site origin and `/communities/<slug>`.
  - Each email carries a footer unsubscribe link and the `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers, but only when the recipient has a membership row. An application or appeal decision to someone without one is a one-time message and has no link.
- **`src/lib/community-email-token.ts`** (pure): signs and verifies `v1.<user>.<community>.<expiry>` with HMAC-SHA256, using a key derived from the server secret with a purpose label. It uses a constant-time comparison. Tokens expire after 180 days.
- **`src/server/community-email.ts`**: `runCommunityEmail(pool, sender, { limit })` does enqueue, claim, render, send and complete. It keeps going after a single failure and reports counts only.
- **`src/server/community-email-sender.ts`**: the `CommunityMailSender` interface, the local test mailbox sender (JSONL, localhost only) and the live sender behind `COMMUNITY_EMAIL_LIVE_DELIVERY = false`.
- **Routes** (behind the flag): `PUT /api/communities/[slug]/notifications/email` with `{ frequency }`, and `POST /api/communities/unsubscribe` with `{ token }`. The unsubscribe route needs no sign-in and always answers with the same body, so it reveals nothing about which tokens are valid.
- **`scripts/send-community-email.ts`** and the `communities:send-email` npm script run as the application role. Run it every few minutes. Digests go out when due, because the cursor decides.

## Not in C15b

The frequency control and the unsubscribe confirmation page (UI kit), HTML email, @mention email, a real provider, scheduling the worker (an activation step) and per-kind email choices.

## Testing

**Integration (two ministries):**
- each instant kind emails the right person, and likes, replies and host alerts do not email instantly;
- `off` stops everything; mute stops `warning` and `held_decision` but not `appeal_decision`; a banned appellant still gets the appeal decision;
- a digest holds only unread, non-instant items in its window, respects the cursor and sends nothing for an empty window;
- no double send: two workers run at once and each email is claimed once; a rerun sends nothing new;
- an expired lock is retried and the idempotency key is passed to the sender;
- nothing from ministry B reaches ministry A's recipients;
- the restricted owner for every new and changed definer.

**Unit:** the renderer (truncation, control characters, links, headers present or absent), the token (valid, tampered, expired, wrong purpose) and the live sender refusing to run.
