# Communities C09b member profiles + C14 events — design

Status: **DRAFT for founder and independent review**, 17 Nov 2026. Documentation only. No feature, schema, migration, UI source, provider connection or activation is delivered. The founder's order is C11, C09b, then C14. All courses/products/events in this proposal are free; paid commerce remains parked. All five HC-02 decisions remain UNAPPROVED.

References:
- house style: `2026-11-11-communities-pr4b-forum-design.md`;
- PRD `docs/prd/harvest-communities.md` §2A, §6.3, §6.5, §13, §17 and §19;
- ADR 0013 §4/4a (RLS), §5 (capabilities) and **§9 (canonical Events dependency)**;
- `2026-11-17-communities-c11-chat-design.md` §6, §12, §14 and §16;
- `docs/plans/communities-kit-item-list.md`, `docs/component-registry.md`, `docs/plans/studio-admin-adoption.md`;
- current account profile `src/server/account-profile.ts`, directory/forum services and C15 preferences;
- external calendar port `src/server/calendar/port.ts`, its registry and provider-layer adapter;
- C11a draft [#121](https://github.com/bumbmatei-sys/harvest-v2/pull/121); C11b source-audit draft [#122](https://github.com/bumbmatei-sys/harvest-v2/pull/122).

Design follows Skool's community profile and Eden's community flows. The founder-supplied premium profile and chat sheet are the implementation sources, adapted with Harvest shared components. This design contains no copied source or fixture data.

## Scope

**In, in order:** a community-specific member profile and privacy settings; canonical Events foundation; community event calendar/detail, free RSVP/capacity and ICS download. C14 starts only after its canonical dependency exists.

**Out:** public member profiles, contact exports, avatar uploads before the scanner gate, chat histories on profiles, inferred interests/faith scores, private pastoral notes, paid events, waitlists in the first RSVP slice, recurrence, automatic external-calendar invitations, meeting-room creation, attendance surveillance and Live L2–L5. A later increment can add waitlists/recurrence/public event listings after their own design and review. Live L1 remains a separate surface.

## Current evidence and dependency answer

The inspected main (`901b4a1`) has `users`, owner-only `user_profiles` (city/region and onboarding), community memberships/grants, the member directory, forum and C15. It has **no canonical `events` table/service**. `community_live_events` is Live's separate event model. The calendar port lists/creates/updates provider events and RSVP, but does not own Harvest event content or community admission. Treating that port as the canonical Events module would leave the ADR §9 dependency unmet.

**Proposal:** immediately after C09b, deliver **E01 — canonical free Events foundation** as a separate server/migration PR. Then C14 attaches canonical events to communities and supplies the member calendar/RSVP UI. This satisfies §9 without copying event titles/times/RSVP into a community-owned event catalog. E01 belongs to the canonical Events domain; it is a dependency slice within this sequence, not a claim that a new launch system is approved. Founder review confirms this sequencing before implementation. Until E01 exists, do not ship a placeholder C14 calendar or substitute Live events.

No migration number is reserved here. Check main's journal and open PRs at build time, including C11a's proposed 0057; the C11 DM number remains a candidate, not a reservation.

## C09b member layout

Routes: `/communities/:slug/members/:userId`, with My settings on the viewer's own page. The directory links to profiles only when disclosure permits. Profile links on forum authors use the same predicate. Non-readers and inaccessible targets get the same neutral 404; restricted names/bios never enter public metadata, previews or Open Graph data.

- Header: initials avatar, community display name, current role/badge and joined **day**. These come from this community; no role or grant from another community appears.
- About: optional plain-text bio, volunteered language and up to three labelled HTTPS links. No email, phone, city/region, CRM contact, consent, campaign-response or pastoral fields.
- Activity: paginated posts/replies authored in this community that the **viewer can already read**. Reuse forum predicates; exclude deleted/removed content and held content not visible to the viewer. Never list chat/DM messages, private profile edits or engagement scores.
- Message action: on a readable peer profile, the action opens a neutral compose sheet when chat is enabled. The action and profile payload do not vary with the target's block, opt-out, mute, membership details or conversation history. On submit, reuse C11c `dmStart` with the first message and `client_id`. Its transaction rechecks eligibility, including existing pair and current-host engagement, before any conversation ID or notification is produced. Failed attempts use the same unavailable copy. Never call `dmPeople` as a profile probe or expose a preflight token, status or button visibility for individual DM eligibility. Existing conversations remain accessible through the participant's own authorized DM list.
- Report/block: existing C12 `ReportDialog` and C11c block service. Report reasons remain shared. Hosts' moderation/member-management actions remain separate from voluntary profile visibility.
- My settings: profile fields, directory/profile visibility, C15 notification/email preferences and C11c member-DM acceptance. Reuse the owning services; no second preference table or inferred consent.

## C09b reconciliation against merged chat

| Earlier assumption | Build alignment |
| --- | --- |
| Profile or directory can derive Message eligibility from membership or add a lookup | C11c (0058) owns recipient eligibility and the common `not_available` result. Distinguish only the normal authorized send outcome at submit. The profile and its cache key reveal no block, opt-out or existing-pair signal. |
| Membership revision can stand in for private DM activity | C11a (0057) owns channel settings and the community-wide channel revision. C11c owns participant-only revisions, rail state and the associated DM notifications. C09b does not join those projections into profile activity or counters. |
| Profile settings might store their own DM and notification switches | The current member's own settings reuse C11c `dmAccept` (`dm_accept_members` on the membership) and the C15 preferences services. `dm_policy` stays a community setting. Profile visibility remains an independent C09b concern. |
| The combined design predates the delegated defaults | Decision log §4b covers Events, Office Mail and Assistant. It sets no new member-profile defaults. For future C14 work, it supersedes this historical design's deferred waitlist and unspecified timing: RSVP closes at start or earlier, waitlist promotion is ordered and automatic, and reminders default to 24h/1h in-app with email opt-in. Delivery remains a separate job. These defaults do not certify the E01 draft or change C09b's dependencies. |

C11a and C11c are merged. Test profile privacy independently from chat permissions: a viewer or ordinary member using `withTenant` cannot bypass a private profile. Verify the same Message affordance, URL/cache behavior and neutral failure for blocked and opted-out targets, policy-off, demoted hosts, and access loss between loading and submission. A successful send is the only path that exposes an authorized conversation to the participant.

## Profile data and privacy

Propose `community_member_profiles`, keyed by `(tenant_id, community_id, user_id)` with a composite membership FK and account FK. Fields: optional `display_name` (1–100), `bio` (≤500 plain-text characters), optional volunteered language, at most three `{label,url}` links (label ≤40; URL ≤2048, HTTPS only), `visibility`, optimistic `version` and timestamps. Membership remains the owner of role/status/joined date; `users` remains the canonical account identity.

Actual visibility values, with **members** as the default:
- **members**: eligible active members see the directory row and profile;
- **unlisted**: omitted from directory/search/counts; an eligible member with a direct link can open the profile;
- **private**: self and authorized community safety hosts only. Other members get 404, including by direct link.

Public profile exposure is deferred; do not show two controls that both mean members-only. These labels and the extra private option are proposed defaults for founder review. Existing members migrate to members-only, matching the current member-only directory.

One disclosure predicate governs directory rows/counts/search, direct profile, author links and profile activity. Inactive/pending/banned/left/removed subjects disappear from the member directory and peer profile view. Rejoining retains the person's privacy choice and voluntary fields; it never restores a former staff role. Historical forum content still follows forum rules. Consequential settings copy explains: “Hiding your profile keeps your posts visible to people who can already read them.”

**RLS exception to review:** voluntary profile fields must not receive an unconditional ministry-wide staff read policy. A ministry viewer must not bypass a private profile merely through `withTenant`. Propose self/eligible-peer/explicit host policies, with owner/admin safety access resolved server-side; the build amends ADR §4a for this bounded personal-data table. Operational member-management still shows the membership metadata its existing capability permits. Moderator access to private voluntary fields is an open decision below, not silently approved.

Every new table FORCE RLS; all mutations use scoped, fixed-search-path definers revoked from PUBLIC. Self edits validate membership/account ownership and version; callers cannot set badges, roles or joined date. Audit field names/version only, not bios or link text. Existing `AccountProfileForm` edits account-wide name/language/city and **must not be embedded wholesale**: its private city/region field cannot enter the community form. Link to account settings for account-wide changes.

Self can clear voluntary fields and set private visibility. This is labelled “Clear community profile”, not account erasure; existing forum authorship is unaffected. On leaving, peer access ends but self can manage their own stored profile through a limited personal-account endpoint without regaining community content. Actual account deletion cascades this new row; no broader erasure guarantee is invented.

Initials are the first implementation. Uploads require the production scanner/media release gate and a later explicit slice. Links render as text/anchors, never HTML; `rel="nofollow noopener noreferrer ugc"` and new-tab protection apply.

## E01 canonical Events data and service

Proposed domain owns:
- `events`: ministry-bound identity, title, validated description, IANA timezone, UTC start/end, optional positive capacity, draft/published/cancelled state, version and creator/timestamps;
- a separately protected join-link field/table, excluded from normal list/detail/public/ICS projections;
- `event_rsvps`: unique `(tenant_id,event_id,user_id)`, going/maybe/not-going state, version/timestamps and enough provenance to invalidate an admission grant without reactivating old attendance on rejoin;
- an idempotent event/outbox/audit contract for publish, update, cancellation and RSVP changes.

C14 owns only `community_event_links` (tenant/community/event identity and community-specific placement). Composite keys prohibit linking a foreign ministry's event. Titles, descriptions, times, capacity and RSVP stay canonical. Removing a community link does not delete the canonical event. An event linked to several communities appears once in the person's calendar/RSVP, with access through any still-valid authorized link.

All new tenant tables FORCE RLS. Define the canonical event read predicate before UI work: owning-ministry management through capabilities, or active/grant-aware membership in an attached community. An association never grants ministry membership. The first community slice is members-only; public resolver/listing behavior is a later reviewed increment. Private join links have no broad tenant-viewer or public projection path.

E01 exposes versioned save/publish/cancel/get/list and RSVP operations. C14 calls those services; it does not write duplicate event content. Full updates reject stale versions. Event cancellation is explicit, preserved in audit and visible to existing registrants; it does not silently delete their history.

## C14 calendar and RSVP

Routes: `/communities/:slug/events` and `/communities/:slug/events/:eventId`, within the existing `CommunityShell`; activate the existing Events item only when the real service/UI exists.

- Month, week and agenda consume the same bounded range query and canonical event records. Phone defaults to agenda, with a labelled view switch. Display the selected timezone and provide an explicit viewer-local toggle; do not silently shift event dates when editing.
- Event detail: title, description, date/time/timezone, availability and the caller's own RSVP. Members see availability, not other people's private attendance. Owner/admin operations can see a permission-checked roster; member attendee lists/opt-in social attendance are later work.
- RSVP: Going / Maybe / Not going; going reserves one place, maybe does not. Full capacity returns a stable `full` outcome without changing the existing RSVP. Retrying the same state never reserves twice or generates duplicate notices. No waitlist placeholder in the first slice.
- Capacity and grant/ban/leave races are database decisions, not client counts. The implementation must document one lock order shared by RSVP and membership/entitlement hooks, serialize capacity changes on the event, and prove no oversubscription/deadlocks. Leave/ban/access revocation invalidates reservations; rejoin does not automatically restore an old Going state. Time-limited grant expiry also releases eligibility before admitting another reservation. The exact hook/epoch mechanism is finalized in E01's reviewed implementation plan, not copied from chat state (chat read/mute revisions must not invalidate RSVPs).
- Join action: only current eligible members, rechecked on every request, and only within a proposed configurable window (default 30 minutes before start until the event ends). HTTPS only. No embed/prefetch/OG/ICS exposure. A host preview is an explicit authorized operation. No room/provider call in this slice.
- ICS: authenticated download, stable canonical UID, timezone-safe UTC stamps, escaped/folded content, version/SEQUENCE updates and cancellation semantics. Omit private join URLs and any attendee identities. Warn that an exported calendar copy is outside Harvest's access revocation; never promise it disappears on leaving.
- Reminders: C15 notifications with canonical event identity, title/time only, current membership/event checks and deduplication. Email remains behind its existing delivery gate. Production schedule/monitoring and reminder consent/classification are activation prerequisites.

External calendar synchronization is a later opt-in action through **the existing Zernio provider layer and `CalendarProvider`**, including its supported idempotency semantics. The port's provider event is a projection/reference, not the canonical Harvest event. Never call Google/Microsoft or another platform SDK directly, auto-send invites, or treat provider RSVP as a community access grant. Office's connected calendar remains its own surface.

Live integration is an optional association from a canonical event to Live L1, with separate read predicates/lifecycle. A calendar RSVP must not activate Live L2–L5, auto-start a stream or expose a replay.

## UI sources and shared systems

| Area | Named kit source / preview | Studio Admin fallback / shared Harvest composition |
| --- | --- | --- |
| Profile header, About/Activity tabs | Copy and adapt Admin-dashboard `app/dashboard/(auth)/pages/profile/page.tsx` and `components/profile-card.tsx`, `about-me.tsx`, `latest-activity.tsx` beneath that directory. Replace fixture contact details, links and activity with the authorized profile projection and paginated forum activity. | `CommunityShell`, `RecordLayout`, `Tabs`, `Avatar`, `Badge`, `MemberList` |
| Compact member sheet | Copy and adapt chat-app `app/(auth)/chats/components/user-detail-sheet.tsx`. Replace fixture contact fields, social links, shared-media placeholders and `useChatStore` with the same allowed profile summary and neutral actions. | Shared `Sheet`, `Avatar`, `Button` and C11c message flow |
| My settings | [`form-layout1`](https://shadcnuikit.com/blocks/dashboard-ui/form-layouts#form-layout-1) | pinned MIT settings pattern; existing `Field`, inputs, C15 preference components, `StickySaveBar` |
| Event calendar | [`event-calendar1`](https://shadcnuikit.com/blocks/application-ui/event-calendar#event-calendar-1) | `event-calendar2` alternative; pinned MIT calendar where appropriate; shared `Tabs`, `Sheet`, `Calendar` |
| Event detail / RSVP | chosen calendar's detail pattern; no invented standalone registry item | `Sheet`, `Badge`, `StatusBadge`, `ConfirmDialog`, existing form fields |
| Safety / empty / notifications | existing Harvest components | `ReportDialog`, `NotificationBell`, `EmptyState`, `MemberList` |

Inspected founder-supplied Admin-dashboard at `1631106a7906c1a473ae3a49fb1d392605d39108` and chat-app at `66fd523b60a73b6d3e26cc6fc2cb86294458640b`. The implementation gives the “Derived from …” header to each copied file with the exact repository and path, and records provenance in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`. Harvest rewrites use “modelled on … code written for Harvest”. The profile templates have no registry install name; do not invent one. Verify code availability and preview anchors before adoption. The exact item list/provenance is recorded in each implementation PR. The licence is settled (founder, 17 Nov): premium kit blocks may be used wherever they fit, with provenance recorded; approved free/MIT preparation is also allowed. If neither source covers an area, return to the founder. No visual screen, registry source or paid asset is introduced by this spec.

Reuse full-width layouts and semantic tokens, concise catalogue copy, 44px targets, keyboard tab/agenda navigation, accessible form errors and reduced motion. Do not duplicate AppShell/navigation, create a separate community calendar engine, or expose implementation/provider names in UI copy.

## Testing

**Profile unit/integration:** visibility matrix for self/host/peer/non-member and all membership states; grant expiry; two ministries/two communities; ministry viewer with `withTenant`; direct RLS and restricted NOCREATEROLE owner; version conflict; safe links/text; directory row/count/search parity; no private account/CRM/chat/DM fields in projections; rejoin privacy; activity uses viewer permissions; DM eligibility including policy-off, opt-out, current-host demotion and block without revealing the reason.

**Events unit/integration:** timezone/DST boundaries, end after start, ICS escaping/folding/UID/SEQUENCE/cancellation, canonical link ownership and no duplicated content; two-tenant RLS/restricted owner; role/capacity matrix; two simultaneous Going requests for one seat; repeated requests; cancellation/stale versions; leave/ban/grant-expiry/rejoin versus RSVP; multiple-community grants; private join-link window and absence from logs/list/metadata/ICS; reminder deduplication, mute/current-access and no live delivery; provider fake only.

**Browser:** directory → profile → own edit/settings; private/unlisted profiles across sessions; real C11c Message eligibility; owner event create/publish/cancel; members RSVP at capacity; month/week/agenda and timezone; no join URL before its window or after access loss; ICS download. Axe, keyboard and overflow, light/dark at 360/768/1280 (plus repository standard sizes), 44px targets, screenshots in each slice's acceptance directory. Evidence remains author-executed unless a fresh non-author session runs it.

## Delivery slices and exit criteria

| PR | Delivers | Exit |
| --- | --- | --- |
| C09b-1 server | profile model/predicate, private directory filtering, self settings and authorized activity | isolation/privacy/role matrix, restricted owner, no account-private fields |
| C09b-2 UI | adopted profile/settings composition, directory/author links, real C11c actions | multi-session privacy + responsive/axe screenshots |
| E01 canonical Events | canonical schema/service, admission/capacity/revocation contract, protected join link, ICS | independent reviewed lock/hook plan, RLS/race/ICS tests; no provider sending |
| C14-1 links + member UI | canonical community association, adopted calendar/detail/RSVP, C15 in-app reminders | capacity/access races, multi-session/calendar tests, screenshots |
| later increments | waitlists, recurrence, public listings, opt-in external sync | separate designs/activation evidence; paid events remain parked |

One branch and draft PR per implementation slice; no migration reservations, force push, merge, deploy or activation. Run required local checks and record what was not verified. Migrations need trusted-main Neon checks; each PR needs a separate fresh review session.

## Decisions for the founder / reviewers

1. Confirm E01 as the explicit canonical Events prerequisite immediately before C14; otherwise C14 remains waiting on ADR §9. This spec does not waive that dependency.
2. Confirm members/unlisted/private profile choices and default members-only. Recommend private voluntary text for owner/admin safety reviewers only; moderator access is a separate explicit decision, with no ministry-viewer bypass.
3. Confirm initials-only until scanning and the first free, members-only RSVP/ICS slice before waitlists/recurrence/public listings. The 30-minute join window is a proposed default.
4. The premium kit licence is settled (founder, 17 Nov). Privacy/legal review covers voluntary profile data, attendee/reminder policies, exported-calendar copies and retention before real collection. None of the HC-02 decisions, real sending, support-access policies or production gates is approved by this document.
