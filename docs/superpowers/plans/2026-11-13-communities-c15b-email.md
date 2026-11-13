# Communities C15b (notification email): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** instant emails for a member's own important events and opt-in daily or weekly digests, sent through a worker to a local test mailbox, with one-click unsubscribe. Backend only.

**Spec:** `docs/superpowers/specs/2026-11-13-communities-c15b-email-design.md`

## Global Constraints

- **Branch and migration:** branch `c15b-community-email`; migration `0042_community_email`.
- **No UI changes.** No component, page or `CommunityShell` changes. Only `messages/en.json` gains email copy keys.
- **Nothing sends real email.** Test mailbox only; the live sender is a constant `false`.
- **Privacy:** the delivery log holds no address and no message text; the address leaves the database only through the worker claim.
- **Database pattern:** definers with owner policies keyed on settings (0041 pattern), restricted-owner tests as `tester`.

## Tasks

### Task 1: Pure pieces

**Files:** `src/lib/community-email.ts`, `src/lib/community-email-token.ts`, `messages/en.json`, `tests/unit/community-email.test.ts`, `tests/unit/community-email-token.test.ts`.

- [ ] Token tests: valid, tampered, expired, wrong purpose, wrong user or community. Then implement.
- [ ] Renderer tests: instant and digest text, title trimming and control-character removal, links, headers with and without an unsubscribe link. Then implement and add the `CommunityEmail` message keys.
- [ ] Run the unit and source-guard checks, then commit.

### Task 2: Migration 0042 and database tests

**Files:** `src/db/schema.ts`, `drizzle/0042_community_email.sql` (+ snapshot and journal), `tests/integration/community-email-db.test.ts`, `tests/integration/community-joining-definer-owner.test.ts` (extended).

- [ ] Schema: the two membership columns and `communityEmailDeliveries`; generate the migration.
- [ ] Hand-written SQL: RLS and policies, the six definers, the replaced purge and reset functions, grants.
- [ ] Database tests from the spec's testing list. Run the restricted-owner suites as `tester`. Commit.

### Task 3: Worker, senders and routes

**Files:** `src/server/community-email.ts`, `src/server/community-email-sender.ts`, the two routes, `scripts/send-community-email.ts`, `package.json`, `tests/integration/community-email.test.ts`.

- [ ] Tests: end-to-end run into a temporary mailbox file, concurrency, retry after a lock expires, the preferences route and the unsubscribe route (valid, invalid and expired tokens give the same response), the live sender refusing to run.
- [ ] Implement. Run typecheck and lint. Commit.

### Task 4: Records, PR, CI, review

- [ ] `docs/acceptance/communities-c15b.md`, the ADR 0013 status, the feature-flags doc and `CLAUDE.md` (0042 used by C15b, 0043 next).
- [ ] Full unit and integration suites plus the `tester` suites.
- [ ] Open the draft PR. GitHub Actions runs on the PR. Run the Neon check from `main` with `pr_number` and `expected_sha`. Start the independent review. Do not merge without the founder's approval.
