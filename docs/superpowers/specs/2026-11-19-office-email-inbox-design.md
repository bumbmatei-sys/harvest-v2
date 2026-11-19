# Office email inbox

**Draft for founder and independent review, 19 November 2026.** Design only. The five HC-02 activation decisions remain **UNAPPROVED**.

## Summary

An owner or admin opens Mail in Operations and connects their own Gmail or Outlook mailbox through the existing Office provider boundary. Harvest fetches threads and drafts for the selected mailbox on demand. The user can search, read, draft, send, reply, forward and manage labels within the capabilities of that mailbox. Consent, revocation and send controls apply per person and ministry. The founder-supplied mail app is the visual source.

## 1. Scope and navigation

| Surface | Registry entry and audience | Owns |
| --- | --- | --- |
| Office email | Operations `mail`, group `office`, `/workspaces/[tenantId]/mail`, currently planned | A person's explicitly connected provider mailbox |
| Social inbox | Public `inbox`, group `publishing`, `/workspaces/[tenantId]/inbox` | The ministry's connected social conversations and Auto-DM |
| Newsletter | Public `newsletter`, group `publishing`, `/workspaces/[tenantId]/newsletter` | Newsletter sending and analytics. Replies go to the sender's mailbox and appear in Mail only if that person has connected it |
| Community chat | Member-facing Communities | Channels and participant-only DMs |

Keep `mail` planned until real routes, permission states and disconnected states exist. Reuse AppShell, the ministry switch, shared record/layout and inbox primitives. Share view composition, focus handling and paging behavior with the social inbox when both have real consumers. Each domain retains its own service, credentials and data policies. Office Mail stays full page for the first slice. A later pane can show a read-only preview using the same authorization and fetch paths. Composer and draft editing open full width.

V1 covers personal mailboxes connected by each owner or admin. Shared addresses, delegated access, mail-to-CRM capture, mailbox automation, bulk sends, attachments and offline mail are deferred. User-facing labels describe capabilities and account states in provider-neutral language.

## 2. Connection and consent

Reuse `office_connections` (0053) and the sealed Office credential envelope. The connection key is `(tenant, connection, owner, kind=mail)`. The authenticated actor and current `withTenant` membership determine the owner; request input can select only a connection UUID belonging to that tuple. An owner or admin cannot read another person's connection, metadata, cap, messages or drafts. Members, viewers and former admins are refused. Disabled routes answer 404 before auth from an environment-only server gate. Foreign and missing mailboxes or threads receive the same response.

1. Explain which mailbox and operations Harvest will access, what the upstream provider stores, and how disconnect and deletion work. Show separate grants for reading and sending. Require an affirmative action and record policy version, allowed scopes, actor, connection ID and time. Consent is scoped to the mailbox and does not create CRM or newsletter permission.
2. Provider-hosted authorization and account selection use the existing Zernio boundary. Bind callback state to the session, tenant, expiry and intended scopes. Verify the selected ref against the provider account list and recheck the connecting role before persistence. The browser never supplies credentials or provider refs to normal mail actions. Gmail and Outlook support and individual scopes need sandbox verification. [Office ports acceptance](../../acceptance/mail-calendar-files-ports.md)
3. Recheck owner, membership, live scope and connection generation immediately before transport. Bind cursors, thread/message/draft refs and idempotency records to the connection and generation. Recheck the connection before returning sensitive responses. Clear in-flight UI state, results and draft buffers on ministry/account changes. Disconnect suspends actions, invalidates cursors and pending writes, revokes the upstream grant where supported and schedules scoped credential/metadata removal. A reconnect starts a new generation. Document the outcome of a send already accepted upstream.
4. Owners and admins can administer the integration policy and see aggregate availability. Personal connection management belongs to the connecting account. Audit access and write outcomes with internal IDs, operation, time and status. Keep subjects, addresses, search terms, body text, raw provider responses and credentials out of audit, telemetry, exports and error logs.

## 3. Data, reads and drafts

