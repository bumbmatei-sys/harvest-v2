# Communities migration guide (C24)

Status: written 27 Nov 2026 against `main` at `312650f` (journal ends at `0126_newsletter_click_tracking`).

**None of these migrations is applied to production. Applying any of them to staging or production needs the founder's explicit approval for that environment and that run.** Applying the schema switches nothing on: Communities stay hard-off until `HARVEST_COMMUNITIES=enabled` is set, and chat, Live, events, profile details, the shelf and Discover cannot open in production at all ([runbook](../runbooks/communities.md#1-feature-flags)).

The general procedure (restore branch, roles, apply as `harvest_owner`, verify, record) is `docs/setup/production-migrations.md`. This page adds what is specific to Communities. There is still no production migration job (the "Missing piece" in that runbook).

## 1. Community migrations, in apply order

The migrator applies every pending migration in journal order, in one transaction. You cannot apply only the community ones: the numbers in between (CRM, Connect, newsletter, social and others) go with them. This list is the ones that create or change community or Discover objects.

| Migration | Slice | What it does |
|---|---|---|
| `0035_communities` | C01-C03 | `communities`, `community_memberships`, `entitlements`; FORCE RLS; draft, hidden and free by default. |
| `0036_community_joining` | C05, C06, C08 | `community_invites` (hashed, one-time, 14 days) and `discover_listings`; public definers `community_public`, `community_enter`, `discover_communities`, `community_my_invites`. |
| `0037_community_applications` | C07 | `community_applications`, join questions and the rules list; `community_purge_applications()` for the 90-day purge. |
| `0038_community_forum` | C09, C10 | Forum tables: `community_categories`, `community_posts`, `community_comments`, `community_likes`, `community_files`. |
| `0039_community_moderation` | C12a | `community_reports`, `community_moderation_actions`; mute, ban, held content and banned words. |
| `0040_community_moderation_b` | C12b | `community_warnings`, `community_appeals`, `community_post_revisions`, `community_comment_revisions`. |
| `0041_community_notifications` | C15a | `community_notifications`, preferences, welcome card, `community_purge_notifications()`. |
| `0042_community_email` | C15b | Email frequency on memberships, `community_email_deliveries`, the email worker definers and the unsubscribe definer. |
| `0044_worker_db_role` | worker role | Moves the three community email worker functions (and three Connect retention ones) from `harvest_app` to `harvest_worker`. |
| `0055_community_live_l1` | Live L1 | `community_live_events`. |
| `0057_community_chat` | C11a | Channels, messages, reactions, read state, chat state, `community_chat_purge_runs`; worker-only purge and health functions. |
| `0058_community_dm` | C11c | Private messages: conversations, participants, messages, blocks, report evidence; DM purge. |
| `0059_events_e01` | C14 E01 | `events`, `event_rsvps`, `event_join_links` and `community_event_links`. |
| `0061_free_catalog` | catalogue | Free catalogue tables and `community_product_links`. |
| `0062_community_member_profiles` | C09b | `community_member_profiles` (voluntary profile fields). |
| `0063_community_dm_start_privacy` | C11c follow-up | Checks the sender's limits before looking at the recipient when a private message starts. |
| `0064_events_e02` | C14 E02 | Event location and waitlist; place an event in a community. |
| `0065_event_covers` | C14 | `event_files` for event covers. |
| `0066_member_profile_followups` | C09b follow-up | Changes the member roster and profile erasure functions. |
| `0068_event_cover_cleanup` | C14 | Upload cap trigger and worker-only cover cleanup functions. |
| `0077_worker_job_leases` | CF-04 | Worker lease tables; bounded worker-only `community_purge_applications(integer)` and `community_purge_notifications(integer)`. |
| `0094_link_in_bio` | link in bio | Reserves `communities` as a bio handle; the public bio page can show a ministry's community card. |
| `0100_discover_server` | Discover | `discover_controls`, `discover_ministry_standing`, `discover_reports`, `discover_review_events`; review functions for the worker role. |
| `0101_community_retention` | stats | `community_daily_counts`, `community_exits`; `community_leave`, `community_count_event`. |
| `0103_platform_staff` | Discover review | `platform_staff`, `platform_staff_audit`; staff wrappers for the Discover review queue. |
| `0113_feature_access` | feature access | Per-member access areas, including `communities`, used by community functions. |
| `0116_campaign_events` | campaigns | Campaign event links; Events access goes through the `communities` area. |
| `0119_ways_to_give` | giving | Replaces `community_definer_reset` (adds the giving flags). |
| `0123_community_shelf` | C13, C16 | Classroom and Products shelf: `kind` and `featured` on `community_product_links`. |
| `0124_give_pages` | giving | Replaces `community_definer_reset` again (adds the give-page flags). |
| `0128_community_address_lock` | **pending PR #302** | `first_published_at`, the `community_address_lock` trigger, backfill, and `unsubscribe` added to the reserved addresses. |
| `0129_community_hardening` | **pending PR #303** | Write-limit trigger `community_write_rate_guard` on posts, replies and reports; four indexes; `community_definer_reset` gains nine missing flags. |

