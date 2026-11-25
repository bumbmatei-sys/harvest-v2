# Harvest Live — Product Requirements Document

**Status:** Draft for review — founder-approved provider direction  
**Date:** 20 November 2026  
**Release:** Post-launch / future vision unless separately approved; does not expand Professional V1 scope  
**Decision:** Google Meet and Zoom Meetings, connected with each organization's own accounts. **No LiveKit, no Zoom Video SDK, no Harvest-hosted video infrastructure.**

## 1. Product definition

Harvest Live is a unified meeting management experience inside Harvest. Churches, ministries, nonprofits, evangelists and missionaries can connect Google Meet and/or Zoom Meetings, schedule sessions, invite participants, manage meeting links and associate meetings with Communities, Groups, Courses, Events and Campaigns.

Harvest controls the scheduling and organizational interface. **The actual call opens in Google Meet or Zoom, with that provider's video interface and branding.** Harvest does not replace the provider's meeting grid, media controls, conferencing servers or subscription entitlements.

### Goals
- Connect Google Meet and Zoom accounts through secure OAuth.
- Create, update, cancel and list provider-backed meetings where APIs allow.
- Choose default provider at workspace or organizer level and override per meeting.
- Show meetings, invitations, provider, host, joining links and schedule in Harvest's existing UI.
- Link meetings to Harvest entities, enforce workspace access, and send reminders.
- Optionally sync provider-supported attendance, recordings and transcripts.
- Optionally generate AI summaries from authorized transcripts, with consent and cost controls.
- Support webinar or livestream workflows **only where the connected provider's account and APIs support them**; show provider-specific capability differences.

### Non-goals
- No custom WebRTC/video SDK or embedded white-label conferencing interface.
- No LiveKit client/server SDK, SFU, media recording pipeline or media billing.
- No promise of uniform Zoom/Google features, recording access, transcription or live-stream controls.
- No assumption that provider recordings or transcripts are accessible on all account tiers.
- No Harvest-owned participant-minute video charges.

## 2. Architecture

| Layer | Implementation |
|---|---|
| Frontend | Existing Harvest Studio Admin / shadcn interface; meeting list, calendar, creation form, connection settings, join button, recordings/summaries when available |
| Backend | Next.js server services for OAuth, provider adapters, meeting lifecycle, invitations, permissions, webhooks and synchronization |
| Database | Neon PostgreSQL with tenant isolation and provider metadata |
| Google provider | Google OAuth, Google Meet REST API and/or Google Calendar conference integration as appropriate to granted scopes and capabilities |
| Zoom provider | Zoom OAuth, Zoom Meetings API, provider webhooks and eligible recording/report APIs |
| Media transport | **Google Meet or Zoom**; not hosted, proxied or customized by Harvest |
| Background work | Existing durable worker/queue for reminders, token refresh, provider synchronization, webhook processing and optional artifact/AI processing |
| Optional files | Private Cloudflare R2 for permitted downloaded transcripts/artifacts, if enabled; avoid unnecessary copies |
| Optional AI | Existing provider-agnostic AI integration for transcript-based summaries, only with consent and access rights |

**User flow:** Harvest UI → Harvest API → selected provider API for meeting creation → meeting URL saved in Neon → participants open Google Meet or Zoom. No embedded provider video stream is required.

## 3. Account connections and ownership

- Each authorized organizer connects their own Google or Zoom account using OAuth.
- Support a workspace-managed account only if the provider's terms and organizational permissions permit it.
- Store encrypted OAuth tokens server-side, never provider passwords or secrets in browser storage.
- Request minimum scopes; handle refresh, expiry, revocation, reconnection and disconnection.
- Clearly show connected account identity, account owner, provider and available capabilities.
- Workspace admins can configure whether members may connect personal accounts and choose a default provider.
- Never let one workspace use another workspace's tokens or external meeting identifiers.
- A connected account does not automatically confer rights to recordings or attendee reports.

## 4. Meeting workflows

1. Organizer connects a Google or Zoom account in Settings → Integrations → Video Meetings.
2. Organizer selects a provider, meeting title, date, timezone, duration, participants and optional recurring schedule.
3. Harvest validates permissions and provider capability, creates the meeting through provider API, and stores the external meeting ID and join link.
4. Invitations and reminders are delivered using Harvest's existing communications infrastructure.
5. Participants click Join in Harvest and enter the provider's meeting experience. Some providers may require their own login, passcode or waiting-room approval.
6. Harvest syncs changes and status when supported by webhooks or authorized polling; reconcile external edits and cancellations.
7. If supported and enabled, authorized organizers import attendance, recording references or transcripts for post-meeting workflows.

