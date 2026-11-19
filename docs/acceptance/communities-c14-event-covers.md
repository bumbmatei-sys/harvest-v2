# Event cover images

Migration 0065 adds a nullable cover reference to the canonical Events model and a FORCE RLS event file table. A cover belongs to one event in one ministry. It accepts JPEG, PNG and WebP only, up to 10 MB, with a SHA-256 checksum. The object key uses the ministry, event and file IDs.

- Create an upload with `POST /api/workspaces/{tenantId}/events/{eventId}/cover/uploads`. The returned private PUT grant expires after five minutes.
- Confirm with `POST /api/workspaces/{tenantId}/events/{eventId}/cover/uploads/{fileId}/confirm`. Confirmation reuses the byte inspection and scanner ports. An infected image is quarantined. A skipped scan leaves the image uploaded and unavailable. A clean result is required for ready.
- Set or remove the cover with `PUT /api/workspaces/{tenantId}/events/{eventId}/cover` and the event version plus a ready `fileId` or `null`. Replacement and removal retire the prior image and append one delayed `events.cover_cleanup` record to the existing Events outbox in the same transaction. The reserved Events queue holds that record for a future deletion consumer. No worker or object deletion was activated in this slice.
- Fetch with `GET /api/workspaces/{tenantId}/events/{eventId}/cover`. The route uses canonical event visibility, including staff-only draft access. The response has a signed inline URL valid for 60 seconds. Existing signed URLs expire naturally. New requests can sign only the current ready cover.

Shared changes extract community upload inspection for reuse and allow the existing private signer to return an inline image with its verified MIME type. Media is unavailable to callers who cannot see the event. The production Events gate stays off. Local tests use fake storage and scanner verdicts; hosted Neon, real storage, the live scanner and object cleanup remain unverified. All five HC-02 gates remain **UNAPPROVED**.
