# ADR 0003: Transaction-local, server-verified tenancy

Accepted 2026-11-04. Tenant tables use `tenant_id` and forced PostgreSQL RLS. The unprivileged SQL-created app role owns no tables and has no elevated memberships or BYPASSRLS. Policies use `nullif(current_setting('app.tenant_id', true), '')::uuid`, so absent or reset context exposes no tenant records. Server-verified sessions establish user identity; membership lookup derives tenant context and role, with a locked recheck before protected work. A client-supplied workspace is only a hint. Set context using parameterized `set_config(..., true)` inside a transaction. Never session-wide SET.

The own-membership SELECT policy supports workspace discovery only while tenant context is absent; after selection even a user’s own memberships are restricted to the current tenant. A SELECT FOR SHARE also requires update visibility under PostgreSQL RLS, so discovery is initially unlocked; after setting the verified tenant, re-read with a share lock and recheck permissions. This closes membership-revocation races while retaining fail-closed discovery.

Local tests force one physical pooled backend, assert backend PID identity, and verify zero visible tenant records after commit and rollback. Live Neon tests verify pooled reset and deterministic direct-backend reuse too. Custom PostgreSQL settings are application-controlled: RLS protects against omitted filters, while server authorization protects against hostile tenant hints. It does not claim to defend against arbitrary SQL execution by a compromised server.


PR 01b extends the same policy to `contacts`, `contact_identifiers` and `contact_consents`. Every table forces RLS, uses tenant-qualified keys/indexes, and denies all rows without a transaction-local tenant. Composite `(tenant_id, contact_id)` foreign keys prevent cross-tenant child references. Contact writes and append-only consent evidence use separate read/write permissions and atomic audit events. Duplicate normalized identifiers are unique within a tenant only; records are never automatically merged. The pooled-backend commit/rollback isolation checks cover all three tables.

Private CRM and appearance routes remain paths on the shared domain; no tenant subdomains. Future public content/discovery in PRD 9.1 does not expose private contacts, consent, settings or membership.
