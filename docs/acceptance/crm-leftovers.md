# CRM server leftovers acceptance

## API handoff

- `GET /api/workspaces/:tenantId/crm/diagnostics` is a read-only import support endpoint for verified ministry owners and admins. It returns `{ imports: [...] }` with up to 50 records, newest first. Each row has `id`, `entity` (`person` or `company`), `status` (`draft`, `preview`, `running`, `completed`, `failed`, or `rolled_back`), `createdAt`, `updatedAt`, `completedAt`, and `rolledBackAt`. Timestamps are ISO strings and the last two are nullable. An empty result is `{ imports: [] }`. Responses use `Cache-Control: private, no-store` on success. A missing session receives 401, a malformed ministry id receives 400, and an insufficient role or membership receives 403.
- The support projection contains lifecycle metadata. The tenant and owner/admin checks are enforced in both the service and the SQL function. The function runs with caller privileges, has a fixed search path, and grants execution to `harvest_app`. CSV contents, filenames, row reports, importer identities, and mapping fields are outside this projection.
- For existing assignment notifications, `GET /api/workspaces/:tenantId/crm/notifications` returns the caller's assignment notifications and overdue count. `POST` to the same route with `{ "ids": ["…"] }` or `{ "ids": "all" }` marks the caller's own notifications read. See [CRM-05](crm-05.md).

CRM reports are built in [CRM reports](crm-reports.md). CRM retention and further erasure changes, pending-approval limits and human review, notification preferences and new event types, and sync diagnostics are pending the decisions in the [CRM leftovers plan](../plans/crm-leftovers.md).

## Approval and migration

Migration `0074_crm_leftovers` enforces the documented ten-minute SQL limit. It preserves historical approvals and audit references. A legacy approval issued with a longer lifetime is ineligible for any further transition. Both approval decisions and consumption still serialize on the approval row. SQL checks the current clock after obtaining the lock, so time spent waiting counts toward expiry. The service maps a refused transition due to expiry to 409 with `details.reason = "approval_expired"`. Approval consumption and the CRM action remain atomic.

All five HC-02 gates remain **UNAPPROVED**. Production migrations and deployment remain outside this work. Tests use synthetic data on local PostgreSQL.
