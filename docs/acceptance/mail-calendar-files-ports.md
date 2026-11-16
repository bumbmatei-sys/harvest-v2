# Mail, calendar and external files ports

Server foundation only. No UI, route, OAuth clients, real provider contact or production activation. All five HC-02 decisions remain **UNAPPROVED**, production collection/delivery hard-disabled and production migrations 0031+ unapplied.

Separate Harvest-owned `MailProvider`, `CalendarProvider`, `FilesProvider` contracts keep `SocialProvider` unchanged. `files-provider` does not replace the R2 upload service. Deterministic in-memory fakes model mail thread search/read, send/reply/forward, drafts, labels, scheduled-send acceptance and per-mailbox daily caps; event CRUD, RSVP, free-time and synthetic meeting links; picked-file list/search, upload, defensive download and share references. Fake scheduled sends reserve quota but never deliver. No real provider wire shapes are claimed. A future enabled adapter must pass the exported contract installers in `tests/unit/office-provider-contract.test.ts`, plus its wire-level and sandbox suite. Disabled adapters have a separate rejection contract: every method throws typed `DISABLED`, with zero transport.

Registries return fakes only for explicit test mode and disabled adapters otherwise; kill switches remain literal false, not environment toggles. No network or SDK exists in this layer. PR #83 credential sealing and constant-time raw-body HMAC verification remain the shared primitives; no office webhook endpoint is registered or implemented. The existing shared-secret tenancy gate must be resolved before such an endpoint is added. No new webhook payload/content storage.

## Personal connections (migration 0053)

0051 cannot represent a kind: its platform CHECK only permits social networks, and its read policy shares accounts with every ministry admin. Migration 0053 adds one small separate `office_connections` table, rather than broadening shared social access. Kind is mail/calendar/files; owner is the connecting user. FORCE RLS requires both tenant context and the owner's current owner/admin membership; other admins, members/viewers and other ministries cannot read or insert for that owner. No application UPDATE/DELETE or definer grants exist, so identity cannot be transferred. Connections are created only from provider-listed account refs, and role membership is rechecked after provider discovery. Metadata returned excludes envelopes. Credentials reuse the authenticated sealed envelope bound to tenant + connection; no plaintext tokens are stored. This is a proposed personal-scoping implementation, not permission to read personal mail.

## Open gates / not built

Zernio DPA and subprocessors, sandbox capability validation, webhook-secret model, scopes and picker integration, consent for reading personal mail, revocation/deletion and envelope rotation, retention and purge monitoring all remain open. Zernio stores the first message of a thread: the DPA and retention review must explicitly cover it; Harvest makes no zero-retention or legal claim. Google Drive must expose only explicitly picked files; the fake models this, but a real picker flow has not been verified. No Google/Microsoft OAuth clients, no personal content cache, no consent bypass, no sending worker, no UI strings/navigation/message keys. Those UI integrations belong to the UI workstream.

## Verification

Contract and permission tests are local synthetic checks, including restricted-owner `testDatabase({migrationOwner:true})`. Final command results and counts are recorded in the draft PR. Not verified: real provider behavior, real credentials, sandbox, legal adequacy, browser/UI or production operations. Remote CI is separate evidence; a Neon migration run from trusted main is needed for migration 0053 before merge.
