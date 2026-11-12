# Communities C12b: warnings, appeals, edit history (design)

Status: approved by the founder on 12 Nov 2026 as the second half of C12 ("Use the Studio Admin design"). Plan: `docs/superpowers/plans/2026-11-12-communities-c12b-moderation.md`. Migration `0040_community_moderation_b`. Stacked on C12a (PR #63).

References: C12a design (`2026-11-12-communities-c12a-moderation-design.md`), ADR 0013 §4a and §5.

## Rules (pure, `src/lib/moderation.ts`)

- A warning reason is 1-500 characters. An appeal is 1-1000 characters. A decision reply is at most 500.
- Warn follows the C12a rank rules (`canActOn`): lower ranks only, never the owner, never oneself.
- Appeals: any host may decline; only the owner and admins may approve (approving is an unban).
- One appeal per ban: a person may send a new appeal only if none was sent since their latest ban. An open appeal blocks another.
- Edit history keeps the previous version only when the content changed, and at most the latest 50 versions per item.

## Data (migration 0040)

New tables, all with FORCE RLS, staff read policy (`app.tenant_id`), host read policy (`community_is_host`) and an owner policy keyed on `app.community_definer_tenant`. The app role has no direct writes.

- **`community_warnings`**: `id`, `tenant_id`, `community_id`, `user_id` (subject), `issued_by`, `reason`, `created_at`, `acknowledged_at`.
- **`community_appeals`**: `id`, `tenant_id`, `community_id`, `user_id`, `message`, `status` (`open`, `approved`, `declined`), `reply`, `decided_by`, `decided_at`, `created_at`. One open appeal per person per community (partial unique index).
- **`community_post_revisions`**: `id`, `tenant_id`, `community_id`, `post_id`, `title`, `body`, `body_text`, `saved_at` (when that version became current), `created_at`.
- **`community_comment_revisions`**: `id`, `tenant_id`, `community_id`, `comment_id`, `body`, `saved_at`, `created_at`.
- **`community_moderation_actions.action`** gains `warn`, `appeal_approve` and `appeal_decline`.
- A new owner SELECT policy on `community_memberships` and an extended one on `community_appeals`, both keyed on `app.community_resolve_user`, let the banned person list their own bans across ministries (same pattern as applications).

## Definers (jsonb `{outcome, id}`, same pattern as 0039)

- `community_warn(slug, user_id, reason)`: hosts, rank rules, active target. Logs `warn`, audits.
- `community_warning_ack(slug, warning_id)`: the warned member, once. Audits.
- `community_my_warnings(slug)`: the member's unacknowledged warnings (id, reason, date); issuers are never returned.
- `community_appeal_submit(slug, message)`: the banned member. Outcomes `ok`, `duplicate`, `invalid`, `not_found`. Audits.
- `community_appeal_decide(slug, appeal_id, decision, reply)`: hosts. Approve sets the membership to `left` (as C12a unban). Logs `appeal_approve` or `appeal_decline`, audits.
- `community_my_bans()`: the caller's banned communities (and approved appeals from the last 30 days) with the latest appeal.
- Changed (signatures kept): `community_post_save` and `community_comment_save` write a revision on edit; `community_member_moderate` closes an open appeal as approved on unban; `community_moderation_members` adds each member's warning count.

## Server and routes

- `warnMember`, `acknowledgeWarning`, `myWarnings`, `moderationAppeals`, `decideAppeal`, `postRevisions`, `commentRevisions` in `src/server/community-moderation.ts`; `submitAppeal` and `myBans` in the same file.
- `POST /api/communities/[slug]/moderation/warnings`, `POST /api/communities/[slug]/warnings/[warningId]`, `GET|POST /api/communities/[slug]/moderation/appeals`, `GET /api/communities/[slug]/moderation/revisions`, `POST /api/account/community-appeals`. All return 404 with the flag off; non-hosts get 404 on host routes.

## UI (Studio Admin style, existing shadcn components)

- Forum: a warning Alert per unacknowledged warning with an Acknowledge button.
- Moderation page: Members tab gets a Warnings column and a Warn row item (dialog with reason); new Appeals tab (table and review sheet with Approve and Decline and an optional reply); an Edit history sheet opened from the post byline, from replies, and from the Reports sheet. Versions render with `RichTextView` (posts) or text (replies), never HTML.
- `/account/communities`: a section for ministries the person was removed from, with an appeal dialog, the status and the host's reply.

## Not in C12b

Notifications for warnings and appeal decisions (C15); appeal rate limits beyond one per ban (activation gate).
