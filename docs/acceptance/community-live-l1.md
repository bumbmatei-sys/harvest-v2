# Community Live L1 — server foundation

Built for local synthetic verification; **UNAPPROVED, not activated**. All five HC-02 gates remain UNAPPROVED. Production collection/delivery remain hard-disabled; production migrations 0031+ are unapplied. This PR implements only the server/library portion of requested L1. No member page, editor step, UI messages, navigation, iframe rendering or CSP change is included; those remain with the UI workstream.

## Contract and decisions

- Migration `0055_community_live_l1` adds one FORCE-RLS event table with composite ministry/community ownership, optimistic versions, UTC schedule/actual start/end, lifecycle, a held comments-mode default, and an unused donation slot constrained to null. No comments, prayer, donation or provider credential storage/path exists.
- Pure URL validation accepts only the exact HTTPS host/shape allowlist in Live §5 and an 11-character id. Extra query parameters, fragments, userinfo, whitespace, backslash tricks and noncanonical shapes are rejected rather than preserved. Only the id is stored. Embed URL construction adds no autoplay. There is no fetch, URL probing or provider SDK.
- Lifecycle: draft → scheduled → live → ended; draft/scheduled may cancel; ended → replay and replay → ended are explicit owner/admin actions. Same-state edits are allowed with a current version. Replay is never automatic. After starting, the schedule is immutable. Title/video/comments settings can still be edited with a version check.
- Members need active membership plus a valid same-ministry grant (or an active community staff role), the existing `community_can_read` contract, and a published community. Non-members, banned/left members and unrelated community members get no events. A ministry member/viewer has no staff bypass. A viewer who independently has legitimate community membership is governed by that community access, not their ministry role.
- Ministry owner/admin and active community owner/admin may manage and read drafts outside the member window. A community moderator may view through normal member access and has the future moderation capability, but cannot create/edit/schedule/end. No moderation endpoint exists in L1. Existing community content read policies are unchanged.
- The member window is inclusive: 24 hours before scheduled start through 7 days after actual end (scheduled start if not ended). Explicit `replay` remains visible while published. Draft/cancelled events are absent from member reads. The window is enforced in direct app-role RLS and the narrow read definer.
- Automatic close is due 12 hours after **actual** start, produces `ended`, increments version and audits once. `community_live_auto_close(slug)` is a scoped owner/admin-authorized operation, not an enabled job or global worker capability. Scheduling it operationally remains unbuilt/unverified.
- Reuse HC-14's nullable system-actor convention for automatic close. Extend `audit_system_actor` only for `community.live.auto_close`; ordinary app audit inserts still require the current actor. Automatic rows contain community/event ids, state and version only; no fake login/system account. User edits and audit commit together. Authorization rows are locked during writes; failures roll back both changes and audit. Denial logging is not implemented, consistent with existing platform limitations.

## Services and routes

`src/server/community-live.ts`: `saveLiveEvent`, `listLiveEvents`, `autoCloseLiveEvents`. Create uses version 0; full updates require the current version and apply the state machine in SQL. Scheduling, ending and explicit replay are state changes through the same guarded service, not separate weaker mutations.

- `GET/POST /api/communities/[slug]/live`: list/create.
- `GET/PUT /api/communities/[slug]/live/[eventId]`: get/full versioned update, including schedule/go-live/end/replay.
- List is bounded to 100 ordered events; further paging is not in this slice. Direct-id reads do not depend on being in that first page.
- Existing community route wrapper provides session/origin checks and private/no-store responses. A stronger Live gate returns 404 **before authentication/database creation** in production, even if `HARVEST_COMMUNITIES=enabled`. Services also enforce this gate. SQL functions do not inspect application environment; database migration deployment and execution privileges remain separate operational controls. No production migration or activation was performed.

Definers have fixed `search_path = pg_catalog, pg_temp`, fully qualified objects, PUBLIC execution revoked, minimal app execution grants and restricted-owner context policies. The context helper is not callable by the app. The app has SELECT only on events; all writes use authorized definers. Context is cleared on success/error. The journal time exceeds 0054 and the 0055 snapshot links to 0054; no merged migration was renumbered.

## Evidence and limitations

Focused unit cases cover all URL hosts/shapes and hostile inputs, state transitions, inclusive window/auto-close boundaries, permissions and production-gate refusal before route work. Restricted-owner integration uses `testDatabase({migrationOwner:true})`, runs/replays the migration chain, checks two tenants and two communities, owner/admin/moderator/member/viewer/non-member/banned access, direct-write denial, stale versions, explicit replay, metadata audit, scoped idempotent automatic close, SQL/TypeScript rule parity and function security properties. A network spy refuses any fetch and asserts none occurred.

Final local full-suite counts and independent review are recorded in the PR after completion. Not verified: GitHub Actions at the final head, trusted-main Neon migration check, production RLS/environment provisioning, browser/iframe/provider behavior, CSP or click-to-load UI, scheduling/load, legal/privacy approval or real data. A **Neon migration run from trusted main is needed** before any later migration application decision. Local embedded Postgres evidence is not Neon evidence.

Founder follow-ups: held-by-default comments configuration and the 24-hour/7-day window/12-hour safeguard are engineering defaults requested for this slice, not approvals of the broader Live design or HC-02 gates. UI click-to-load/CSP, accessibility and raw-provider-link disclosure must be verified in a separate UI PR. No founder choice is required to keep this synthetic server slice disabled.
