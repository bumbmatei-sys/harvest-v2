# Files storage setup

PR 02 implements PRD v2.5 §6 Files. **Cloudflare R2 is the selected provider.**
The 2026-11-05 exit gate subsequently verified the private `harvest-v2-staging`
bucket on the isolated staging project; that historical pass does not establish
production readiness. See the [AC8/public-release checklist](../acceptance/public-release-ac8.md)
and [staging credential policy draft](r2-staging-credential-scope.md).
The `StorageAdapter` interface has an AWS SDK v3 implementation for S3-compatible
services. This implementation provisions no bucket or persistent cloud resource
and does not change any deployed environment.

## Configuration

Set these server-only variables in your environment or ignored `.env.local`:

| Variable | Purpose |
| --- | --- |
| `S3_ENDPOINT` | HTTPS S3 API endpoint, including protocol. HTTP is accepted only on loopback for local tests. |
| `S3_BUCKET` | Name of an existing bucket. |
| `S3_ACCESS_KEY_ID` | Scoped server access key. Never expose to the browser. |
| `S3_SECRET_ACCESS_KEY` | Server secret; do not commit or log. |
| `S3_REGION` | `auto` for Cloudflare R2. |
| `FILES_REQUIRE_SCAN_PRIVATE` | Default `false`: private files may become ready after type/integrity checks without a clean malware verdict. Set `true` to require a clean scan for private files too. Unrecognized values fail closed. |

Examples of endpoint shape: AWS `https://s3.<region>.amazonaws.com`, R2
`https://<account-id>.r2.cloudflarestorage.com`, local MinIO
`http://127.0.0.1:9000`. The SDK uses path-style addressing and SigV4. Nothing in
this feature creates buckets. No storage configuration is needed to view the
workspace list or an empty Files screen; uploading/downloading requires it.

Keep the bucket **private**, including files intended for eventual public sharing.
Do not enable anonymous object reads or attach a public CDN to the workspace
prefix. Grant the application `PutObject` and `GetObject` for
`workspaces/*/files/*`; listing, deleting, ACL changes and bucket administration
are not needed. Provider credentials capable of overwriting/deleting objects
must be restricted to trusted server operators.

For browser uploads, an existing bucket's CORS configuration must allow the exact
application origin, `PUT`, and request headers `Content-Type` and `If-None-Match`.
Allow `GET`/`HEAD` if using browser fetches for downloads; downloads currently use
navigation. Expose `ETag` if needed by tooling. HTTPS must be used in production.
Do not allow wildcard authenticated application origins.

The provider must enforce signed `Content-Length`, `Content-Type` and
`If-None-Match: *` on PUT. Conditional writes prevent replay from replacing an
already verified object. Verify this in provider staging before rollout. See
[AWS PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)
and [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

## API and authorization

Open **Workspaces → Files** (`/workspaces/<tenantId>/files`). There are no shell,
contacts or auth changes beyond one Files link on the existing workspace card.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/workspaces/:tenantId/files` | Latest 100 files, with server-verified membership and RLS. |
| `POST /api/workspaces/:tenantId/files` | Create upload intent and 5-minute presigned PUT. Input: `name`, `mime`, `size`, lowercase hex SHA-256 `checksum`, optional `visibility` (defaults to `private`). |
| `POST /api/workspaces/:tenantId/files/:fileId/confirm` | Uploader verifies stored bytes and runs the scan hook. Safe to retry. |
| `GET /api/workspaces/:tenantId/files/:fileId/download` | Members get a 60-second presigned download for a ready private file; a ready public file gets its public application path. |
| `GET /api/files/public/:tenantId/:fileId` | Anonymous delivery only for a ready public file. Redirects to a 60-second signed attachment download. Every other state returns 404. |

Workspace IDs in paths are hints, never proof of access. Every private operation
derives the user from Better Auth on the server and verifies membership with
`withTenant`. Owner/admin/member roles can upload; viewers can list/download.
Only the uploader can confirm. Private means private to the workspace, not
private to the uploader. Mutations also check the application Origin. Responses
containing metadata or signed URLs are marked `private, no-store`.

The server creates keys as `workspaces/<verified-tenant-id>/files/<server-file-id>`.
Clients cannot provide keys, owners or status. The table has forced RLS, explicit
`USING` and `WITH CHECK`, a tenant-qualified owner FK and key-scope constraints.
Anonymous delivery sets transaction-local public file ID and tenant hints instead
of a tenant/user context. Its SELECT-only RLS exception reveals only that one
ready public row and cannot authorize writes. Context resets on pooled connection
commit/rollback. Signed URLs are short-lived bearer capabilities; do not log them.

Files must be 1 byte–10 MiB. Allowed MIME types: JPEG, PNG, WebP, PDF and plain text.
HTML, SVG, executable and other types are rejected. Filenames cannot contain
paths/control characters, including all Unicode bidi controls, and do not influence
keys. The extension must match the declared MIME: `.jpg`/`.jpeg`, `.png`, `.webp`,
`.pdf` or `.txt` (case-insensitive). Metadata with mismatched extensions is rejected
before signing. The browser hashes the file; confirmation verifies HEAD size and
MIME, then streams and hashes the actual bytes with a size bound. It detects JPEG
(`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), WebP (`RIFF....WEBP`), PDF (`%PDF-`),
or valid UTF-8 text without NUL. Detected type, declared MIME, HEAD MIME and filename
extension must all agree; any mismatch quarantines the file. Signature validation
is not full format parsing or a malware verdict. Downloads use attachment disposition and `application/octet-stream`.

