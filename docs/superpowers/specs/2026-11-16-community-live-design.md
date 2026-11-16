# Community Live (livestream): design spec

Status: DRAFT proposal, 16 Nov 2026. Documentation only. Five founder decisions (16 Nov 2026) are recorded in section 15: anonymous prayer requests (option A), the V1 prayer team, prayer retention, explicit replay, and minors/age/jurisdiction. Every other item is a proposal with a recommended default, not yet confirmed. Nothing is approved for build or production activation, and nothing is built: no migration, deployment, real collection of prayer data or provider call is approved. All five HC-02 activation gates remain UNAPPROVED.

## Summary (10 lines)

1. A community can have live events: an admin pastes a YouTube live or video URL; Harvest validates it to a video id and embeds it with the privacy-friendly `youtube-nocookie` host.
2. Members only. Not a public link. Only active members of that community (and community staff) can open `/communities/:slug/live`.
3. The player is click-to-load: nothing is requested from the provider until the viewer taps play; no autoplay. CSP `frame-src` is allowed for the one embed host only.
4. Live comments start as near-live short polling (every 3 to 5 seconds, backing off), with slow mode, hold-for-approval, max length, rate limits and the existing mute/ban/report/delete tools. Real realtime comes later with C11.
5. Prayer requests (DECIDED, founder 16 Nov): the author chooses per request: anonymous or named. Anonymous hides the name from other members; the prayer team (V1: owner, admin, moderator) can still see the author, with a clear notice at submit. Requests go to a private queue; wall publishing needs the author's opt-in.
6. Prayer content is sensitive: encrypted at rest per the HC-DEC5 direction, retention 30 days after closed / 90 days max / 180 days on the wall (decided, still subject to legal review before any real collection), erased with the account, no CRM export or AI use, separate from consent purposes. Minors: the existing adult-accounts policy plus legal review before activation (decided).
7. Placement (recommended): a "Live" step in the community editor (editor mode), a live control room in the community admin area, a member Live page under `/communities/:slug/live`, and the Operations "Livestream" entry (reserved/hidden until built) listing live events across communities.
8. Donations during a live: slot reserved, nothing shown until the founder's provider workaround exists.
9. Slices: L1 data model + embed + member page; L2 editor Live step; L3 comments + moderation; L4 prayer requests; L5 control-room polish and notifications; donations later. Next migration number is the next free number at build time (the journal ends at 0052 on main today; 0053 is a candidate, not a reservation).
10. Five decisions are recorded in section 15; the other nine questions have recommended defaults, not yet confirmed. Nothing is approved for build or production; all five HC-02 gates stay UNAPPROVED. Assumptions I could not verify are in section 17.

## 1. Direction (founder, 16 Nov 2026; binding as direction, not yet a design approval)

- A community can have live streams. The admin adds a YouTube live (or video) URL and Harvest embeds it.
- Who can watch: any member of that community; members only; not a public link.
- Viewers can write live comments, send prayer requests, and later donate live (workaround to come from the founder; reserve the slot, show nothing until then).
- Prayer requests: the author chooses per request to post anonymously or with their name visible.
- Everything is moderated from the admin side where the stream lives.
- Comments start near-live (short polling every few seconds); real realtime later (C11 is after the first release).
- Placement was deferred to us: recommended in section 3.

## 2. Goals and non-goals

Goals: one member-facing Live page, one admin control room, safe embedding, moderated comments, a careful prayer-request flow, reuse of existing community roles, moderation, notifications and the editor-mode shell.

Non-goals: hosting or ingesting video (no RTMP, no recording, no transcoding; the provider hosts); other providers than YouTube; real-time infrastructure (C11); donation or payment processing; paid-access gating of lives beyond membership (entitlements may apply later); public/guest viewing; chat channels; analytics beyond a simple viewer count; changes to existing routes, roles or migrations; any outbound message in tests.

## 3. Placement (recommended; founder deferred)