### Integrations
- **Communities / Groups:** recurring discipleship calls, prayer groups, membership-based invitation visibility.
- **Courses:** class sessions, teacher/learner links and optional recording references.
- **Events / Campaigns:** session schedules, attendee registration and reminders.
- **CRM:** contact association and attendance only when permission and data-sharing purpose permit.
- **Calendar:** Google Calendar integration where authorized; avoid duplicate invitations.

## 5. Provider capability policy

| Capability | Google Meet | Zoom Meetings |
|---|---|---|
| OAuth account connection | Yes, subject to Google consent/scopes | Yes, subject to Zoom app/scopes |
| Create meeting links | Meet API / Calendar integration | Meetings API |
| Join call | Opens Google Meet interface | Opens Zoom interface |
| Custom Harvest video grid | No | No (standard Meetings integration) |
| Provider account features/limits | Google account / Workspace plan | Zoom account / plan |
| Recording / transcript import | Conditional on API access, plan, organizer permissions and availability | Conditional on API access, plan, organizer permissions and availability |
| Attendance / participant reports | Conditional on supported endpoints and access | Conditional on supported endpoints and access |
| Webinars / livestreaming | Only provider-supported workflows | Only provider-supported workflows and eligible account/add-ons |

**No false parity:** UI should display feature availability by provider and account, and disable unsupported operations with an explanation. Zoom Webinars is not included merely because Zoom Meetings is connected. Neither provider offers Harvest a fully customizable video interface through these standard integrations.

## 6. Permissions and security

Permissions: `live.connectProvider`, `live.manageConnections`, `live.create`, `live.edit`, `live.cancel`, `live.view`, `live.invite`, `live.viewAttendance`, `live.viewArtifacts`, `live.generateSummary`, `live.manageSettings`.

- Check workspace tenant isolation, organizer ownership and entity membership for each operation.
- Validate OAuth state and PKCE where applicable; encrypt tokens and restrict scopes.
- Verify provider webhook signatures, deduplicate event IDs, handle retries/out-of-order updates.
- Avoid exposing provider start URLs, host tokens or OAuth credentials to unauthorized users.
- Record audit events for account connection, meeting creation, deletion, artifact access and AI processing.
- Apply provider-specific rate limits, API errors and subscription feature checks.
- Meeting recordings, pastoral discussions and prayer requests may contain sensitive information. Obtain appropriate notice/consent and use strict access controls.
- Separate meeting participation from consent to transcription, AI processing or marketing.

## 7. Proposed data model

- `live_provider_connections(id, workspace_id, owner_user_id, provider, external_account_id, encrypted_credentials_ref, scopes, status, created_at)`
- `live_meetings(id, workspace_id, organizer_user_id, provider_connection_id, provider, external_meeting_id, title, starts_at, ends_at, timezone, recurrence_json, join_url, status, entity_type, entity_id)`
- `live_meeting_invites(id, meeting_id, contact_id, email, invitation_status, sent_at)`
- `live_provider_sync_events(id, provider, external_event_id, connection_id, status, processed_at)`
- `live_attendance(id, meeting_id, participant_ref, joined_at, left_at, source)` — optional when provider exposes it
- `live_artifacts(id, meeting_id, kind, provider_artifact_id, storage_key, status, retention_until)` — optional and access-controlled
- `live_ai_summaries(id, meeting_id, source_artifact_id, status, content_json, approved_by, created_at)` — optional
- `live_audit_events(id, workspace_id, actor_id, action, target_ref, created_at)`

Use stable unique provider identifiers, idempotency keys and tenant RLS. Store the minimum required provider data. Avoid copying full media files unless expressly needed.

## 8. Proposed API endpoints

- `GET /api/live/providers` — available provider connections/capabilities
- `GET /api/live/oauth/:provider/start` — initiate authorized OAuth
- `GET /api/live/oauth/:provider/callback` — validate OAuth and save connection
- `DELETE /api/live/connections/:id` — disconnect and revoke where supported
- `GET /api/live/meetings` — tenant-scoped list
- `POST /api/live/meetings` — create on selected provider
- `PATCH /api/live/meetings/:id` — update provider-backed meeting
- `DELETE /api/live/meetings/:id` — cancel according to organizer privileges
- `POST /api/live/meetings/:id/invitations` — invite participants
- `POST /api/webhooks/live/google`, `POST /api/webhooks/live/zoom` — only supported provider events
- `POST /api/live/meetings/:id/summarize` — optional, authorized transcript available