**Persist** the sealed connection, versioned consent, minimal revocation state, write idempotency/cap reservations and redacted audit. **Fetch on demand** thread summaries, message bodies, draft content, labels, search results and provider caps. No mailbox sync, full-text index, persistent content cache, external image proxy or offline service-worker cache. Responses are private and no-store. Session memory retains the active view only and aborts stale requests. Recovery drafts live at the provider once saved. A failure keeps the local draft in memory for retry.

Use the existing `MailProvider` from `src/server/mail/port.ts` and its fake. The current port supports account-scoped cursor/search queries, thread/message list, drafts, labels, send/reply/forward and send caps. The live adapter is disabled. Verify real query semantics, sort, stable thread refs, unread/folder fields, draft versions and threading for both providers before extending the port. Unsupported controls stay hidden. An archive or mark-read affordance requires an explicit port capability and defined provider behavior.

- Fetch paginated thread summaries and open a thread with a separately scoped request. Resolve returned message refs through the authorized provider thread and connection rather than taking arbitrary refs from the browser. Display normalized sender, subject, time and body. Render plain text by default. A reviewed sanitized HTML renderer can follow later, with remote image loading disabled and safe link handling. Never load message content in page metadata.
- Search the selected mailbox through the provider, debounced and bounded with a result cap. Label and unread filters apply server-side when supported. Reset the cursor whenever scope, query or filter changes. Neither logs nor URLs need to carry a search string. If a provider cannot support a filter over the mailbox, hide it to avoid presenting locally filtered pages as global results.
- Draft creation, updates and deletion stay scoped to the mailbox. Use provider versions or a documented compare-and-set fallback before offering autosave across tabs. Retry the same draft mutation id and reconcile after a timeout. Delete is a scoped provider operation with confirmation. Replies and forwards quote only the selected message and preserve the provider thread link when supported. Keep the provider's label IDs internally, display plain text names and scope label changes to a message with conflict handling.

## 4. Send, caps and failure

Immediate send, reply and forward use an explicit human action with a final recipient check. Validate mailboxes, recipient count, body size and selected draft/message ownership on the server. Separate “Draft saved”, “Sending”, “Sent” and “Check send status” states. Render “Sent” after upstream acknowledgement. Attachments, scheduled send and background retry delivery need their own slice and approval.

Recheck the provider cap and apply a lower configurable per-mailbox pilot cap plus a recipient bound. The provider cap covers sends made elsewhere when the provider supplies that data. Reserve local capacity atomically by connection, day/window and operation key, so concurrent tabs cannot exceed the Harvest cap. Pin execution to the authorized connection and draft version/content fingerprint. Retry a definite failure with the same request key. After an ambiguous response, reconcile with a provider receipt or sent state before allowing another send. Treat unknown capabilities or quota as unavailable. Log outcomes and counters without content. A role change, disconnect or gate closing prevents all later transport attempts. Integration tests use a recording fake and never deliver real mail.

## 5. UI adoption

Inspect source at the founder-supplied Admin-dashboard revision `1631106a7906c1a473ae3a49fb1d392605d39108`. Paths below are under `app/dashboard/(auth)/apps/mail/`. The table is a copy and adaptation plan.

| Real file | Copy and adapt |
| --- | --- |
| `components/mail.tsx` | Preserve responsive column layout, toolbar, resizable split and list/detail composition. Replace mock accounts, folders and in-memory read filters with scoped mailbox and cursor state. Use existing compatible resize/layout primitives or submit any required dependency for approval. |
| `components/mail-list.tsx` | Preserve list rows, badges and scrolling. Replace fixture `Mail` objects with typed thread summaries and opaque keys. Scope selection and unread status to the selected mailbox. |
| `components/mail-display.tsx` | Preserve desktop detail and composer/reply action layout. Replace single demo body, mock people, cosmetic actions and template editor dependencies with fetched messages and approved shared fields/action controls. |
| `components/mail-display-mobile.tsx` | Preserve mobile detail transitions and controls. Share the desktop message projection and action handlers. Restore focus on close and clear selection if the mailbox changes. |
| `use-mail.ts` | Preserve the small selection interface. Replace the module-level Zustand `Mail` object with a mailbox-scoped thread key in the mounted inbox state. Do not introduce Zustand for selection. |
| `components/account-switcher.tsx`, `components/nav-desktop.tsx`, `components/nav-mobile.tsx`, `components/nav.tsx` | Adapt account/folder controls where the template fits. Populate only from scoped connections and verified provider capabilities, using shared menus and buttons. |

