# Harvest Live — Product Requirements Document and Backend Architecture

**Status:** Proposed PRD for founder review; full-suite direction approved, architecture and cost policy proposed  
**Date:** 20 November 2026  
**Release:** Post-launch / Future Vision unless separately approved; does not modify Professional V1 freeze  
**Scope:** Native meetings, webinars, livestreams, recordings, transcription, AI summaries and Harvest integrations.

## 1. Product vision

Harvest Live is a fully Harvest-branded communications suite for churches, ministries, nonprofits, evangelists and missionaries. Support small discipleship calls, online classrooms, prayer meetings, church leadership meetings, webinars, services and public livestreams. Use the existing Harvest design interface and app shell; **do not build a proprietary SFU or send real-time video through Next.js/Vercel**.

### Key outcomes
- Host and join secure interactive video/audio meetings.
- Run webinars with differentiated host, panelist and attendee privileges.
- Broadcast public livestreams through scalable viewer distribution.
- Record with clear consent, retention and access policies.
- Generate searchable transcripts and AI-generated summaries, highlights and action items.
- Link sessions to Harvest events, groups, communities, courses, campaigns and CRM with appropriate permissions.
- Meter all costly usage per workspace, enforce limits and provide transparent costs.

## 2. Proposed architecture

| Layer | Technology / responsibility |
|---|---|
| Frontend | Existing Studio Admin / shadcn UI + LiveKit JS/React SDK; responsive, accessible meeting experience |
| Harvest API | Next.js route handlers/server services: auth, schedules, RBAC, room grants, join tokens, session records, policy, usage |
| Database | Neon PostgreSQL with tenant RLS: meetings, sessions, participants, grants, artifacts, usage, consent and audit |
| Real-time media | LiveKit Cloud SFU for WebRTC audio/video/data; optional self-hosted adapter later |
| Meeting signaling | LiveKit SDK plus Harvest-owned authoritative permissions; webhook-driven reconciliation |
| Recording/export | LiveKit Egress, signed storage destination and asynchronous job state machine |
| Storage | Cloudflare R2 private recordings/transcripts/captions/thumbnails; short-lived signed downloads |
| Transcription | Provider adapter, initially Deepgram Nova-3 or LiveKit Inference STT after quality/cost test |
| AI processing | Existing provider-agnostic Vercel AI SDK abstraction; structured summaries, chapters, action items, citations/timecodes |
| Jobs | Durable queue/worker for webhooks, reminders, recording processing, transcription, AI summaries and retention purges |
| Broadcast | LiveKit host/panelist room -> Egress/RTMP/HLS -> dedicated CDN/streaming provider for large audiences |
| Observability | Per-room quality, join failures, provider webhooks, job retry metrics, recording/transcript errors, usage ledger |

**Boundaries:** Vercel manages control-plane APIs, not persistent media processing. LiveKit manages WebRTC transport. Never treat LiveKit room membership alone as sufficient authorization; Harvest checks tenant/user permissions before issuing short-lived scoped tokens. Provider credentials remain server-side. Keep an adapter boundary for LiveKit, transcription, CDN and AI providers.

## 3. Product modes

### 3.1 Meetings
- Schedule or instant-start, recurring meetings, invitation links, calendar integration, timezones.
- Host/co-host/participant/guest, passcode or invite-only access, lobby/waiting room and lock.
- Mic/camera, screen sharing, chat, reactions, hand raise, participant controls, mute/remove, layout and device selection.
- Optional breakout rooms (independent LiveKit rooms with coordinated membership and return).
- Optional recordings, transcript, AI summary, captions and attendance.
- Guest join may be allowed only through validated meeting-specific grants, with rate limiting and short-lived tokens.

### 3.2 Webinars
- Host, co-host, panelist, attendee roles; moderated questions and chat; hand raising and stage promotion.
- Registration/attendance and optional approval, with purpose-specific consent.
- Attendee media publishing disabled by default; server-validated stage promotion.
- Webinar capacity and interactive limits enforced by subscription and provider concurrency.
- For high audience counts, transition attendees to a broadcast player instead of an SFU gallery.

### 3.3 Livestreams
- Public/unlisted/private broadcasts with scheduling, landing page, embeddable player and moderated live chat.
- LiveKit host/panelist room -> broadcast egress -> streaming/CDN vendor. Support RTMP/HLS distribution and multiple destinations if vendor capability permits.
- Do not assume YouTube/Facebook retransmission rights or APIs; validate provider scopes and platform policies.
- Viewer authentication and paywall/entitlement when appropriate; no leakage of private room token to broadcast audience.
- Account for ingest, encoding/transcoding, CDN viewer minutes, recording and storage separately.

