# Newsletter server

Migration **0073** is based on `main` at `7f750c544d786f088bebbc7a723706b623e3e7f0`, whose journal ends at **0068**. The generated 0073 snapshot points to 0068. Its timestamp follows the reserved Social migrations. The Social PRs join the shared journal only when they land on main. Reconcile the generated snapshot and journal against the then-current head before merging whichever branch lands second.

## Screens API

Routes are under `/api/workspaces/[tenantId]/newsletter`. The campaign delivery HTTP integration is hard-off by default. The owner/admin services and injected test runtime exercise these contracts with synthetic data. The existing Audiences, Subscribers, Lists, Segments and Sign-up forms routes keep their payloads. Access to those resources is now owner/admin only as well.

| Method and path | Contract |
| --- | --- |
| `GET /campaigns`, `GET /senders`, `GET /templates` | UUID keyset using `after` and `limit` (default 50, max 100). Returns `items` and `nextCursor`. Campaign items include summary, version, schedule and status. |
| `POST /campaigns`, `PATCH /campaigns/:id` | `subject`, optional `previewText`, `senderId`, `content` as restricted rich-text JSON and `audience`. Audience is `{kind:"list",listId}`, `{kind:"segment",listId,segmentId}` or `{kind:"view",viewId}`. Edits require `expectedVersion`. Returns `{campaign,revision}`. |
| `GET /campaigns/:id` | Campaign state and current immutable revision. |
| `POST /campaigns/:id/review` | `{version,mode:"now",timeZone}` or `{version,mode:"schedule",scheduledFor,timeZone}`. Pass a future ISO instant with offset and send the IANA zone separately. This is the explicit approval and queueing operation. |
| `POST /campaigns/:id/cancel` | `{version}`. Cancels draft, scheduled or sending campaigns and queued or leased work. Dispatch becomes in flight when the worker commits the final handoff decision. An in-flight or accepted delivery can still produce a receipt or callback. |
| `GET /campaigns/:id/preview`, `POST /campaigns/:id/test-send` | Preview returns `subject`, `previewText`, `html` and `text` with the server footer. The editor should render the HTML in a sandboxed preview. Test send takes `{}` and uses a fixed synthetic identity and recipient with the injected fake provider. |
| `POST /senders`, `POST /senders/:senderId/disable` | Create from `name`, `email`, `replyTo` and `postalAddress`; disabling takes `{}` and cancels undispatched jobs for this identity. A sender starts unverified. Only the restricted worker can record successful synthetic domain verification. |
| `POST /templates`, `PATCH /templates/:templateId` | Save `name` and `content`. Edits require `expectedVersion`. Applying a template copies its content into the next campaign revision. |
| `GET /campaigns/:id/analytics`, `GET /lists/:listId/analytics` | Query parameters `from`, `until` (exclusive local dates, 1–92 days) and `timeZone`. Returns counts, rates, hourly buckets, per-link counts and freshness. |

An owner or admin saves drafts, previews, reviews and cancels. Review compares the current revision and freezes the sender and audience selection for dispatch. Stale lifecycle or version transitions return 409. Inaccessible resources use the same 404 shape. The campaign and template data models allow restricted text blocks and HTTPS links. The renderer escapes stored content and always appends the sender details and unsubscribe link. Link IDs are stable within a revision. Open and click tracking are off. Newsletter replies follow the sender's reply-to address.

## Audience, worker and receipts

The worker uses the existing CRM People filters and shared view definitions to select candidates just before sending. A saved-view version change or loss of the reviewing admin's access cancels the selection. Deleting a CRM view removes its live binding and preserves the revision history. A segment also requires active subscription to its corresponding list. A standalone shared view can include a contact with no list membership and valid newsletter email consent. Stored list opt-outs are treated conservatively for standalone views.

Worker SQL repeats canonical email consent and suppression checks under the contact lock just before returning the transient message envelope. It issues a token for the existing unsubscribe operation using list scope when a list is selected and all-newsletters scope for a standalone view. The signed action supports one-click POST. The footer GET is read-only. A confirmation screen for people clicking through from the footer belongs to the screens work.

Worker grants use `harvest_worker` and no direct table privileges. The worker reads up to ten due campaigns per pass, resolves up to 100 contacts per campaign per pass, and leases up to ten deliveries per invocation. The database claim clamps its input to 20, and the handoff caps attempts at 30 per ministry per minute. A job's UUID stays stable across attempts. Provider calls happen after the handoff transaction. Expired handoffs and unknown outcomes use lookup by that key, with up to three reconciliation attempts. Only a definitive absence or a definitive pre-acceptance retry result permits another attempt, up to three handoffs. An unresolved result remains unconfirmed and can accept later authenticated delivery evidence. The campaign reaches `sent` when dispatch has settled. The sent metric counts provider acceptance per delivery, which can be smaller than the audience.

The callback accepts correctly signed bounded input and acknowledges replay. Durable storage holds IDs, timestamps, fixed outcomes and a bounded revision link ID. Bounces and complaints immediately set sticky subscriber suppression. Unsubscribe updates the matching list or records the existing canonical newsletter withdrawal, according to the campaign scope. CRM erasure detaches the contact from retained delivery evidence. Audit writes contain action, IDs and versions.

## Analytics and activation

The sent count measures provider acceptance inside the date range. Callback counts deduplicate by delivery and outcome, and hourly buckets use the first matching event per outcome inside the range. Rates use the deliveries accepted inside that range. Link counts include deduplicated callback events per revision link. An absent outcome returns `null`; sent can be zero because acceptance is local. Open counts carry `openCountsApproximate: true` for image blocking and privacy proxies. Freshness reports the time measured and the latest included acceptance and callback receipt.

The Harvest provider port runs with fake, injected credentials and synthetic addresses in tests. The Plunk adapter is a fail-closed boundary. Its live request, reconciliation and callback protocol still need a provider contract and sandbox evidence. Integration, sender, provider network and tracking constants are literal `false`, and no worker schedule is installed. All five HC-02 gates remain **UNAPPROVED**. Hosted Neon, the real provider and independent review remain unverified. Production migrations were not applied.

Founder decisions before activation cover the sending domain and reply-to ownership, the provider's signing and definitive idempotency/reconciliation contract, and privacy review of notices, unsubscribe wording, retention and optional tracking.

## Local verification

- Lint, source guards and typecheck passed.
- The unit project passed 1,226 tests across 97 files, including five new newsletter delivery unit tests.
- The full local PostgreSQL integration project passed 907 tests across 107 files, including 17 new newsletter delivery tests. The focused delivery fixture uses a restricted migration owner, separate app and worker logins, and two ministries.
- Drizzle Kit generated the 0073 snapshot. A second generation found no schema changes. The journal timestamps increase, and the snapshot chain test passed.