The kit `page.tsx` and `data.tsx` are references for wiring and fixture shape. Harvest owns the page entry point, views, validators and network state. No mock data or fixture types enter the implementation. The `mail-app` block family is an optional composer reference if a missing area needs it. Exact registry item pending verification in the implementation slice.

Only files actually copied get the header “Derived from bumbmatei-sys/Admin-dashboard (Shadcn UI Kit, premium, founder-supplied): <path>”. Harvest-authored references say “modelled on … code written for Harvest”. Record commit/path, adapted responsibility and approval in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`. The premium licence is settled by the founder. Keep one responsive design, with semantic tokens, keyboard/focus support, 44px mobile targets and concise state-specific copy.

## 6. Privacy and activation gates

- Obtain the DPA, subprocessor list, region/transfer terms, data deletion and incident processes. Review the provider's retained first message of each thread, sent content and draft/search handling. Confirm supported consent scopes and disconnect behavior for both mailbox families. [Existing provider findings](../../acceptance/mail-calendar-files-ports.md)
- Agree how long connection and audit metadata, idempotency receipts and drafts are retained, who can see audit, and how access/deletion requests work. Exercise revocation, envelope rotation, deletion and a timed purge with failure monitoring using synthetic data. A support role needs a distinct approved policy before any access.
- Verify per-account caps, provider scope enforcement, account-reference scoping, expiry and reconciliation in a permitted sandbox. No real send, webhook, production activation or legal sign-off is represented by this design. Poll on demand initially. Any incoming webhook model needs separate review.

## 7. PR slices and tests

| Slice | Delivers | Exit evidence |
| --- | --- | --- |
| MAIL-1 · personal read service | Consent, owner-only read/revoke, server gate, thread/search/draft/label port projections | two ministries and two admins in one ministry, owner/admin demotion, stale connection generation, neutral foreign IDs, scope checks, fakes only |
| MAIL-2 · inbox and read UI | Adopted desktop/mobile list and detail, state and scoped account picker, Operations registry activation under the reviewed gate | real service with fake provider, empty/error/disconnect and draft recovery, keyboard/axe, 360/768/1280 light/dark, no cache across accounts |
| MAIL-3 · compose and write | Versioned drafts, reply/forward, label mutation, explicit send with caps, idempotency and receipts | concurrent caps and replay, ambiguous send, revocation during write, redacted audit, zero real sends |
| MAIL-4 · provider evidence | Approved sandbox wire adapters, scope and lifecycle verification, runbook | both mailbox families, consent and deletion evidence, legal/security review before any activation |

Unit tests cover the gate, cursor/scope binding, safe message projections, cap and send state. Integration tests use restricted-owner PostgreSQL and `withTenant` as another admin, viewer and member to prove raw grants and service denial. Assert origin checks, 404 before auth, no-store responses, redacted traces and no unexpected provider calls. Browser tests use synthetic threads and fake transport. Run lint, typecheck, unit, integration and build per implementation PR and record exclusions. Fresh independent review is required.

## 8. Founder decisions

1. **Consent** · Default to separate read and send permissions, with a read-only first release. Confirm the wording after the DPA review.
2. **Storage** · Default to provider-held drafts and on-demand reads. Confirm the retention periods for Harvest audit and send receipts after legal review.
3. **Scope** · Default to one selected personal mailbox at a time. Confirm whether one person may connect multiple mailboxes in a ministry.
4. **Sending** · Default to immediate human-confirmed sends with a low pilot cap. Choose the cap after sandbox evidence.
5. **Formatting** · Default to plain-text viewing/compose, without attachments. Confirm whether sanitized HTML is required for the first pilot.