### 3.4 Recordings and media library
- Host starts/stops recording with explicit recording indication and required participant notice/consent workflow.
- Composite MP4 for meetings/webinars; optional separate tracks after feasibility/cost review.
- Store encrypted/private recordings in R2, metadata in Neon, signed download/playback with entitlement checks.
- Playback with captions, chapters, bookmarks, transcript-linked seek and retention controls.
- Failed/partial egress recovery, provider webhook reconciliation, orphaned recording cleanup and audit logs.

### 3.5 Transcription and AI
- On-demand or policy-approved automatic transcription; language selection, timestamps and speaker labels when supported.
- AI-generated concise summary, structured outline, decisions, action items, optional sermon/class notes and highlights.
- Ground summaries in transcript segments with clickable timecodes; distinguish uncertain speech and allow corrections.
- No automatic external publishing, contact creation or task assignment without user approval.
- Redact/limit sensitive data before sending to AI providers; tenant-controlled retention, deletion and opt-out.
- Prompt-injection defenses: meeting speech/transcripts are untrusted content, never instructions for tools.

## 4. Roles and authorization

Permissions: `live.create`, `live.host`, `live.moderate`, `live.join`, `live.broadcast`, `live.record`, `live.transcribe`, `live.summarize`, `live.viewArtifacts`, `live.export`, `live.manageSettings`. Enforce tenant RLS and per-session membership/entitlement. Public broadcast viewers have no access to internal room API. Every privileged operation must be checked server-side and audited.

## 5. Primary user journeys

1. Admin creates recurring discipleship meeting linked to a Community, invites members and joins as host; members use permitted join links.
2. Ministry creates webinar, opens registration, assigns panelists, hosts Q&A, records and reviews attendance.
3. Church streams service: hosts connect via LiveKit, audience watches CDN player; broadcast can be embedded on Harvest site.
4. Host records with required notices; egress completion triggers storage verification, transcription and optional AI summary.
5. Authorized user opens recording and timecoded transcript, edits summary, approves action items and optionally publishes a replay.
6. Workspace owner sets limits/retention and reviews minutes, bandwidth, transcoding, transcription, AI and CDN costs.

## 6. Backend entities (proposed)

- `live_meetings(id,workspace_id,title,mode,visibility,starts_at,ends_at,recurrence,policy_json,created_by)`
- `live_sessions(id,meeting_id,provider_room_id,status,started_at,ended_at,host_id)`
- `live_invites(id,meeting_id,recipient_ref,role,expires_at,redeemed_at)`
- `live_participants(id,session_id,user_id,guest_ref,role,joined_at,left_at)`
- `live_role_grants(id,session_id,principal_id,role,granted_by)`
- `live_webhook_events(id,provider,event_id,payload_hash,received_at,processed_at)`
- `live_recordings(id,session_id,provider_egress_id,r2_key,status,duration_seconds,size_bytes,retention_until)`
- `live_transcripts(id,recording_id,language,provider,status,storage_key)`
- `live_transcript_segments(id,transcript_id,start_ms,end_ms,speaker,text,confidence)`
- `live_ai_artifacts(id,recording_id,kind,model,status,content_json,approved_by)`
- `live_broadcasts(id,session_id,cdn_provider,stream_ref,visibility,status)`
- `live_usage_events(id,workspace_id,session_id,meter,quantity,unit,provider_event_id)`
- `live_usage_aggregates(workspace_id,period,meter,total_quantity,estimated_cost)`
- `live_consent_events(id,session_id,participant_ref,purpose,version,action,created_at)`
- `live_audit_events(id,workspace_id,actor_id,action,target_ref,created_at)`

Use explicit unique keys for webhook idempotency and provider references. Reconcile usage with vendor invoices. Apply deletion/retention to recordings, transcripts, embeddings and AI artifacts, including downstream provider copies when supported.

## 7. Proposed service endpoints

- `POST /api/live/meetings`, `GET /api/live/meetings`, `PATCH /api/live/meetings/:id`
- `POST /api/live/meetings/:id/invites`, `POST /api/live/meetings/:id/join-token`
- `POST /api/live/sessions/:id/start`, `POST /api/live/sessions/:id/end`
- `POST /api/live/sessions/:id/moderation`, `POST /api/live/sessions/:id/breakouts`
- `POST /api/live/sessions/:id/recordings/start`, `POST /api/live/sessions/:id/recordings/stop`
- `POST /api/live/sessions/:id/broadcast/start`, `POST /api/live/sessions/:id/broadcast/stop`
- `POST /api/live/recordings/:id/transcribe`, `POST /api/live/recordings/:id/summarize`
- `GET /api/live/recordings/:id/playback-token`, `GET /api/live/usage`
- `POST /api/webhooks/livekit`, `POST /api/webhooks/live-broadcast`

