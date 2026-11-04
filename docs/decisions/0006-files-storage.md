# ADR 0006: S3-compatible file intents and explicit processing states

Status: accepted for PR 02. Provider: Cloudflare R2, with a separate v2 bucket
that has not yet been created (founder decision in the companion PRD top note).

PRD v2.5 §6 requires signed file upload/download, processing and malware checks
for exposed uploads. Files must preserve the existing workspace membership and
PostgreSQL RLS boundary while contacts/shell and auth evolve in separate PRs.

Use a small `StorageAdapter` with an AWS SDK v3 S3 implementation configured only
by `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and
`S3_REGION` (`auto` for R2). No infrastructure is provisioned. R2 compatibility
verification is required before rollout.

Create a `files` intent row with workspace, uploader, opaque workspace-prefixed
key, original name, allowed MIME, bounded size, SHA-256 checksum, visibility and
processing status. The server verifies membership before signing. The table
forces RLS with tenant `USING`/`WITH CHECK`; FK/key constraints reinforce scope.
Viewer roles read; uploader-capable members write; only the uploader confirms.

Use five-minute, write-once presigned PUTs bound to exact size and MIME. Confirm
HEAD metadata, detect the byte signature/UTF-8 text and enforce agreement with
the declared MIME and filename extension, and hash actual bytes before committing
`uploaded`. The `FileScanner` seam then transitions to `ready` or `quarantined`.
R2 inspection runs without a database transaction or row lock. A conditional
pending-state receipt update and a separate locked processing transaction make
retry safe. A real queue is deferred; the persisted uploaded state is its future job boundary.

The default no-op returns `skipped`. Private files may become ready after
type/integrity checks by default.
`FILES_REQUIRE_SCAN_PRIVATE=true` requires a clean scan for private files too.
Public files always require an explicit clean scan and otherwise quarantine.
Malware scanning is deliberately incomplete, documented and fail-closed for
public exposure.

Keep the whole bucket private. Private downloads require membership and expire
after 60 seconds. Public URLs are application routes issued only for ready public
files, with a narrow SELECT-only RLS context for anonymous delivery. Delivery
redirects to a short-lived signed attachment; it does not publish a bucket prefix.
This preserves private object isolation on providers without object ACL parity.

Tradeoffs: confirmation reads bytes once (maximum 10 MiB), bounded synchronous
scan processing holds a row lock (object reads do not), lists show the latest
100 files, public uploads stay quarantined until a real scanner is wired, and
cleanup/quotas/durable workers are
follow-up work. The local SigV4-checking S3 subset provides repeatable integration
and browser tests, but cannot prove full R2 compatibility. Local tests use no
cloud resources; the existing Neon CI migration job uses and removes an isolated
CI branch.

See [storage setup](../setup/storage.md) for the contract, security boundaries and
local verification. The migration is additive and touches only `files`; if other
PRs allocate the same Drizzle migration ordinal, regenerate migration metadata
against the merged schema before release. Do not edit existing applied migrations.