These are proposals, not implemented endpoints.

## 9. Cost model

**Harvest's standard video-media infrastructure cost: $0 per participant-minute**, because Google Meet or Zoom carries the media using the organizer's account.

| Item | Who pays | Notes |
|---|---|---|
| Google Meet / Google Workspace subscription | Connected organizer or organization | Free or paid plan according to features/limits |
| Zoom Meetings subscription | Connected organizer or organization | Free or paid plan according to features/limits |
| Google / Zoom standard integration API | Normally no per-participant media charge to Harvest | Provider API quotas, app approval, and any applicable commercial terms must be verified |
| Harvest backend and database | Harvest | Existing Vercel/Neon operations, webhooks, scheduler, monitoring |
| Reminders/email | Harvest or organization | Depends on email service/usage |
| Optional transcript import / R2 storage | Harvest or charged feature | Storage and API operations; provider feature entitlement required |
| Optional AI summaries | Harvest or charged feature | LLM token costs and optional speech-to-text if transcript unavailable |

**Do not reuse the LiveKit participant-minute, SFU bandwidth or transcoding estimates** from the abandoned native-video proposal. There is no $50/month LiveKit base plan for this architecture. The user's Google/Zoom subscription pricing is outside Harvest's own video costs. Build provider cost alerts for optional AI processing/storage, not video minutes.

## 10. Reliability and UX

- If no provider is connected, show Connect Google Meet and Connect Zoom actions.
- If account expires, show Reconnect; do not silently create meetings on another provider.
- If a meeting cannot be created, retain the unsaved form and explain provider error.
- Detect duplicate submissions and avoid duplicate provider meetings.
- If an organizer disconnects an account, preserve historical Harvest metadata where permitted, but do not promise access to external meetings or recordings.
- Handle timezone and recurrence differences with explicit mappings and tests.
- Provider-side modifications should reconcile without overwriting more recent user edits.

## 11. Acceptance tests

- [ ] Two organizations connect distinct Google accounts; no cross-tenant access.
- [ ] Two organizations connect distinct Zoom accounts; no cross-tenant access.
- [ ] Organizer can choose provider and set a default.
- [ ] Google meeting creation returns valid join URL; Join opens Google Meet.
- [ ] Zoom meeting creation returns valid join URL; Join opens Zoom.
- [ ] Unauthorized organizer cannot create/cancel meetings through another person's account.
- [ ] Token refresh, disconnect, revoked consent and reconnect work.
- [ ] Provider webhook retries and duplicate create requests do not duplicate records.
- [ ] Recurring meetings, timezone changes and provider-side cancellation reconcile.
- [ ] Community/course/event membership restricts meeting visibility appropriately.
- [ ] Unsupported recording/webinar/transcript options are not falsely advertised.
- [ ] Optional transcript/summary access is permissioned, consented, auditable and deletable.
- [ ] No LiveKit SDK, LiveKit credentials, LiveKit server or Zoom Video SDK required.

## 12. Implementation slices

1. **LIVE-01:** Provider-neutral architecture, Neon schema, tenant RLS and role matrix.
2. **LIVE-02:** Google OAuth and Google Meet/Calendar adapter.
3. **LIVE-03:** Zoom OAuth and Meetings API adapter.
4. **LIVE-04:** Harvest meeting scheduling UI integration, provider selection, meeting CRUD and join links.
5. **LIVE-05:** Invitations, reminders, recurrence, calendar and Communities/Courses/Events integration.
6. **LIVE-06:** Webhook synchronization, provider errors, token lifecycle, audit and monitoring.
7. **LIVE-07:** Conditional attendance/recording/transcript metadata integration, with provider capability detection.
8. **LIVE-08:** Optional transcript-based AI summaries, consent, cost caps and review flow.
9. **LIVE-09:** Security, provider API integration tests, quota/rate-limit resilience and pilot.

## 13. Open implementation decisions

- Whether OAuth connections are organizer-owned only or also workspace-managed.
- Exact Google Meet API vs Calendar conference creation behavior for each account tier.
- Google OAuth verification and Zoom app review/distribution requirements.
- Whether provider recordings are linked only or imported into R2 when permitted.
- AI summary availability and pricing/limits; whether to offer provider-native transcripts only.
- Whether to expose webinar/livestream management at all in first integration release.
- Default workspace provider and permission rules.

**This document supersedes the earlier native LiveKit/Zoom Video SDK design. No merge, deployment, provider purchase or production change is authorized by this draft.**
