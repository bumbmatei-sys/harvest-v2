# Social — composer, planner, unified inbox and Auto-DM — design

Status: **DRAFT for founder and independent review**, 17 Nov 2026. Documentation only; no implementation, migration, provider activity or activation. Communities completion retains priority. All HC-02 decisions remain UNAPPROVED.

References: house style `2026-11-11-communities-pr4b-forum-design.md`; `docs/prd/professional-v1-launch-scope.md`; `docs/plans/zernio-integration-layer.md`; `docs/acceptance/zernio-integration-layer.md`; `docs/decisions/social-provider-integration-status.md`; `src/server/social/{port,types,registry,service,publisher,state,webhook}.ts`; `src/server/{mail,calendar,files-provider}/port.ts`; shared UI registry and kit catalog.

## Scope

**In:** provider-neutral social composer, Harvest-owned planner, **one unified social inbox for every verified Zernio platform/account**, human conversation/comment replies where supported, and provider-eligible Auto-DM rules. All use Harvest-owned domain services and the existing provider layer.

**Out:** community chat/DM storage, an email/social combined inbox, newsletter inbox, direct platform SDKs, vendor frontend, AI agent/workflow builder, unsolicited bulk DMs, ads/listening and claims of universal feature parity. Office email stays a separate inbox in Operations. Newsletter supplies campaign/analytics screens, not an inbox.

## Existing foundation and gaps

Migration 0051 supplies `social_connections`, `social_posts`, metadata-only webhook rows, sealed tenant/connection-bound credentials, guarded lifecycle/versioning, worker claim/complete and a fake provider. The service links/lists/checks accounts and creates/schedules/reschedules/cancels/retries/lists posts. Provider calls run outside database transactions. Inbox **ports** read conversations/messages/comments; this is not an existing unified inbox screen or a finished aggregation service.

Both `SOCIAL_INTEGRATION_ENABLED` and the adapter's live-network constant are false. `getSocialSender()` intentionally throws; `SocialSender` contains signatures only. Source guards confine sending and vendor imports. They remain in place until reviewed implementation slices deliberately extend them with tests. No environment flag or UI button bypasses those constants.

The current `SocialPlatform` tuple recognizes Facebook, Instagram, Threads, TikTok and YouTube. That tuple is a foundation boundary, **not the founder's requested final platform coverage**. Before implementing account/inbox UI, audit the provider's current platform inventory and extend Harvest types/adapter/schema tests for every verified supported platform. Do not invent a platform list or hide a newly supported platform because the old tuple has five values.

Account connection UI needs a reviewed OAuth ownership/state/PKCE/callback contract; the existing credential-taking link service is not proof that this user flow exists. Do not turn it into a launch form asking users to paste provider secrets. Keep previews on fake/injected credentials until that prerequisite is complete.

## Shared UI and pages

Routes and navigation follow the typed registry in `src/lib/navigation.ts` on main, under the existing `/workspaces/[tenantId]` prefix (`href = /workspaces/${tenantId}${entry.path}`). Four entries already exist, all `mode: "public"`, `group: "publishing"`, `status: "planned"`:

| Registry id | Path (below `/workspaces/[tenantId]`) | Screen |
| --- | --- | --- |
| `composer` | `/social/compose` | composer/editor |
| `planner` | `/social/planner` | planner |
| `inbox` | `/inbox` | unified social inbox |
| `autoDm` | `/inbox/auto-dm` | Auto-DM rules |

These belong to the **Public** shell mode, not Operations. The three-inbox model: the social inbox (`inbox`) lives in Public; the Operations `mail` entry (`/mail`, group `office`) is the **separate** email inbox for per-admin connected mailboxes; newsletter supplies campaign analytics only, with no inbox; community chat stays separate. Do not merge these sources into one list. The implementation slice flips `status` from `planned` and adds permissions; it registers no new ids or per-module shell clone. User-facing labels say ministry and omit supplier names.