## Processing and malware checks

```text
pending → uploaded → ready
    └──────────────→ quarantined
               uploaded → quarantined
```

`pending`: upload intent. Missing/incomplete objects return 409 and can be
confirmed after PUT succeeds. A size, detected/declared MIME, extension or checksum mismatch quarantines the
file. `uploaded`: bytes verified and receipt committed. R2 inspection runs outside a database transaction and holds no row lock. A
conditional pending-state update commits the receipt. The scan hook runs in a
separate transaction, so a scanner failure leaves this state available for retry.
Concurrent receipt updates cannot overwrite a terminal state. Scan transitions
serialize on the row and do not reprocess ready or quarantined files.

**The default scanner is a no-op, not malware protection.** Its `skipped` verdict
makes private files ready only when `FILES_REQUIRE_SCAN_PRIVATE=false` (the
default); `true` quarantines them until a real scanner is wired. Public uploads
always quarantine on `skipped`, regardless of this flag. Exposed uploads require
an explicit `clean` verdict; `infected` always quarantines. No URL is issued for
pending/uploaded/quarantined files. The current UI explains public quarantine.

The [beta/launch scanner spike](../research/malware-scanner-spike.md) compares
providers and documents the required async job/quarantine integration. It is a
proposal, not scanner wiring or a change to the development deferral.

Before enabling public uploads, implement `FileScanner`, wire a real malware
service into confirmation, and add provider-specific integration tests. Move
processing to a durable worker/queue for long scans using the committed `uploaded`
row as the job boundary. Do not return `clean` merely to enable sharing. There is
no production environment bypass. Test-only injected scanner verdicts exercise
public delivery and infected-file rejection without claiming a real scan.

Deferred: durable job scheduling/retries, scanner operations and quarantine
release tooling, upload rate/workspace quotas, object deletion, abandoned-intent
and orphan cleanup, and retention/lifecycle policy. Expired grants
leave pending rows; a failed browser PUT can be retried by starting a new upload.
Existing signed download URLs remain usable for at most 60 seconds if membership
or file state changes after issuance. No durable malware protection is claimed
for private files in this foundation.

## Local verification (no cloud dependencies)

```sh
npm ci --cache /tmp/harvest-npm-cache
npm run lint
npm run typecheck
npm test
npm run test:rls
npx playwright install chromium
npm run test:e2e
```

`test:rls` is the existing integration project and includes both integration and
RLS checks. It starts an ephemeral local PostgreSQL with the non-owner
`harvest_app` role. The new integration tests and Playwright start a loopback-only,
in-memory S3 mock with throwaway test credentials and SigV4 verification.
The real S3 adapter runs against this HTTP server; PUT/HEAD/GET, signed header
tampering, altered size, replay prevention and byte checksums are tested. This is
an S3 subset, not a replacement for staging compatibility tests on Cloudflare R2. No MinIO installation or real bucket is required.

Playwright overrides all S3 and database credentials with local fixtures and uses
the existing local Resend mock: **no outbound email**. It verifies progress,
persistence after reload, actual downloaded bytes, quarantine, invalid input,
cross-workspace API/page denial, accessibility and mobile overflow. Screenshots
are saved in `docs/screenshots/pr02/`.

In read-only home environments, set `PLAYWRIGHT_BROWSERS_PATH=/tmp/harvest-playwright`
for both installation and tests. Migrations are applied twice to fresh local
databases, and the upgrade test first migrates through main's
`0003_otp-issuance-limits`, preserves an OTP fixture, then applies `0004_files`.
Drizzle generated the snapshot from #3's `3eb73893` parent; the hand-written
files grants and forced RLS policies are appended to the generated SQL.

The GitHub Neon CI migrations job now runs for this PR using its existing,
short-lived CI branch and cleanup flow. No branch-name exemption remains.
Local testing creates no hosted resources and sends no outbound email. Do not
provision the R2 bucket or migrate dev/staging as part of local verification.
Read-only Neon table inspection on 2026-11-04 confirmed no files table in dev
or staging, so neither has the superseded `0003_files` schema. No live branch
was changed.