All proposed; no endpoints asserted as implemented.

## 8. State machines and reliability

- Meeting: draft -> scheduled -> live -> ended/cancelled.
- Recording: requested -> starting -> active -> stopping -> processing -> ready/failed.
- Transcript: queued -> processing -> ready/failed; summary: queued -> generating -> review -> approved/failed.
- Broadcast: scheduled -> starting -> live -> stopping -> ended/failed.
- Webhooks: verify signature, deduplicate, queue processing, replay safely, reconcile missing/out-of-order events.
- Issue tokens with short TTL and narrow grants; revocation/moderation must propagate to provider.
- On network disruption, rejoin safely; do not duplicate recordings, billing events or participant attendance.

## 9. Cost model — verified public list prices as of 20 Nov 2026

Sources:
- https://livekit.com/pricing
- https://docs.livekit.io/deploy/admin/billing/
- https://deepgram.com/pricing
- https://developers.cloudflare.com/r2/pricing/

### LiveKit Cloud plans
| Meter | Build | Ship | Scale |
|---|---|---|---|
| Base/month | $0 | from $50 | from $500 |
| WebRTC participant-minutes included | 5,000 | 150,000 | 1,500,000 |
| Participant overage/minute | hard free cap | $0.0005 | $0.0004 |
| Downstream GB included | 50 | 250 | 3 TB |
| Downstream GB overage | hard free cap | $0.12 | $0.10 |
| Shared video transcode minutes (import/record/export) | 60 | 600 | 8,000 |
| Video transcode overage/minute | hard free cap | $0.02 | $0.015 |
| Concurrent connections | 100 | 1,000 | 5,000 |

These are plan-wide usage and concurrency quotas, not promised room capacities. Egress/ingress concurrent quotas and duration limits also apply. Scale plan may be cheaper at high volume; compare total cost, not just base fee.

### Additional services
- Cloudflare R2 Standard: **$0.015 per GB-month** after 10 GB-month free; Class A $4.50/million, Class B $0.36/million after free operations; no R2 egress charge, but CDN/transcoding/other vendor fees may apply.
- Deepgram Nova-3 monolingual prerecorded STT: **$0.0077/min** pay-as-you-go; multilingual **$0.0092/min**; diarization **+$0.002/min** if enabled.
- AI summaries: token-metered and model-dependent; set a configurable per-session allowance. No unsupported fixed price promise.
- Large livestream delivery: **TBD** until CDN vendor, bitrate, playback protocol and viewer-minutes are specified. Do not model 10,000 HLS viewers as LiveKit interactive participants.
- Other: Vercel/Neon/queue operations, CDN, email notifications, taxes, support, regional data controls and optional AI agent costs.

### Formula
- `participant_minutes = sum(joined_seconds)/60`
- `downstream_GB ≈ sum(average_downstream_Mbps × connected_seconds / 8000)` (decimal GB)
- `recording_transcode_minutes = sum(composite_egress_seconds)/60`
- `stt_minutes = sum(transcribed_audio_seconds)/60`
- `storage_GB_month = average_recording_GB_stored_over_month`
- `total = plan_base + participant_overage + bandwidth_overage + transcode_overage + R2 + STT + LLM + CDN + other`

**Illustrative Ship scenarios, not invoices:** assume 1.5 Mbps average downstream per participant, one composite recording for a share of sessions, 0.04 GB stored per recorded minute, all recorded audio transcribed, no separate CDN, no AI LLM charges and no R2 free-tier offsets:
1. Small: 40 meetings × 12 people × 60 min, 50% recorded = 28,800 participant-min, ~324 GB downstream, 1,200 recording minutes. Base $50 + downstream ~$8.88 + transcode $12 + STT $9.24 + R2 ~$0.72 = **~$80.84/month**.
2. Medium: 200 meetings × 20 people × 60 min, 50% recorded = 240,000 participant-min, ~2,700 GB downstream, 6,000 recording minutes. Base $50 + participant overage $45 + downstream $294 + transcode $108 + STT $46.20 + R2 $3.60 = **~$546.80/month**.
3. Large: 500 meetings × 40 people × 60 min, 50% recorded = 1,200,000 participant-min, ~13,500 GB downstream, 15,000 recording minutes. **Compare Scale plan**, dedicated CDN and realistic concurrency; do not extrapolate Ship uncritically.

Actual costs vary with video tiles/bitrates, durations, cloud plan, egress, retention, AI models, CDN, regional taxes and provider terms. Pilot with measured bytes/participant-minute before defining customer pricing.