| Area | Proposed source / preview | Shared Harvest reuse / alternative |
| --- | --- | --- |
| Composer/settings | [`form-layout1`](https://shadcnuikit.com/blocks/dashboard-ui/form-layouts#form-layout-1), audited Studio Admin editor/settings patterns | `EditorShell`, `Field`, `Textarea`, `UploadControl`, `FileList`, `StickySaveBar`, `ConfirmDialog` |
| Planner | [`event-calendar1`](https://shadcnuikit.com/blocks/application-ui/event-calendar#event-calendar-1); `event-calendar2` alternative | the shared calendar presentation if C14 has landed; otherwise this module adopts the kit's `event-calendar1` directly (social does not depend on or wait for C14), `Tabs`, `Sheet`, `StatusBadge`; social posts remain their own domain records |
| Unified inbox list/pane | [`mail-app4`](https://shadcnuikit.com/blocks/application-ui/mail-app#mail-app-4); `mail-app6` alternative | pinned MIT Studio Admin `src/app/(main)/mail/_components/`, existing list/empty/skeleton/error components |
| Conversation/message rows | [`chat-ui4`](https://shadcnuikit.com/blocks/application-ui/chat-ui#chat-ui-4), free bubble family | C11's adopted message primitives, `Avatar`, `Item`, `Badge`, `DropdownMenu`; domain authorization stays separate |
| Auto-DM rule list/editor | [`tables19`](https://shadcnuikit.com/blocks/dashboard-ui/tables#tables-19), `form-layout1` | existing configured `ListPage`, `EditorShell`, shared form fields and confirmation |

Exact fit/anchors/dependencies are verified before adoption. **Dependency verification is explicit:** `form-layout1` requires `react-hook-form` and `zod`; confirm the versions in `package.json` (and the resolver/`@hookform/resolvers` pairing) are compatible with the block before adopting it, and record the result in provenance. Founder rule (17 Nov): paid kit blocks are used wherever they fit, and the licence is settled, so premium sources no longer wait for a licence relay. Record every adopted file/item/licence in provenance. If no source covers a screen, return to the founder. No source is copied by this spec.

## Composer and publishing model

Reuse `social_posts` as the per-connection delivery owner. Propose a small `social_drafts` group record for common text/media, per-destination variants and optimistic version; child post ids remain canonical delivery records. Do not create a second scheduled-post table or treat a successful group as proof that every destination published.

- Select authorized connected accounts; validate each destination's verified text/media/options limits server-side. Unsupported options stay explicit; do not silently truncate or coerce a video into an image post.
- Plain-text composition is the first contract, matching `PublishRequest.content`. An HTML editor must not send markup to a plain-text API. Per-platform overrides are explicit and preserve the common draft.
- Reuse existing file/scanner/release services. External file browsing/import uses `FilesProvider`; credentials, arbitrary remote file URLs and unscanned uploads never go directly into publishing. Resolve authorized ready media at dispatch; expired delivery URLs produce a recoverable media error, not a public leak.
- Save draft, schedule and publish-now are distinct guarded actions. Publish-now requires a concrete review of destinations/content; no auto-post on wizard completion.
- Versions reject conflicting edits. A post after first attempt retains the foundation's frozen content and immutable first-attempt time. Editing a published/attempted item creates an explicit new draft; it does not reset idempotency or resend a successful child.
- Harvest owns scheduling: planner timestamps are stored in UTC with an explicit display timezone. The worker asks the provider to publish now and omits provider-side scheduling, preserving the merged worker contract. Dragging has a keyboard/date-field alternative and a confirmation/version check.
- Partial success is displayed per account. Retry only eligible failed children with the original idempotency key; accepted/published children are reconciled, never republished. Unknown outcomes stay unknown until status reconciliation.

The existing 23-hour retry horizon depends on an **unverified 24-hour provider idempotency guarantee**. Keep it restrictive; verify the real guarantee before activation. Do not market exactly-once delivery or invent a new key after an ambiguous timeout. Webhook events are deduplicated, authenticated metadata used to reconcile state, never trusted to grant account ownership.

## One unified social inbox

One list combines authorized conversations and comment threads across all connected, verified supported accounts. Filters (account, platform, kind, unread, assigned) configure this same inbox; they do not create separate per-platform inbox products.

A capability registry records per platform/account: conversation read, message read/reply, comment read/reply, Auto-DM trigger types, media/options and reply-window/permission limits. Values are verified against the provider contract/sandbox and versioned with evidence. Unsupported functions are labelled unavailable; an API denial or expired connection is not rendered as an empty inbox. An account with no inbox capability still appears in account management and the unified account filter with a clear unavailable state.

- Aggregate bounded provider pages with bounded concurrency and backoff. Use a signed/opaque aggregate cursor containing per-account cursors and the authorized account set/version; never collapse different accounts' cursors or skip a slow account silently.
- Stable identity is ministry + connection + provider reference + item kind. A comment thread and a DM with matching external strings never collide. Deduplicate replayed pages/events; show account/channel context on every row and composer.
- Message/comment bodies and previews remain **live pass-through**, as the merged foundation specifies. No body in webhook rows, jobs, audit, analytics or persistent inbox cache. Responses are private/no-store. Any persistent retention or search is a separate reviewed decision.
- Propose local metadata only: assignment/status and per-reader seen markers, scoped to connection/reference. The port has no mark-read/label/assignment operation; call these “read in Harvest” and local assignment unless a later verified port extension supports provider synchronization. Never claim a provider mailbox was marked read.
- Authorize every read and reply against the connection's current ministry/status/capabilities; do not accept a free-form external conversation id as ownership. Account disconnect/revocation invalidates pending work and cached pages. No contact or consent is created from an inbound participant automatically.
- Opening a conversation retains the latest safely loaded state on transient failure and shows retry. Polling stops when hidden/offline, resumes on focus and respects Retry-After. Reuse C11's polling infrastructure only after it has real consumers; provider cursors remain provider cursors, not chat revisions.

## Human replies and Auto-DM

Human replies use the separate sender port through a newly reviewed domain service/job; UI never obtains credentials or a sender directly. Enforce current reply eligibility, provider window/scopes, account health, authorization and stable per-attempt idempotency. Provider policy eligibility is separate from CRM marketing consent. An inbound message does not grant newsletter, outreach or unrelated promotional consent.

Auto-DM is a bounded feature, not a generic workflow engine. Propose versioned, initially disabled rules: connection, verified trigger type, explicit keyword/match policy, response template, cooldown and per-recipient/rule limits. List only trigger/platform combinations the provider actually supports. Per `docs/prd/professional-v1-launch-scope.md` (16 Nov scope exception: "Auto-DM on Instagram and Facebook"), Auto-DM scope is **Instagram and Facebook**. Other platforms are in scope only for the composer and inbox, once verified; they do not get Auto-DM rules unless the founder later extends scope. This supersedes the earlier, broader "all documented eligible Auto-DMs" wording in the same PRD. No implied Auto-DM support on every inbox platform.

A metadata webhook event enqueues a deduplicated evaluation `(connection,rule_version,event_id,recipient_ref)`. Evaluation must securely obtain any necessary trigger evidence through the provider; the current webhook parser deliberately drops comment/message text. Do not start storing raw webhook bodies or matching a missing text field. If the port cannot supply the evidence/permission, that trigger stays unavailable until an explicit adapter extension is reviewed.

At dispatch, recheck rule version/enabled state, account authorization, recipient/provider eligibility, limits, suppression and any required consent for the declared purpose. `mayContact` applies when a canonical CRM contact/purpose is involved; do not infer a CRM identity or treat a community membership, comment or follow as a purpose grant. Legal/provider review defines when a requested transactional reply differs from promotional outreach. No production rule is enabled by this design.

Use separate outbox/job kinds and worker-role claims for social replies/Auto-DM; do not bypass the post publisher's invariants or grant a web process a generic sender. Network calls are outside transactions, with immutable idempotency, leases, bounded retries and ambiguous-outcome reconciliation. Disable/disconnect/withdrawal cancels undispatched jobs and prevents retries. Already accepted remote delivery cannot be recalled; the authorization-to-submit boundary is explicitly reviewed and tested.

Rule preview and test messages use the fake provider/synthetic recipients only. No real outbound messages or webhooks outside tests. Audit ids, versions and fixed outcomes; never participant text, credentials, addresses or recipient profiles.

## Office/provider boundaries

All social, connected mail, calendar and files access goes through the selected Zernio provider layer. `MailProvider`, `CalendarProvider` and `FilesProvider` keep their separate domain contracts. Office is an Operations mailbox/calendar/files surface with per-admin connections; it is not a new source merged into social inbox rows. A social schedule is not a provider calendar appointment; optional calendar projections later use `CalendarProvider`. Newsletter is a separate campaign/analytics domain with no inbox.

## Permissions, data and activation

Retain current owner/admin-only `social:connect`, `social:schedule`, `social:inbox` defaults; new reply/Auto-DM capabilities require explicit server/SQL mapping. Viewers/members receive no social credentials or participant content. Delegated team access is a later permission design, not a UI role check.

New group/rule/local-inbox-metadata tables carry tenant ownership/composite FKs, FORCE RLS, version/transition guards and metadata-only audit. Restricted-owner and worker grants are tested per migration. No migration number reserved. Revoked connections remain terminal; no UI health retry silently relinks a foreign account.

Before live use: current platform/capability and idempotency evidence, provider agreement/DPA, OAuth ownership, key model, quotas/rate plan, webhook authentication/replay, media scanning, reply/Auto-DM purpose policy and independent security review. Existing integration/live-network/sender gates remain hard-disabled. This approves no HC-02 decision, real send, deployment or activation.

## Testing and slices

Unit/integration: port parity with fake/mock transport, all verified platforms and unavailable capabilities, two ministries/direct RLS, credential binding, pagination across multiple/slow accounts, no body persistence, stale edits, scheduling/timezones, partial outcomes and idempotency expiry, forged/replayed/out-of-order webhooks, account disconnect, worker/app grants, reply windows/permission changes, rule cooldown/deduplication, purpose withdrawal/dispatch races and no real network.

Browser: common draft plus per-account variants; schedule/reschedule with keyboard; partial results/retry; one combined multi-platform inbox and filters; human reply fake; Auto-DM preview/disable; expired connection versus true empty. Axe, no overflow, light/dark 360/768/1280, 44px targets, source provenance and screenshots. Fresh non-author review per PR.

| Slice | Delivers | Exit |
| --- | --- | --- |
| S01 contract/capabilities | verified full platform inventory, port/schema extensions, capability evidence | parity/unsupported/ownership tests; constants unchanged |
| S02 composer/planner | shared/adopted UI, group draft, existing publishing lifecycle | version/timezone/partial/idempotency tests + screenshots |
| S03 unified read inbox | one aggregated list/pane and private local metadata | multi-account cursors, privacy/isolation, fake browser flow |
| S04 human replies | reviewed sender/job boundary and eligibility | fake send/retry/withdrawal/worker tests |
| S05 Auto-DM | bounded disabled rules, evidence fetch and guarded jobs | trigger matrix, dedupe/limits/purpose races; synthetic only |

Reviewers must verify the complete platform inventory/capability mapping; the founder has already required full supported-platform coverage, so the current five-value tuple is not an optional reduced scope. Remaining founder/reviewer decisions: local-only seen/assignment semantics versus a reviewed persistence expansion; human-reply and Auto-DM purpose/eligibility policy; exact UI sources (licence settled, 17 Nov). No provider contract or activation is inferred. One branch/draft PR per slice; no merge/deploy, and migrations require trusted-main Neon verification.