Other migrations touch community names only in passing (for example the audit action list in 0060, 0076, 0094 and 0102). `0114_role_statement_timeout` sets statement limits for `harvest_app` and `harvest_worker`, which the community workers use.

0127 (newsletter audience growth, #300) has merged (newsletter, `0127_newsletter_audience_growth`). 0049, 0090 and 0121 are unused numbers. Never renumber a merged migration.

## 2. Journal order (re-dating rule)

The migrator decides what is pending by timestamp: it runs a migration only when its journal `when` is later than the newest one already recorded. A migration that merges later must therefore also have a later `when`; re-chaining regenerates the entry with a fresh timestamp. This is allowed only while unmerged.

| Migration | Status | Journal `when` |
|---|---|---|
| 0127 | merged (#300) | 1795746812980 |
| 0128 | #302 (re-chained after 0127) | 1795752720179 |
| 0129 | #303 | must be re-dated above 1795752720179 when re-chained after 0128 |
| 0130 | #306 (course structure) | must be re-dated above both 0128 and the re-dated 0129 |

## 3. Pre-checks (per environment)

Run as `harvest_owner` on the target, after the restore branch is made.

1. **Applied state.** `select count(*), max(created_at) from drizzle.__drizzle_migrations;` and compare with the journal on the approved commit. Write down every migration that will run.
2. **Roles.** `harvest_app` and, if the workers will run, `harvest_worker` exist and are unprivileged (`docs/setup/worker-role.md` step 5). Create `harvest_worker` first so 0044, 0057, 0058, 0068, 0077 and 0100 grant to it. Otherwise replay each migration's labelled grant block later.
3. **Reserved address `unsubscribe` (before 0128).** The owner is under FORCE row security, so a plain select sees no rows. Check inside a transaction you roll back:
   ```sql
   BEGIN;
   ALTER TABLE public.communities NO FORCE ROW LEVEL SECURITY;
   SELECT tenant_id, id FROM public.communities WHERE slug = 'unsubscribe';   -- expect no rows
   ROLLBACK;
   ```
   If a row exists, the community must be renamed by hand first, with the founder's approval. 0128 also checks this and stops with `migration 0128: a community already uses the reserved address "unsubscribe"`, which rolls back the whole run.
4. **Other reserved addresses.** The existing check already refuses `new`, `discover`, `search`, `create`, `settings`, `admin`, `api`, `me`, `account`, so no live row can hold them.

## 4. Checks after applying

Owner connection.

```sql
-- every community and Discover table has RLS on and forced (expect no rows)
select c.relname from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
   and (c.relname like 'communit%' or c.relname like 'discover\_%'
        or exists (select from pg_attribute a where a.attrelid = c.oid and a.attname = 'community_id' and not a.attisdropped))
   and not (c.relrowsecurity and c.relforcerowsecurity);

-- FORCE was put back on the tables 0128 relaxed for its backfill (expect true, true)
select relname, relforcerowsecurity from pg_class where oid in ('public.communities'::regclass, 'public.audit_logs'::regclass);

-- 0128: the lock trigger exists and is enabled (expect one row, tgenabled = 'O')
select tgname, tgenabled from pg_trigger where tgrelid = 'public.communities'::regclass and tgname = 'community_address_lock';

-- 0129: the three write-limit triggers exist (expect three rows)
select tgrelid::regclass, tgname from pg_trigger where tgname in ('community_posts_rate_guard', 'community_comments_rate_guard', 'community_reports_rate_guard');

-- no community or Discover SECURITY DEFINER function is executable by PUBLIC (expect no rows)
select p.oid::regprocedure from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname ~ '(communit|discover_)'
   and has_function_privilege('public', p.oid, 'execute');
```

Then run the worker role checks in `docs/setup/worker-role.md` step 5 and the 0114 check in `docs/setup/production-migrations.md` step 6. The full catalog rules are in `tests/integration/community-c23-hardening.test.ts` (pending PR #303); run that suite against a copy, not production.

## 5. Order with the app

Migrate before deploying the matching code. The community migrations add tables, columns, functions and triggers, so code already running keeps working on the new schema. One exception: after 0128 the database refuses a slug change on a community that was ever published. Code from before #302 refuses it only while published, so in the gap an owner who renames an unpublished, once-published community gets a server error instead of the 409 message. Deploy #302's code right after 0128.

## 6. Rollback

No down migrations. A failed run rolls back as one transaction. After a successful run, fix forward in a new PR; restoring the pre-migration branch loses every write since and needs the founder's decision.