### Cost safeguards
- Workspace monthly limits for participant-minutes, GB, recordings, transcription, AI and livestream delivery.
- Pre-session estimate, in-session usage meter, admin warning thresholds (e.g. 50/80/100%), concurrency limits and per-meeting maximum duration.
- Optional recording/transcription/AI disabled by default unless admin policy permits.
- Graceful limit behavior: prevent new costly sessions/recordings rather than unexpectedly disconnecting ongoing pastoral calls; define hard-cap policy explicitly.
- Ledger of raw provider meter events, estimates and reconciled invoice charges; no double-count on webhook retries.
- Separate public-broadcast viewer-minute billing and safeguards.
- Never activate a paid plan or create billable cloud resources without separate founder approval.

## 10. Security, privacy and compliance

- Record/transcribe only with jurisdiction-appropriate notice, consent and organizer authority; provide visible in-call indicators.
- Religious discussions, pastoral counseling and prayer requests can be highly sensitive. Private-by-default, strict tenant and per-session permissions, no cross-workspace search.
- Store recordings and transcripts privately with short-lived signed access; encrypt data and restrict key access.
- Explicit retention per workspace and content type; user-facing deletion and export, audit trails and provider deletion requests.
- Separate consent for recording, transcription, AI processing, marketing/follow-up; participation is not marketing consent.
- Evaluate E2EE compatibility with server-side recording, live captions and AI processing: do not promise both without a validated design.
- Never silently feed transcripts into CRM, fundraising or external outreach.
- Moderation: host removal, guest abuse/rate limits, waiting rooms, link expiry and spam controls.
- Validate vendor DPAs, residency requirements, subprocessor lists and data-processing regions before production.

## 11. Acceptance tests

- [ ] Host schedules recurring group meeting; member with valid grant joins; unrelated tenant cannot mint join token.
- [ ] Guest invitation expires, role is limited, removed guest cannot rejoin without renewed grant.
- [ ] Meeting handles reconnect, screen share, hand raise, chat and host moderation.
- [ ] Webinar attendees cannot publish media or promote themselves; host can promote panelist.
- [ ] Broadcast viewers can watch through CDN without interactive room access; invalid stream token rejected.
- [ ] Recording requires approved policy and visible indicator; start/stop/retry are idempotent.
- [ ] Recording arrives in private R2; only authorized users can play/download; retention purge works.
- [ ] Transcript timestamps match recording, errors/retries recover; AI summary includes transcript references.
- [ ] AI tool actions require explicit approval and cannot obey malicious transcript instructions.
- [ ] Usage ledger reconciles participant minutes, downstream bytes, transcode, STT, storage, LLM and CDN to provider data.
- [ ] Quota thresholds, concurrency and budget safeguards work; no surprise unbounded usage.
- [ ] Accessibility, mobile experience, privacy, load, failure injection and cross-tenant regression tests pass.

## 12. Proposed implementation PR slices

1. **LIVE-01:** ADR, provider abstraction, Neon schemas, RLS, role/capability matrix, quotas.
2. **LIVE-02:** LiveKit integration, scoped join tokens, room/session lifecycle, webhook signature/idempotency.
3. **LIVE-03:** Native meeting UX wiring, media tracks, reconnect, screen share, chat and moderation.
4. **LIVE-04:** Calendar/scheduling, invitations, recurring meetings, reminders, group/course/event links.
5. **LIVE-05:** Webinar roles, registration, moderated Q&A, presenter controls.
6. **LIVE-06:** Livestream pipeline, HLS/CDN vendor adapter, viewer authorization, cost metering.
7. **LIVE-07:** Recording/egress state machine, private R2, signed playback, retention and consent.
8. **LIVE-08:** STT adapter, transcripts, captions, diarization, search and timed playback.
9. **LIVE-09:** AI summaries, chapters, action items, review/approval, model routing and cost limits.
10. **LIVE-10:** Billing meter reconciliation, budget controls, admin analytics, observability and hardening.
11. **LIVE-11:** Pilot testing, load and network failure drills, privacy/security review and operational runbooks.

## 13. Open decisions requiring review

- Broadcast/CDN provider and viewer pricing (Cloudflare Stream, Mux or other) after benchmark.
- Whether webinars use interactive LiveKit attendees up to a capped threshold, then broadcast fallback.
- Default retention and consent policies by jurisdiction; explicit recording/transcription defaults.
- Live captions vs post-meeting transcription and per-language quality requirements.
- Whether breakout rooms, live translation, phone dial-in and multi-destination streaming are first-wave or later slices.
- Exact plan limits, internal markup and customer-facing billing model.
- Region pinning / compliance needs and encryption design for AI and recording workflows.

**No deployment, provider purchase, billing activation, merge or production changes authorized by this PRD.**
