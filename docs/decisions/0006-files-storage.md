# ADR 0006: S3-compatible file intents and explicit processing states

Status: accepted for PR 02; production provider remains open for Matei.

PRD v2.5 §6 requires signed file upload/download, processing and malware checks
for exposed uploads. Files must preserve the existing workspace membership and
PostgreSQL RLS boundary while contacts/shell and auth evolve in separate PRs.

Use a small `StorageAdapter` with an AWS SDK v3 S3 implementation configured only
by `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and
`S3_REGION`. No infrastructure is provisioned. R2, S3 and MinIO remain candidate
providers; provider staging verification is required after selection.

Create a `files` intent row with workspace, uploader, opaque workspace-prefixed
key, original name, allowed MIME, bounded size, SHA-256 checksum, visibility and
processing status. The server verifies membership before signing. The table
forces RLS with tenant `USING`/`WITH CHECK`; FK/key constraints reinforce scope.
Viewer roles read; uploader-capable members write; only the uploader confirms.

Use five-minute, write-once presigned PUTs bound to exact size and MIME. Confirm
HEAD metadata and independently hash actual object bytes before committing
`uploaded`. The `FileScanner` seam then transitions to `ready` or `quarantined`.
Row locks and separate receipt/processing transactions make retry safe. A real
queue is deferred; the persisted uploaded state is its future job boundary.

The default no-op returns `skipped`. Private files may become ready; public files
require an explicit clean scan and otherwise quarantine. Malware scanning is
deliberately incomplete, documented and fail-closed for public exposure.

Keep the whole bucket private. Private downloads require membership and expire
after 60 seconds. Public URLs are application routes issued only for ready public
files, with a narrow SELECT-only RLS context for anonymous delivery. Delivery
redirects to a short-lived signed attachment; it does not publish a bucket prefix.
This preserves private object isolation on providers without object ACL parity.

Tradeoffs: confirmation reads bytes once (maximum 10 MiB), bounded synchronous
processing holds a row lock, lists show the latest 100 files, public uploads stay
quarantined until a real scanner is wired, and cleanup/quotas/durable workers are
follow-up work. The local SigV4-checking S3 subset provides repeatable integration
and browser tests, but cannot prove full R2/S3/MinIO compatibility. No live cloud
or production database tests belong in this PR.

See [storage setup](../setup/storage.md) for the contract, security boundaries and
local verification. The migration is additive and touches only `files`; if other
PRs allocate the same Drizzle migration ordinal, regenerate migration metadata
against the merged schema before release. Do not edit existing applied migrations.
