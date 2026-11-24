# Social approvals and publishing status: server acceptance

Migration `0099_social_approvals`. Server only, no screens. Hard-off like the rest of the social server: every route is behind `SOCIAL_INTEGRATION_ENABLED = false` (non-production fake gate only), the fake provider is the only provider that runs, no real outbound call, no real post. The five HC-02 gates stay UNAPPROVED. This record is written before the code; the "Status" and "Evidence" columns are filled at the end.

Sources read: `docs/prd/public-mode-social-discover-navigation.md` section 5.1 (Planner queue, publishing rules) and 2/5.x, `docs/superpowers/specs/2026-11-17-social-composer-planner-inbox-autodm-design.md` (partial success per account, retry with the original key, ambiguous stays unknown), `docs/prd/professional-v1-launch-scope.md`, `docs/acceptance/social-publish.md`, the code of #157 (connections, drafts, posts, publisher), #159, #161, #162. **No document defines an approval workflow**: who may submit, approve or reject, and the notification surface, are not specified. Each such choice below is a proposed default, implemented as a narrow server rule, and recorded as a deferred founder decision (see the last section). Nothing was guessed silently.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Hard-off, fake provider, no outbound, neutral 404 for non-staff | | |
| 2 | Per-ministry setting: approval off (default) or required; owner-only to change; versioned; audited | | |
| 3 | Submit a draft for approval: owner/admin; one pending request per draft; a new request supersedes older ones | | |
| 4 | Approve / reject: owner/admin; rejection carries a short reason; decided once; self-approval rule per ministry (`never`, `owner_only` default, `always`) enforced in code and by a database trigger | | |
| 5 | Versioned approval: bound to a fingerprint of the exact draft document; an edit after approval invalidates it (superseded on save, and never valid on a fingerprint mismatch) | | |
| 6 | Scheduled posts cannot publish without a valid approval when required: gate inside `social_publish_claim` and a database trigger on the `scheduled -> publishing` move; draft-less posts need an approval of their own content | | |
| 7 | Publish now needs a valid approval when required (409 `APPROVAL_REQUIRED`); scheduling is allowed and waits | | |
| 8 | Withdraw a pending request (submitter or owner/admin) | | |
| 9 | Audit of settings change, request, approve, reject, withdraw, supersede (ids, versions, outcome only) | | |
| 10 | Notifications to approvers (request) and submitter (decision), in-app only, no email, no push, no outbound | | |
| 11 | Publishing status per account per post: queued, awaiting approval, publishing, published with platform URL, failed with reason, partial, unknown, cancelled | | |
| 12 | Platform URL stored on the delivery (provider-neutral field, set by the worker after a confirmed publish) | | |
| 13 | Draft-level aggregate status (queued, publishing, published, partial, failed, unknown, awaiting approval, cancelled) | | |
| 14 | Retry eligibility exposed per account (existing `retry` action rules: same idempotency key, not accepted posts, 23-hour window), blocked while approval is invalid; proven no double post | | |
| 15 | Queue read model: Drafts / Scheduled / Sent with per-destination status and approval state, bounded and paginated | | |
| 16 | Isolation: FORCE RLS on the new tables, definer functions with fixed search_path and REVOKE FROM PUBLIC, `TO PUBLIC` definer policies | | |
| 17 | Members submit or draft for approval | | |
| 18 | Approval inside the CRM/Communities notification surfaces | | |
| 19 | Per-platform or per-account approval rules, multi-step approval, expiry of an approval | | |
| 20 | Contacts: nothing references contacts | | |

## Proposed defaults awaiting founder decision (deferred, not guessed)
1. Role matrix: submit and approve/reject are owner/admin because publishing is owner/admin today; changing the setting is owner only. Members and viewers get a neutral 404. Letting members draft and submit needs a member-drafting permission for Publish that does not exist.
2. Self-approval: default `owner_only` (an admin cannot approve their own request, an owner can so a one-person ministry is never stuck). Alternatives are configurable (`never`, `always`).
3. Timing is not part of the approval: rescheduling does not invalidate it; content or destination changes do.
4. Notifications: the existing in-app surfaces are bound to CRM tasks and community objects and cannot carry an approval without schema surgery, so approvers get rows in a small new in-app table read only by the recipient. Unifying into one notification centre is a later decision.
5. Approval expiry and multi-step approval are not built.
