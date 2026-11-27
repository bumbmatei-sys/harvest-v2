# Communities C23: security, privacy, performance and accessibility release gate

PRD: `docs/prd/harvest-communities.md` §15 (nonfunctional requirements), §17 (edge cases) and §18 (release gates); C23 in §19. Migration **0129** (`0129_community_hardening`, chained after 0126 on main; 0127 and 0128 belong to open PRs #300 and #302).

This is a checklist, not an approval. It approves no HC-02 gate, no production migration, no deployment and no real data. Communities stay hard-off in production.

**Status key.** PASS: evidence exists in the repository and was run for this PR. GAP: a missing test or behaviour; "fixed" ones are fixed here, "open" ones are follow-ups. GATE: needs a founder, privacy or legal decision before real use.

**Totals.** 104 items: 81 PASS, 6 GAP fixed in this PR, 10 GAP open, 7 GATE.

## How the catalog checks work

`tests/integration/community-c23-hardening.test.ts` loops over the live catalog after all migrations. A table is in scope when its name starts with `communit` or `discover_`, or when it has a `community_id` column (40 tables). A function is in scope when its name matches `communit`, `discover_`, `dm_` or `chat_` (100+ definers). A future table or function that breaks a rule fails the test without anyone adding it to a list. The reviewed lists inside the test (application grants, worker definers, single-flag definers) fail on any change, so a change is a conscious, reviewed edit.

`tests/unit/community-c23-hardening.test.ts` is the static half: logs, audit metadata, route wrappers, the Harvest Connect boundary and the 429 mapping.

## 1. Platform-wide database rules

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1.1 | Every community and Discover table has RLS enabled and FORCE RLS | `community-c23-hardening` catalog: "forces row-level security…" | PASS |
| 1.2 | Every such table has at least one policy; none is owned by the app role | same | PASS |
| 1.3 | The app role's privileges per table match the reviewed list; no TRUNCATE, REFERENCES or TRIGGER; PUBLIC and the worker role have none | same (`appGrants`) | PASS |
| 1.4 | Every community function pins `search_path = pg_catalog, pg_temp` | catalog: "pins search_path…" | PASS |
| 1.5 | No definer is executable by PUBLIC or owned by the app role; worker-only definers are the reviewed 14; none is executable by both app and worker | same | PASS |
| 1.6 | Every community definer clears app.* flags on entry, through `community_definer_reset`, a `*_scope_clear` helper or an explicit blanking loop, directly or through its entry helper | catalog: "clears the app.* flags…" (call-graph walk) | PASS |
| 1.7 | The 12 definers that set only one scope flag are reviewed, still set only that flag, and blank or restore it | same (`scopedFlagDefiners`) | PASS |
| 1.8 | `community_definer_reset` blanks every flag that an owner-role policy on a community table reads | same; **0129 added nine missing flags** (`app.catalog_tenant`, `chat_purge`, `chat_settings`, `community_stats_write`, `discover_platform`, `dm_evidence_report`, `dm_purge`, `events_tenant`, `live_community`) | GAP fixed |
| 1.9 | Workspace roles are read through `public.access_role` in every community function and policy | catalog: "asks public.access_role…"; `tests/unit/access-guard.test.ts` | PASS |
| 1.10 | Definers work with a non-bypass, FORCE-RLS owner (production shape) | `community-joining-definer-owner.test.ts` (7 flows) | PASS |
| 1.11 | Two-ministry isolation for staff paths, grants and cross-ministry writes | `communities.test.ts` ("keeps staff paths inside their own ministry…", "does not count a grant issued by another ministry…") | PASS |

## 2. Creation and editor

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 2.1 | Draft by default, private, free; creator becomes owner; audited | `communities.test.ts` | PASS |
| 2.2 | Globally unique, well-formed slug; reserved names refused | `communities.test.ts`, `tests/unit/community-slug.test.ts` | PASS |
| 2.3 | Only owners/admins create; viewers list; other ministries get 403 and no rows | `communities.test.ts` | PASS |
| 2.4 | Optimistic version on settings; paid pricing refused until commerce exists | `communities.test.ts` | PASS |
| 2.5 | Publish only when ready; per-ministry cap | `communities.test.ts`, `community-joining.test.ts` ("caps communities per ministry") | PASS |
| 2.6 | Editor screens pass axe (light/dark, phone/desktop) | `tests/e2e/community-editor.spec.ts`, `kit-pr7-communities.spec.ts` | PASS |

## 3. The address lock

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 3.1 | A published community's address (slug) cannot change; the API answers 409 | `tests/e2e/shell-slice3b.spec.ts` (PATCH answers 409) | PASS |
| 3.2 | The lock is covered at the service level, not only in a browser test | **added** `community-c23-hardening` behaviour: "keeps the published address locked" | GAP fixed |
| 3.3 | The lock is enforced by the database as well (the app role has UPDATE on `communities`) | none: the check lives in `updateCommunity` only | GAP open (F3) |

## 4. Joining and invitations

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 4.1 | Current rules and adult (18+) confirmation required; idempotent join | `community-joining-db.test.ts`, `community-joining.test.ts` | PASS |
| 4.2 | Personal invite redeemable once, only by the invited email, before expiry and revocation | `community-joining-db.test.ts` | PASS |
| 4.3 | A fake invite answers the same for a missing and a hidden community (no existence oracle) | `community-joining.test.ts`, `community-joining-db.test.ts` | PASS |
| 4.4 | Concurrent joins are safe; paid and closed-invite paths refused | `community-joining-db.test.ts` | PASS |
| 4.5 | Only managers create invitations | `community-joining.test.ts` | PASS |
| 4.6 | Invitation creation is rate limited (PRD §15) | none beyond one open invite per email and community; managers only | GAP open (F4) |
| 4.7 | Join and invite screens pass axe; 44px targets | `tests/e2e/community-joining.spec.ts` | PASS |

## 5. Applications

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 5.1 | One open application per person and community; withdraw and resubmit | `community-applications-db.test.ts`, unique index `community_applications_open_idx` | PASS |
| 5.2 | Applications out of reach of applicants, members and other ministries | `community-applications-db.test.ts` | PASS |
| 5.3 | Banned people cannot be approved; queue limited to managers; old staff role never restored | `community-applications.test.ts` | PASS |
| 5.4 | Declined and withdrawn applications purged after 90 days | `community-applications-db.test.ts` | PASS |
| 5.5 | Applications across many communities are rate limited (PRD §15) | none (one per community only) | GAP open (F4) |
| 5.6 | Application screens pass axe | `tests/e2e/community-applications.spec.ts` | PASS |
| 5.7 | Edge case 17: simultaneous moderator decisions resolve once | `decideApplication` locks the row (`FOR UPDATE`) and answers 409 once decided; no test runs two deciders at once | GAP open (F10) |

## 6. Forum

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 6.1 | Rich text sanitized; unsafe links and insecure video refused | `community-forum.test.ts` ("validates rich text…") | PASS |
| 6.2 | Members only; outsiders and ministry viewers get 404 | `community-forum.test.ts` | PASS |
| 6.3 | Uploads: own, ready, right kind; quarantined until a scanner says clean in production; signed download links | `community-forum.test.ts`, `docs/acceptance/communities-c09-c10.md` | PASS |
| 6.4 | Forum posts and replies are rate limited (PRD §15) | **added** trigger `community_write_rate_guard` (0129): 10 posts and 30 replies per person per community in 10 minutes, then 429 with nothing kept; `community-c23-hardening` behaviour tests | GAP fixed |
| 6.5 | Forum list paged (50) with indexes for the default and the category-filtered list | `community-forum.test.ts` ("pages the forum…"); **added** index `community_posts_category_feed_idx`; catalog index check | GAP fixed |
| 6.6 | Forum, post and member screens pass axe at three widths, light and dark | `tests/e2e/community-forum.spec.ts` | PASS |

## 7. Chat and private messages

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 7.1 | Channel access by role and invite; reconnect state; unread counts | `community-chat.test.ts`, `tests/unit/community-chat.test.ts` | PASS |
| 7.2 | Messages, edits and reactions rate limited; slow mode | `community-chat.test.ts` (0057 `rate_limited`, `slow_mode`) | PASS |
| 7.3 | Private messages: participants only, blocks, mute, start cap, identical `not_available` refusal | `community-dm.test.ts`, `docs/acceptance/communities-dm-start-privacy.md` | PASS |
| 7.4 | DM report evidence has no app table privileges | catalog grant list (`community_dm_report_evidence: ""`), `community-dm.test.ts` | PASS |
| 7.5 | Chat unread and DM unread indexed | catalog index check (`community_channel_reads`, `community_messages(channel_id, seq)`, `community_dm_participants`, `community_dm_messages(conversation_id, seq)`) | PASS |
| 7.6 | Chat and DM screens pass axe; 44px targets on phone | `tests/e2e/community-chat.spec.ts`, `community-dm.spec.ts` | PASS |
| 7.7 | 30-day deletion sweep, health check and alerts | `community-chat-retention.test.ts`, `tests/unit/community-chat-purge-worker.test.ts`, `docs/acceptance/communities-c11d-schedule.md` | PASS |

## 8. Moderation

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 8.1 | Reports, queue, hold, remove, mute, ban, appeals, warnings, edit history | `community-moderation.test.ts`, `community-moderation-db.test.ts`, `community-moderation-b.test.ts`, `community-moderation-b-db.test.ts` | PASS |
| 8.2 | Reporters never shown to the reported person | `community-moderation-db.test.ts` | PASS |
| 8.3 | Reports of every kind are rate limited (PRD §15) | **added** 20 reports per person per community in 10 minutes (0129 trigger on `community_reports`) | GAP fixed |
| 8.4 | Moderators lack financial and private pastoral data by default (PRD §18 C) | edge case 16 checks below; moderation reads only community tables | PASS |
| 8.5 | Moderation screens pass axe | `tests/e2e/community-moderation.spec.ts`, `community-moderation-b.spec.ts` | PASS |

## 9. Notifications and email

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 9.1 | In-app notifications, preferences, mute and welcome card | `community-notifications.test.ts`, `community-notifications-db.test.ts` | PASS |
| 9.2 | Email routing, digest, retry and lock; no address or message text in the delivery log | `community-email-db.test.ts`, `community-email.test.ts` | PASS |
| 9.3 | One-click unsubscribe with a signed token and the same answer for any token | `community-email.test.ts`, `tests/unit/community-email-token.test.ts`; route check in the unit gate | PASS |
| 9.4 | Notification screens pass axe | `tests/e2e/community-notifications.spec.ts` | PASS |
| 9.5 | Real outbound email | sender refuses live delivery; production sender not approved | GATE (G4) |

## 10. Classroom and products shelf

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 10.1 | A shelf link grants nothing; access follows `public.catalog_access` | `community-shelf.test.ts`, `docs/acceptance/communities-c13-c16.md` | PASS |
| 10.2 | Upgrade path runs as a restricted owner | `community-shelf-upgrade.test.ts` | PASS |
| 10.3 | Classroom and Products screens pass axe | `tests/e2e/community-shelf.spec.ts` | PASS |
| 10.4 | Paid plans, checkout, refunds and chargebacks (C17, C18) | not built; provider UNDECIDED | GATE (G5) |

## 11. Discover listing

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 11.1 | Hard-off by default; neutral 404 to members, viewers and other ministries | `discover-server.test.ts` | PASS |
| 11.2 | Listed only after platform approval, with minimal public fields; back to review on change | `discover-server.test.ts` | PASS |
| 11.3 | Unlisted at once on unpublish, hidden or opt-out | `discover-server.test.ts`, `community-joining.test.ts` | PASS |
| 11.4 | No contacts, members or payments in any Discover table | `discover-server.test.ts` | PASS |
| 11.5 | Reports from signed-in people only, rate limited, reporter hidden | `discover-server.test.ts`, `discover_report` (0100) | PASS |
| 11.6 | Anonymous Discover reads are rate limited | none: `/api/discover` and `/api/discover/listings` are bounded and cached privately but not throttled | GAP open (F1) |
| 11.7 | Discover screens pass axe | `tests/e2e/discover-screens.spec.ts`, `discover-staff.spec.ts` | PASS |
| 11.8 | Production enablement of Discover | hard-off; needs platform review staffing and founder approval | GATE (G6) |

## 12. Member profiles and directory

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 12.1 | Same neutral 404 for outsider, unknown person and non-member | `community-member-profile.test.ts`, `tests/e2e/community-member-profile.spec.ts` | PASS |
| 12.2 | No contact email or private account fields; volunteered details only | `community-member-profile.test.ts`, `community-profile-details.test.ts` | PASS |
| 12.3 | Hidden, non-member and other-tenant targets identical for peers and moderators | `community-profile-details.test.ts` | PASS |
| 12.4 | Directory and profiles indexed | catalog index check (`community_memberships`, `community_member_profiles`) | PASS |
| 12.5 | Profile screens pass axe | `tests/e2e/community-member-profile.spec.ts`, `profile-editing.spec.ts` | PASS |

## 13. Erasure and retention

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 13.1 | Account deletion cascades; volunteered profile fields erased after leaving | `community-profile-details.test.ts` | PASS |
| 13.2 | Exit records readable by owners and admins only; erased with the person | `community-retention.test.ts` | PASS |
| 13.3 | Anonymous acquisition counting off by default, bots ignored | `community-retention.test.ts` | PASS |
| 13.4 | Applications 90 days, notifications purge, chat 30 days | `community-applications-db.test.ts`, `community-notifications-db.test.ts`, `community-chat-retention.test.ts` | PASS |
| 13.5 | Retention numbers and erasure policy for public contributions (edge case 18) | engineering defaults only | GATE (G2) |

## 14. Privacy and Harvest Connect referrals

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 14.1 | Edge case 16: joining a community never shares Connect responses, consents or counselling with moderators. No community function, policy or service reads campaign responses, Connect tables, follow-up cases, form responses or pledges | **added** catalog check and unit check (both "edge case 16") | GAP fixed |
| 14.2 | No inferred religious label from joining; membership, marketing and pastoral consents separate | `docs/decisions/hc-02-activation-gates.md`; community tables hold no consent purpose | PASS |
| 14.3 | Small-group suppression in community stats | `community-stats.test.ts`, `community-retention.test.ts` | PASS |
| 14.4 | Real personal or pastoral data, special-category basis (EEA Article 9) | the five HC-02 gates are UNAPPROVED | GATE (G1) |
| 14.5 | Minors (edge case 19): adults only at launch; any minors programme | adult confirmation enforced (4.1); no minors programme | GATE (G3) |
| 14.6 | Prayer-request data in Community Live (sensitive category) | `community-live.test.ts`; retention and encryption under HC-DEC3–5 | GATE (G7) |

## 15. Public endpoints

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 15.1 | Every community and Discover API route answers 404 while the flag is off, before authentication | unit gate: "routes every community API call…" | PASS |
| 15.2 | Writes check the origin; member routes require a verified session; the three anonymous routes are listed | same | PASS |
| 15.3 | Hidden or missing communities, profiles and DMs answer the same 404 | `community-joining.test.ts`, `community-member-profile.test.ts`, `community-dm.test.ts`, `discover-server.test.ts` | PASS |
| 15.4 | Write limits answer 429 with one fixed message and `Retry-After` | unit gate: "answers a database write limit…" | PASS |
| 15.5 | The anonymous count beacon and unsubscribe answer the same for every input | `community-retention.test.ts`, `community-email.test.ts` | PASS |
| 15.6 | The anonymous unsubscribe endpoint and public community page are throttled | none; tokens are signed and answers constant, so brute force learns nothing | GAP open (F1) |

## 16. Logs and audits

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 16.1 | Community code logs fixed event names only | unit gate: "logs only fixed event names…" | PASS |
| 16.2 | Audit metadata from community services holds ids, field names and enums only | unit gate: "keeps audit metadata…" | PASS |
| 16.3 | Audit inserts in community definers hold no contact details or member text | catalog: "writes no contact details…" | PASS |
| 16.4 | No email address in audit rows written by the forum, report and join flows | behaviour: "left no email address in any audit row…" | PASS |

## 17. Performance

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 17.1 | Hot queries indexed: forum list (default and category), comments per post, likes, chat and DM unread, member list, notification inbox, application and report queues, write-limit lookups | catalog: "indexes the hot queries…" | PASS |
| 17.2 | Paginated feeds and channels | `community-forum.test.ts`, `community-chat.test.ts` | PASS |
| 17.3 | p75 LCP ≤ 2.5 s on a representative mobile profile; measured throughput | no load test or field measurement | GAP open (F5) |

## 18. Accessibility

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 18.1 | axe (WCAG 2.2 AA tags) on every member screen: forum, post, members, member profile, chat, messages, moderation, classroom, products, events | the specs above | PASS |
| 18.2 | axe on the owner screens: community list, editor, Discover manage, platform Discover, account communities | `kit-pr7-communities.spec.ts`, `community-editor.spec.ts`, `discover-screens.spec.ts`, `discover-staff.spec.ts`, `community-joining.spec.ts` | PASS |
| 18.3 | axe on the About page | visited in `community-forum.spec.ts` but not audited | GAP open (F2) |
| 18.4 | 44px tap targets on phone for the bottom bar, chat controls and send | `community-forum.spec.ts` (bottom bar), `community-chat.spec.ts` (controls and send) | PASS |
| 18.5 | A 44px check across every interactive element of every community screen | only the controls above are measured | GAP open (F2) |
| 18.6 | Video captions and transcript hooks | not built | GAP open (F6) |

## Fixed in this PR

- **0129** `community_definer_reset` now also blanks nine owner-policy flags it had missed (1.8). Same body as 0124 otherwise; every community, giving and link-in-bio integration file passes with it.
- **0129** `community_write_rate_guard`: one `BEFORE INSERT` trigger on `community_posts` (10), `community_comments` (30) and `community_reports` (20), per person per community per 10 minutes. It counts as the caller, under the definer's own tenant scope, behind a per-person advisory lock. SQLSTATE `P0429` maps to HTTP 429 in `errorResponse`, and the whole transaction rolls back. Existing definers are unchanged. The forum paging test now ages its seeded posts between batches.
- **0129** indexes: `community_posts(community_id, category_id, pinned, created_at)` for the category list, and `(community_id, author_id, created_at)` on posts, comments and `(community_id, reporter_id, created_at)` on reports for the limit.
- Tests: the catalog loop and behaviour tests (`tests/integration/community-c23-hardening.test.ts`), the static gate (`tests/unit/community-c23-hardening.test.ts`), the address lock at service level, and the edge case 16 boundary.

No backfill, so the 0091 NO FORCE pattern is not needed. No UI change and no new kit item.

## Open follow-ups (GAP)

| ID | Item | Proposed fix |
|---|---|---|
| F1 | Anonymous reads (`/api/discover`, `/api/discover/listings`, `/communities/:slug`) and unsubscribe are not throttled (11.6, 15.6) | Platform firewall rate rule per IP for these paths, or the existing hashed-IP limiter pattern used by link in bio. Needs an infrastructure choice. |
| F2 | About page not audited by axe; no screen-wide 44px sweep (18.3, 18.5) | Add `shoot(a, "about")` in `community-forum.spec.ts`, and a shared helper that measures every visible button and link at phone width. Needs a browser run. |
| F3 | Address lock only in the service (3.3) | `BEFORE UPDATE` trigger on `communities` refusing a slug change while `status = 'published'`. |
| F4 | Invitation creation and cross-community applications have no time-window limit (4.6, 5.5) | Extend `community_write_rate_guard` to `community_invites` and `community_applications` once thresholds are agreed. |
| F5 | No load test or LCP measurement (17.3) | Measure on a Preview deployment with synthetic data before launch. |
| F6 | Video captions and transcript hooks (18.6) | Part of the Live and Classroom media work. |
| F7 | Two-workspace adversarial coverage of search, notifications, AI and media as one suite (PRD §18 F) | Per-area tests exist; a single adversarial suite is still to write. |
| F8 | Write-limit thresholds (10, 30, 20 per 10 minutes) are engineering defaults | Confirm with real usage on Preview; the numbers are trigger arguments, so a change is one migration. |
| F9 | The limit message says "posting" for reports as well | Wording review with the next copy pass. |
| F10 | No concurrent two-moderator decision test (5.7) | Two transactions deciding the same application; exactly one wins, the other gets 409. |

## Decisions needed (GATE)

| ID | Decision | Owner |
|---|---|---|
| G1 | The five HC-02 privacy and security activation gates, including the Article 9 basis for faith and pastoral data | Founder, privacy review |
| G2 | Retention periods and the deletion or anonymisation policy for public contributions (edge case 18) | Founder, privacy review |
| G3 | Minors: keep adults only at launch (as built) or approve a minors programme | Founder, legal |
| G4 | Production email sender and real delivery | Founder |
| G5 | Payment provider for paid communities and product sales (UNDECIDED; Dodo stays SaaS billing only) | Founder |
| G6 | Production enablement of Discover and the platform review process | Founder |
| G7 | Prayer-request data handling in Community Live (HC-DEC3 to 5) | Founder, privacy review |

## Test runs for this PR

- `tests/integration/community-c23-hardening.test.ts`: 14 tests (8 catalog, 6 behaviour). `tests/unit/community-c23-hardening.test.ts`: 6 tests.
- Every community, Discover, giving, link-in-bio, events, catalog, erasure, RLS and `qa-seed` integration file: 40 files, 325 tests, pass. In the two-worker run `community-notifications-db` failed in setup with an empty embedded-database error; run alone it passed 9 of 9.
- Full unit suite: 163 files, 1,850 tests: pass. `tsc --noEmit` and `npm run lint`: clean.

## Not run for this PR

- Browser (E2E) suites: no UI changed. The axe and tap-target evidence above is from the existing specs on main.
- The Neon migration check: it runs from `main` by hand (`neon_only=true`) for PRs that change `drizzle/`.
- No production migration, deployment or real email.