- **Editor:** a "Live" step in the community editor, as one of its steps in editor mode (see `2026-11-16-shell-editor-mode-design.md`): add/edit a live event, schedule, state, and a preview tab showing the member Live page from draft data (same render path rule).
- **Control room:** inside the community's admin area (alongside the existing moderation page) at `/workspaces/[tenantId]/communities/[communityId]/live` (route shape proposed; follows the existing owner/admin route pattern). Opened during a stream by hosts and moderators.
- **Member page:** `/communities/:slug/live` (public community pages live under `/communities/:slug`, but this page itself requires an active membership; a non-member sees the community's normal join prompt, never the stream or its existence beyond what the community page already shows).
- **Operations mode:** the reserved "Livestream" entry (hidden until built) lists live and scheduled events across the ministry's communities and links into each control room. It is a registry entry like any other (mode `operations`, `status: "planned"` until L5).
- In the community's member navigation, a "Live" tab appears only while at least one event is scheduled within a window or live (recommended: from 24 hours before until 7 days after end, or while a replay is published).

## 4. Data model sketch (proposed; names indicative)

All new tables use the `community_` prefix, carry `tenant_id` and `community_id`, have FORCE RLS, and follow ADR 0013 patterns: staff policy through `withTenant`, member policy through the shared grant-aware predicate, writes through definer functions (as C12a/C12b do), no direct app-role writes where the content is sensitive. Migration number: the next free number at build time (per the journal); never renumber merged migrations.

- `community_live_events`: `id`, `tenant_id`, `community_id`, `title` (1-120), `description` (short, plain text), `provider` (`youtube`), `provider_video_id` (validated, see 5), `source_kind` (`live` | `video`), `scheduled_start`, `scheduled_end?`, `state` (`draft` | `scheduled` | `live` | `ended` | `replay` | `cancelled`), `visibility` (`members` only in V1; column reserved), `comments_mode` (`open` | `held` | `off`), `slow_mode_seconds`, `prayer_enabled`, `donation_slot` (reserved, null), `host_user_id?` (presenter, display only, not a role), `created_by`, timestamps, `version` (optimistic concurrency).
- `community_live_comments`: `id`, `event_id`, `community_id`, `tenant_id`, `author_id`, `body` (max 300), `state` (`visible` | `held` | `hidden` | `deleted`), `pinned_at?`, `held_reason?`, `created_at`. Index on `(event_id, created_at)`; the poll cursor is `(created_at, id)`.
- `community_prayer_requests`: `id`, `event_id?` (nullable: a request can also come from the community without a live), `community_id`, `tenant_id`, `author_id` (kept, never returned to non-staff), `body_ciphertext` (+ key reference per HC-DEC5), `anonymous` (author's per-request choice), `wall_opt_in` (author asks to publish to the prayer wall), `state` (`new` | `in_prayer` | `published` | `closed` | `deleted`), `reviewed_by?`, `expires_at` (retention), timestamps.
- `community_live_reports`: reuse `community_reports` (C12a) with new target types `live_comment` and `prayer_request` if the existing table allows; otherwise a minimal extension. Decided at build time.
- Moderation history and audit: reuse `community_moderation_actions` with new actions (`live_comment_hide`, `live_comment_pin`, `prayer_publish`, and so on) and the existing audit mechanism.
- Notifications: reuse `community_notifications` (C15a) with new kinds (`live_reminder`, `live_started`).
- Viewer presence: no table in V1; a coarse count from recent poll heartbeats held in memory/short-lived row (no per-person history). Recommended default: show "N watching" only to hosts.

## 5. YouTube URL validation and the embed

- Input: a URL pasted by an admin. Parsing is allow-list based: scheme must be `https`; host must be exactly one of `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`, `youtube-nocookie.com`, `www.youtube-nocookie.com`. Accepted shapes: `/watch?v=ID`, `/live/ID`, `/embed/ID`, `/shorts/ID`, `youtu.be/ID`. The id must match `^[A-Za-z0-9_-]{11}$`. Only the id is stored (never the full URL, no query string, no playlist, no timestamp, no tracking params). Anything else is rejected with a clear message. No server-side fetch of the URL (no SSRF surface).
- Render: `https://www.youtube-nocookie.com/embed/{id}` built from the validated id only, with `rel=0`, `playsinline=1`, `modestbranding=1`; never `autoplay=1`.
- **Click-to-load:** the page shows a Harvest-rendered poster (title, scheduled time, a play button) and loads no provider script, iframe or image until the viewer taps play. Poster is a neutral Harvest placeholder, not the provider thumbnail (a thumbnail request would reveal the viewer to the provider). A short notice states that playing loads the video from the provider.
- Iframe attributes: `allow="encrypted-media; picture-in-picture; fullscreen"` (no autoplay, no camera/microphone), `referrerpolicy="strict-origin-when-cross-origin"`, `loading="lazy"`, `title` set. Aspect ratio 16:9 (`aspect-video`), full width, responsive.
- **CSP:** add `frame-src https://www.youtube-nocookie.com` (only the embed host) on the member Live route and the editor preview, nothing broader; no `script-src` additions. Unverified: whether a global CSP exists to extend (section 17).
- Replay: when the stream ends, state becomes `ended`; the admin may switch to `replay` (same video id, since YouTube keeps live recordings at the same id) or set a different video URL. No recording is hosted by Harvest.
- Provider failures: private/deleted/age-restricted/region-blocked videos or an id that changes show the provider's own player error inside the frame; the page also offers a plain "Trouble playing? Open on the provider" link only for staff-visible diagnostics (members get a generic message) and the admin sees a state hint ("Check the link"). Harvest cannot detect provider-side state without an API call; none is made in V1.

## 6. Roles and permissions

Reuse the existing community roles (owner, admin, moderator, contributor, member) and `community_is_host`. No new role. A "host" of a live event is a presenter label (`host_user_id`) for display; it grants nothing.

Proposed permission keys (resolved server-side, mirroring `src/lib/permissions.ts` style):

| Key | Who (recommended) |
| --- | --- |
| `community:live:view` | active member; staff of the ministry per ADR 0013 staff path |
| `community:live:manage` (create/edit/schedule/end, set comments mode, slow mode) | owner, admin |
| `community:live:moderate` (hold/approve/hide/pin/delete comments, mute/ban via existing tools) | owner, admin, moderator |
| `community:live:comment` | active, not muted, not banned member |
| `community:prayer:submit` | active, not muted member |
| `community:prayer:review` (prayer team queue, see author) | owner, admin, moderator, plus an explicit prayer-team grant (recommended default: moderators only in V1) |
| `community:prayer:publish` (publish to wall) | owner, admin, moderator, with the author's `wall_opt_in` |

The sidebar/control-room visibility follows the registry rules (permission and feature). The server enforces on every route and definer; UI hiding is presentation. Rank rules from C12a apply to mute/ban of commenters.

## 7. Live comments

- **Polling design:** `GET /api/communities/:slug/live/:eventId/comments?after=<cursor>` returns visible comments newer than the cursor plus pinned items and the event state; the client polls every 4s while the tab is visible and the stream is `live` (3s to 5s jitter), backs off to 15s when idle for 2 minutes, stops when hidden or ended, and resumes on focus. Responses are small, paginated (max 50), and conditional (`ETag`/cursor so an empty poll is cheap). Server load note: N viewers x 1 request per 4s; a per-community rate limit and a global circuit breaker protect the app; sizing is validated by load testing before activation.
- **Posting:** `POST .../comments`, body 1 to 300 chars, plain text only (never HTML; links rendered inert/non-clickable by default, recommended: no links for non-staff in V1). Rate limits: per member (for example 1 comment per 5 seconds, 30 per 10 minutes, tunable), per event, per IP; slow mode per event (`slow_mode_seconds`). Idempotency key per submission to avoid duplicates on retry.
- **Moderation controls:** comments mode `open` (publish immediately, then hide), `held` (every comment held until approved; recommended default for new events with hold-first-post behaviour for new members as in C12a), `off` (read-only). Banned-word list reused (C12a) so matching comments are held. Hosts can approve/hold/hide/delete/pin; pinned comment shows above the list. Mute/ban reuse C12a (muted members cannot comment; banned members lose access). Members can report a comment (reuses the reports queue). Deleting a comment keeps a tombstone in the moderation history; the body is removed from members' view at once and purged on the retention schedule.
- **Live region and a11y:** see section 12.
- **Later realtime (C11):** the polling endpoint stays as the fallback; the contract (event, comment shape, cursor) is the same so a realtime transport can replace the poll without UI changes.

## 8. Prayer requests (sensitive; recommended decisions flagged)

- **Submit flow:** a member opens "Send a prayer request" on the Live page (also available from the community prayer wall later). Fields: the request (max 1000 chars), a clear per-request choice **"Show my name" / "Post anonymously"** (no default pre-selected; the member must choose, so the choice is never a silent default), and an optional unchecked "Also share with the community on the prayer wall" (the author's `wall_opt_in`).
- **Where it goes (recommended):** submit goes to a **private prayer team queue** (moderators/prayer team only). Nothing appears on the live page or any member-visible list unless a moderator publishes it and the author opted in. Published items on the prayer wall show the author's name only if the author chose "Show my name".
- **DECISION (founder, 16 Nov 2026, option A):** anonymous hides the author's name and identity from other members, the live page and the wall. The prayer team and admins/moderators who handle the queue can still see who wrote the request, for safety and abuse handling (self-harm, threats, minors, harassment). The author sees a clear notice at submit in plain words (for example: "Anonymous to other members. Community leaders who review requests can see who sent it, for safety."). Staff reads of the author are audited. Everything else in this section remains a proposal.

- **Privacy and security:** `body` encrypted at rest with the key management direction of HC-DEC5 (managed key service, rotation, restricted decryption, audit trail; that direction is UNAPPROVED and the design is not independently reviewed; real data must not be collected until it is). The author id is never returned by member-facing APIs. The queue and wall are served through definer functions; staff reads write an audit row (who read which request) without logging content. No prayer text in logs, errors, analytics, notifications or emails (notifications say "A new prayer request" with no content).
- **Retention (decided, founder 16 Nov, subject to legal review before any real collection):** unpublished requests are purged 30 days after they are closed or 90 days after submission at most, whichever first; wall items expire after 180 days. A scheduled purge with failure evidence is required before real collection, as for HC-DEC4.
- **Erasure:** on account deletion or a member's erasure request, the author's requests are deleted (not tombstoned with content); a count-only tombstone may remain. A member can delete their own request at any time before and after publishing.
- **No CRM export without consent:** prayer requests never flow into CRM contacts, notes, Harvest Connect or follow-up cases automatically. A "create follow-up" action by a moderator would need the author's explicit consent captured at that time and is out of scope here. Prayer requests are **not** a consent purpose and do not create or alter any consent record; they stay separate from `account_communications`, `outreach_follow_up` and `newsletter`.
- **Not visible to:** other members (unless published and opted in), ministry viewers/members outside the prayer team, the assistant (AI features do not read prayer requests; consistent with `docs/prd/harvest-communities.md` which excludes prayer requests from moderators by default and from AI), and exports. Note the tension: the PRD says moderators are not automatically allowed to see prayer requests; this spec grants `community:prayer:review` to a named set explicitly, which the founder must confirm (section 15).
- Minors: the existing adult-accounts policy applies and legal review is required before activation (decided, section 15); see section 13.

## 9. Donation slot (reserved)

A nullable `donation_slot` on the event and a layout region (below the player, collapsed) are reserved. Nothing renders, no route exists, no provider is named in UI copy, until the founder's workaround is specified. Payment domain, ledgers and webhooks stay separate per the payment correction in CLAUDE.md; Harvest does not process third-party donations via an unapproved arrangement.

## 10. Notifications (reuse C15)

- In-app first: new kinds `live_reminder` (for example 1 hour before and at start) and `live_started` appear in the existing bell for members who have notifications on for that community; they respect mute/ban and the existing preferences. A member can turn "live reminders" off in the existing notification settings sheet.
- Email via the existing worker (C15b) is off in production (`COMMUNITY_EMAIL_LIVE_DELIVERY = false`); live reminders by email would be a digest-class or opt-in setting, decided later; not in L5 by default.
- Reminders are created by a scheduled job at state transitions (idempotent per event and kind). No real outbound message in tests; a local test mailbox only.
- Host alerts: "N comments held", "prayer request waiting" counts appear on the control-room badge (counts only, no content).

## 11. UI

Studio Admin style via shared shadcn components; design (layout, information architecture) from the Eden reference screens, not their visuals or copy. References read: `05-communities/comm-046` (admin panel with Overview, Reports, Held, Members, Channels tabs beside the content) and `comm-044/045`; `comm-006` (events page) and the stream/live layout were not opened (section 17).

**Member Live page** (`/communities/:slug/live`): header (event title, state badge Scheduled/Live/Ended/Replay, time in the viewer's timezone); the player area (click-to-load poster, then the embed); below or beside it the comments panel (list, composer, slow-mode hint, pinned comment on top); a "Send a prayer request" button opening a sheet; the donation region reserved (absent). Wide screens: player left, comments right; phone: player on top, comments below, prayer button in the sticky bottom bar.

**Control room** (admin): tabs as in the existing moderation page (Studio Admin tabs and tables): Stream (state controls: go live/end, comments mode, slow mode, event details), Comments (live list with approve/hold/pin/delete, search, mute/ban row menu; held tab), Prayer (queue table and review sheet: view, mark in prayer, publish to wall if opted in, close, delete; author identity shown to staff with a visible label), Viewers (coarse count, recent commenters with mute/ban; no per-person watch history). Badge counts on tabs. Phone: tabs become a scrollable bar; actions in bottom sheets; 44px targets.

**Editor "Live" step:** form for URL (validated live, shows the parsed id's embed poster, not provider data), title, schedule, comments mode, prayer on/off; Publish checklist items: valid URL, title, start time. Preview tab renders the member Live page from draft data.

**States:** empty (no live events: a short empty state; for admins an "Add a live" action); scheduled (countdown, reminder toggle); live; ended (message and replay if available); replay; cancelled; loading (skeletons for the player area and list); error (poll failed: inline "Reconnecting" banner with automatic retry, comments stay visible; posting failed: message kept with retry; access denied/non-member: the community join prompt); provider failure (generic message for members); stream URL invalid (editor error).

**Phone-first:** layouts are designed at 360 and 390 first, then 768, 1280, 1440. No horizontal scroll; full-width layouts; 44px tap targets; the composer is pinned above the safe area.

## 12. Accessibility

- Comments list is a log region: `role="log"`, `aria-live="off"` by default so screen readers are not flooded; a "Read new comments aloud" toggle sets `aria-live="polite"`; a separate polite announcement for host-pinned comments and state changes ("The live has started", "The live has ended"). New comments never steal focus; auto-scroll pauses when the user scrolls up or focuses the list, with a "N new comments" button.
- Player: the poster/play button is a real button with an accessible name; focus moves into the iframe on play (user-initiated), and the iframe has a `title`. No autoplay, no auto-advancing media. Captions: Harvest cannot guarantee captions; the provider's auto-captions may be available inside its player; the spec records this as a note and the admin form says nothing about it unless captions are confirmed. (Provider-supplied captions are not verified.)
- Prayer sheet: labelled fields, the anonymity choice is a radio group with text (not colour), the notice is associated with the control (`aria-describedby`), errors announced.
- Axe and keyboard-only test of the whole page; reduced-motion respected; time shown with timezone.

## 13. Privacy threat model (proposed)

| Risk | Mitigation |
| --- | --- |
| Viewer privacy toward the provider | click-to-load; `youtube-nocookie`; no provider thumbnail; no autoplay; notice before load; CSP limited to the embed host |
| Unauthorised access (link sharing) | members-only route; membership check server-side; the video itself is on a public provider URL, so **Harvest cannot prevent anyone with the raw video link from watching on the provider**: recommend admins use an "unlisted" YouTube live and tell them this limit in the editor step (members-only here controls the comments, prayer and page, not the provider video) |
| Children and minors | adult accounts are the launch policy (communities PRD); the live page never shows a minor's identity; prayer requests and comments from a member flagged as under-age are refused by the same eligibility rule; no data collected from minors; legal/age review is a founder item (open question) |
| Defamation and doxxing in comments | hold mode, banned words, no links for non-staff, per-event slow mode, report and delete, history; pinned content by staff only; an auto-hold on patterns such as phone numbers or emails (proposed) |
| Harassment | mute/ban/rank rules reused; appeals via C12b (existing) |
| Prayer content sensitivity (health, family, religious belief is special-category data in many jurisdictions) | encryption at rest, access by named roles only, audit of staff reads, retention limit, erasure, no CRM/AI/export use, never in logs or notifications, anonymity choice per request, an explicit notice about staff visibility |
| Author de-anonymisation | member APIs never return the author id for anonymous requests; no small-group leak (the wall shows no counts by person); timing correlation between a comment and a request is not exposed |
| Abuse of the prayer form (spam, threats, self-harm content) | rate limit, length cap, queue review, a documented safety procedure for staff (runbook to be written; not defined here) |
| Provider/Stream failures | provider error shown in its own player; state can be set manually by the host; no automatic detection |
| Cross-community/tenant leakage | tenant and community scoping on every table, adversarial two-ministry two-community tests (ADR 0013 requirement) |

## 14. Audit, abuse and failure modes

- Audit: create/edit/schedule/cancel event, state changes, comments mode and slow mode changes, every moderation action, publish of a prayer request, and every staff read of a prayer request (actor, target id, time; no content). Denied attempts are not logged by the platform today (a known gap in HC-02 prerequisites; not solved here).
- Failure modes: provider URL changes or the live ends early (host sets state manually; members see the ended state); poll outage (banner, retry with backoff, no data loss); a host forgets to end (an automatic close after a maximum duration, recommended 12 hours, is a proposed safeguard); time zones (stored in UTC, shown in the viewer's timezone); two admins edit at once (version field, conflict message); a member banned mid-stream (the next poll returns 404 and the page shows the removal state); an event deleted while live (soft state `cancelled`); the embed blocked by the viewer's network (message and link for staff only).

## 15. Decisions and open questions

### Decisions (founder, 16 Nov 2026)

These record the founder's choices. They approve no build, migration, deployment or production activation, and they do not approve any HC-02 gate (all five remain UNAPPROVED).

1. **Anonymous prayer requests: option A.** Anonymous hides the author's name from other members; the prayer team and admins/moderators can still see who wrote it (safety and abuse); the author sees a clear notice at submit.
2. **Prayer team in V1 is owner, admin and moderator.** This overrides the communities PRD line that moderators are not automatically allowed to see prayer requests. `docs/prd/harvest-communities.md` must be updated to match (listed under "Docs to update" below). A separate prayer-team grant remains a later option.
3. **Prayer retention:** 30 days after a request is closed, at most 90 days after submission, and 180 days for prayer-wall items. Still subject to legal review before any real collection; the retention job and its failure evidence are required before real data (as for HC-DEC4).
4. **Replay is set explicitly by the admin** (state `replay`). The editor shows a notice that the raw provider video stays outside Harvest's control, so admins should use an unlisted live.
5. **Minors, age and jurisdiction:** apply the existing adult-accounts policy (communities PRD launch policy) to prayer requests and comments, and require legal review before activation.

### Docs to update (when the decisions are implemented)

- `docs/prd/harvest-communities.md`: prayer-request visibility line (moderators, admins and owners are the V1 prayer team; the line near the moderation and sensitive-data section that excludes moderators must be changed), plus a pointer to this spec.
- `docs/decisions/hc-02-activation-gates.md`: add a note that prayer data is a new category in scope of HC-DEC3/4/5 reviews (no gate is approved by this).
- Communities acceptance records for L1 to L5 as each slice ships.

### Recommended defaults, not yet confirmed

3. Does submit go to the private queue first, with optional publishing to a prayer wall? Recommended: yes; the queue only in V1 if the wall is not wanted yet (L4 can ship the queue alone).
5. Comments default mode for new events: `held` for members who have not been approved before (existing hold-first behaviour), `open` after.
6. Links in live comments: not allowed for non-staff in V1.
7. Viewer count: shown to hosts only.
9. "Members only" and paid-tier gating: reuse entitlements later when a community has tiers; not in V1.
10. Reminders: in-app only at first (1 hour before and at start); email later through the digest/opt-in model.
11. Max stream duration auto-close: 12 hours.
13. Operations "Livestream" entry lists live events across communities and stays hidden until L5.
14. The Live tab appears only from 24 hours before an event until 7 days after (or while a replay is published).

(Numbers follow the earlier question list; 1, 2, 4, 8 and 12 are now the decisions above.)

## 16. Tests, acceptance and slices

Each slice: its own PR, independent review, acceptance record; reuse of shared systems named; unit tests, DB integration tests (two ministries x two communities adversarial), restricted-owner suite for definers, e2e at 360, 390, 768, 1280, 1440 in light and dark with axe, screenshots viewed; no real outbound messages; Communities flag off returns 404.

- **L1: data model + embed + member Live page.** Migration (next free number at build time) for `community_live_events` with RLS; pure URL parser (unit tests: allowed hosts, ids, shapes, rejects look-alike hosts, extra params, `javascript:` and data URLs); member page with click-to-load player. Acceptance: nothing is requested from the provider before the tap (network assertion); non-members and banned members get 404/join prompt; ministry B cannot read ministry A events; CSP allows only the embed host; no autoplay; states render (scheduled/live/ended/replay/cancelled). Dependency: communities flag; shell registry entry hidden.
- **L2: editor Live step.** Add/edit/schedule/state, validated URL, preview tab (same render path as the member page), Publish checklist item. Depends on editor-mode slice 3a (the step sidebar) or ships temporarily as a tab in the current editor. Acceptance: invalid URLs rejected with messages; version conflict handled; viewers see read-only; phone first.
- **L3: comments + moderation.** `community_live_comments`, polling endpoint, composer, rate limits, slow mode, held mode, banned words, hide/delete/pin, mute/ban reuse, report reuse, control-room Stream and Comments tabs. Acceptance: held comments invisible to members until approved; muted/banned cannot post; rate limit and length enforced; cursor polling returns no duplicates or gaps; poll stops when hidden/ended; no HTML rendering; `role="log"` behaviour and axe; adversarial RLS tests; audit rows written.
- **L4: prayer requests.** Table with encrypted body, submit sheet with explicit anonymity choice and notice, private queue, review sheet, audit of staff reads, retention job (local synthetic data only; hard-disabled for real data until the HC-DEC5/retention gates are approved), erasure. Acceptance: anonymous author never returned to members (API and RLS tests); staff reads audited; no prayer text in logs/notifications; erasure deletes; no CRM/AI/export path (source guard test); production collection hard-disabled.
- **L5: control room polish, notifications, Operations entry.** Reminders and started notifications (in-app), badge counts, viewers tab, Operations "Livestream" entry unhidden, auto-close. Acceptance: reminders idempotent; respect mute/ban/preferences; no email in production; registry test that the entry yields a link only when built.
- **Later:** realtime transport (C11), donations (after the founder's workaround), email reminders, prayer wall refinements, entitlement gating, captions/accessibility review with real users.

Dependencies: existing C12 moderation and C15 notifications (merged), editor-mode slice 3a/3b for the Live step's final form, three-mode slices for the Operations entry, HC-DEC5/retention approvals before real prayer data.

## 17. Assumptions I could not verify

- The journal ends at `0052_hc14_withdrawal_propagation` on origin/main (read directly); the founder's "0053" is consistent, but open PRs may take it; use the next free number at build time.
- Whether a global CSP exists and how it is configured; I found none in `next.config.ts` or `src/proxy.ts`.
- Whether `community_reports` can take new target types without a migration change; the definers' exact shapes were not re-read.
- The exact community role set in code (`community_is_host` membership) was taken from ADR 0013 and the C12 acceptance records, not from the SQL.
- That YouTube live recordings keep the same video id after the stream ends (commonly true; not tested), and that the nocookie embed behaves as described.
- Captions availability inside the provider player.
- Server capacity for the polling load; no load test was done.
- I did not open the Eden event/live screens (`comm-006`) or the community admin overview; only `comm-046` was viewed for this spec. The "Live" layout is therefore my design, not a copy of any reference.
- The legal position on religious/prayer data, minors and anonymity varies by jurisdiction and is not assessed here; all five HC-02 gates remain UNAPPROVED, and HC-DEC5's key design has had no independent review.
- `docs/prd/harvest-communities.md` was read by search (events, moderation, prayer lines); I did not read it in full.
