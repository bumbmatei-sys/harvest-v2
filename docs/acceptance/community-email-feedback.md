# Community email feedback

Working migration 0141 adds ministry-scoped address suppression, worker functions and a receipt table. The newsletter's signed notification verifier is shared. The newsletter still accepts the same events and keeps its own suppression policy.

- The callback verifies signature version 2, the exact configured community topic, a preloaded regional certificate, and the existing signed timestamp window. The verifier performs no network requests. Invalid or unknown notifications receive the same empty response as accepted notifications.
- The worker correlates the signed delivery tag with the exact address registered before provider submission. Receipts store the event ID, delivery ID, and fixed outcome only. A retry with the same event ID or delivery and outcome is idempotent. The recipient is represented by a ministry-scoped keyed digest and a display mask such as `***@example.invalid`.
- A permanent bounce or complaint blocks immediately. Three verified transient bounces on distinct deliveries block until an owner or admin removes the soft-bounce suppression. Removing it resets the counter, while receipt deduplication remains intact. Complaint takes precedence over other outcomes. Hard bounces and complaints cannot be removed by ministry staff.
- The send worker checks after claiming a job and before calling the sender. A blocked job is skipped with `address_suppressed`. Feedback received after a submission has already begun applies to subsequent submissions.
- The owner/admin API at `/api/workspaces/:tenantId/communities/email-suppressions` provides counts and pages of 50 masked records. `DELETE ?id=…` removes an eligible soft-bounce record. The worker has function execution grants and receives a fresh database grant scoped to one transaction. The private tables have no direct worker or application grants.

The callback route and live sender are hard-off. Local tests use signed synthetic envelopes and a fake sender. Live activation requires a dedicated stable digest key with a rotation procedure, a configured sender for the community notification topic, and an agreed receipt retention schedule. No HC-02 activation is requested.
