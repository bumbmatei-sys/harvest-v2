# Jobs and webhook primitives (PR 04)

Phase 1 provides PostgreSQL jobs, a transactional outbox, a synthetic signed webhook receiver, and an explicit operator drain/replay path. It adds no automation UI, social adapter, payments, email sending, cloud queue, or cloud scheduler.

Implementation checkpoints and validation are tracked in the draft PR. This branch starts at `origin/main` commit `304b0b5`. The Neon CI provisioning job is excluded for this branch; database validation uses local PostgreSQL and the existing non-owner `harvest_app` RLS role.

## Design

- Enqueue domain events using the caller's existing database transaction. Outbox delivery and job creation commit together.
- Unique tenant-scoped idempotency keys survive retry and dead-letter replay. Reusing a key for different work is an error.
- Workers claim due jobs using `FOR UPDATE SKIP LOCKED`; locks have a bounded lease and a unique claim token. Finishing and retrying require the active token.
- Included handlers perform database-only effects in the same transaction as completion. Future outbound handlers must pass the stable job idempotency key to the remote provider; database transactions alone cannot guarantee exactly-once remote effects.
- Synthetic webhook connections are configured server-side. Verify timestamped HMAC against the exact raw bytes before any write. Never derive tenant identity from a request workspace header.
- Keep verified raw events immutable. Dedupe provider event IDs and reject conflicting reuse. Apply only increasing resource sequence numbers so delayed events cannot regress synthetic state.
- Job inspection and replay require verified workspace owner/admin membership. Tenant selection is transaction-local and RLS applies to all new tenant tables.
