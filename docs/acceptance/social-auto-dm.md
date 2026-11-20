# Auto-DM server acceptance

Migration `0071_social_auto_dm` follows the Inbox migration `0070`. This PR stacks on Inbox #159 and Publish #157. It implements S05 with a fake-only worker. Integration, live network and sender switches remain hard-off. All five HC-02 gates remain **UNAPPROVED**.

## Trigger evidence

The account capability response has a state for every trigger. Conditional support requires a verified account, current provider permissions and an exact live record for the signed event. The provider guides describe platform capabilities. A restricted account or a provider response without the required evidence is ineligible. [Comment automations](https://docs.zernio.com/comment-automations/create-comment-automation) · [Instagram](https://docs.zernio.com/platforms/instagram#inbox) · [Facebook](https://docs.zernio.com/platforms/facebook#inbox) · [List messages](https://docs.zernio.com/messages/get-inbox-conversation-messages)

| Trigger | Instagram | Facebook | Harvest evidence |
| --- | --- | --- | --- |
| Post comment keyword | Conditional | Conditional | Signed post and comment IDs, exact live comment, private-reply eligibility |
| DM keyword | Conditional | Conditional | Signed conversation and message IDs, exact inbound live message |
| Story reply | Conditional | Unavailable | Instagram live message story-reply marker |
| Story mention | Conditional | Unavailable | Instagram live message story-mention marker |
| Welcome on first DM | Conditional | Conditional | One observable inbound message and an exhausted live history page. The provider can omit history from before connection. |
| Ice-breaker entry | Conditional | Unavailable | Exact configured entry key must be recoverable from live message metadata |
| Persistent-menu entry | Unavailable | Conditional | Exact configured entry key must be recoverable from live message metadata |
| Live comment | Unavailable | Unavailable | The provider documents native Instagram automation for live comments. Harvest has no verified live comment lookup path for this job. |

Ice-breaker and menu rules attach to entries already configured on the connected account. The owned provider setting APIs describe those platform affordances. Inbound webhook fields alone carry no authority to choose a postback response. [Instagram ice breakers](https://docs.zernio.com/account-settings/set-instagram-ice-breakers) · [Facebook menu](https://docs.zernio.com/account-settings/set-messenger-menu)

## Screen contract

Routes live under `/api/workspaces/[tenantId]/social/auto-dm` and return private, no-store responses. The action APIs require owner or admin and use 404 for out-of-scope accounts and rules. Response bodies use Harvest capability states and outcome codes.

| Method | Result |
| --- | --- |
| `GET /` | Rules, connection IDs, account status and trigger availability |
| `POST /` | Create a disabled rule with `connectionId` and `rule` |
| `GET /:ruleId` | Rule details, trigger count, outcome counts and up to 50 recent activity rows. Use `before` for an older timestamp. |
| `PATCH /:ruleId` | `edit`, `review`, `enable` or `disable` with the current `version`. Provide the token from review to enable that version. Edits disable the previous revision. |
| `POST /preview` | Preview matching and template rendering with a synthetic input and fixed example name. Set `testSend: true` to send the matched primary text and quick replies to a disposable in-process fake. |

A comment rule supports any post, a provider post reference, or a Harvest delivery `postId`. For provider-published posts the signed internal post ID binds the rule to the delivery while the worker reads and replies using the native post ID. The composer can create the rule while the delivery is pending. Review and enable become available once that delivery has a published provider reference. Link ownership and connection are checked in the service.

Matching uses Unicode normalization, case rules, contains, whole-word, exact and any-keyword matching. Exclusions and stop patterns take precedence. A missing live body can satisfy a trigger with no text criteria. Templates support `{{ firstName }}`. Media requires a scanned, non-retired upload and current provider eligibility. Optional public replies run after a confirmed private reply. Optional follow-up steps require a consent-backed purpose, use the original conversation, and recheck the standard window. Hand-off assigns the DM or comment thread to an owner or admin in Harvest. First private replies to comments accept text and quick replies. Media attachments require a DM conversation and current account eligibility. Working hours reuse the Inbox timezone and schedule. The rule can skip or use its existing away template outside hours.

## Dispatch and evidence

An authenticated, processed webhook enqueues matching rule versions using the database event ID. The worker reads the exact event item using the account credential. Stable job identity deduplicates replay and a keyed, account-scoped recipient reference reserves daily limits and cooldowns. Active jobs can be cancelled by rule revision, disable, account disconnect or withdrawal on a linked contact. Final dispatch rechecks membership, connection and health, rule version, provider window and eligibility, hours revision, limits and consent under locks. The provider call follows that transaction. A withdrawal can stop an undispatched request. Remote acceptance is irreversible.

The worker uses the separate reply sender port and calls only the injected fake. Preview test mode uses an internally generated synthetic account, recipient, credential and delivery ID. It returns a fake receipt and creates no durable job. The worker tests use injected fake accounts and credentials. The standard DM window is 24 hours. The separately documented private comment window is up to seven days. The worker refuses the extended human-agent window. A service template requires explicit attestation by the rule author. Consent-backed jobs require a manually linked existing contact and a current purpose grant on social, subject to outstanding withdrawals on any channel. A link on a public comment thread does not establish a match to each commenter, so promotional comment-to-DM is ineligible. Inbound activity creates neither a contact nor a grant.

Job rows and logs carry identifiers, keyed recipient references, versions, times, and fixed outcomes. The authored template is rule configuration. Inbound text, rendered names, outbound responses and raw webhook bodies stay out of storage. Rate-limited attempts reuse their job identity. Ambiguous delivery can be confirmed by the fake using that identity. In the absence of positive evidence the delivery stays unknown and is never retried blindly.

Hosted Neon, the real provider, account-specific scope behavior and independent sender review are pending. Before activation the founder needs to confirm the service-template review and consent policy. The standard-window limit is already specified.

## Verification

Lint and typecheck passed. The full unit project passed 1,311 tests in 101 files. The full integration project passed 926 tests in 110 files against local PostgreSQL. Eleven focused Auto-DM integration tests cover rule review, current consent and withdrawal, comment-to-DM ordering, quotas, hand-off, synthetic preview, and ambiguous delivery reconciliation. The full Auto-DM integration rerun used a 60-second test and hook timeout after a CRM import test timed out at 30 seconds while suites overlapped. Drizzle generated the 0071 snapshot and a second generation reported no schema changes.
