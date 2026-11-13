# Pending-response metadata access (HC-DEC2 engineering)

Migration `0045_pending_access`. Database, server and API only; no screens.

**This builds toward the founder's selected direction (13 Nov 2026), Option A: owner/admin only until assigned-counselor access exists (HC-13). It approves nothing.** The HC-02 activation decisions, including HC-DEC2, stay UNAPPROVED (`docs/decisions/hc-02-activation-gates.md`). Real collection, real invitation delivery and deployment stay hard-disabled.

## Design note (written before the code)

What exists today (HC-02, 0026):

- `campaign_responses` and `campaign_response_consents` already have owner/admin-only SELECT policies (FORCE RLS), with column grants that hide name, locale, submission key and CRM link. Pending contact methods have no application grant at all.
- `listPendingResponseSummaries` is the only application reader. It returns status, timing, link, form version and the purposes in force. There was no API route for it, and an owner/admin read left no trace.

The gap is therefore not who may read, but that the read is unaudited and can bypass any single code path (a direct table SELECT by an owner/admin session is possible).

Decision: make one audited, owner/admin-only definer the only way the application role reads pending rows.

1. **DB.** `public.read_pending_response_metadata(tenant, campaign)` (SECURITY DEFINER, `search_path = pg_catalog, pg_temp`, revoked from PUBLIC, executable by `harvest_app`).
   - Requires the tenant context to equal the argument and an authenticated actor with live owner/admin membership; otherwise 42501.
   - Returns only: response id, link id, form version id, notice version id, status, submitted time, expiry time and the purposes in force (none once expired). Nothing about the person or what they said.
   - Writes `audit_logs` action `connect.pending.read` in the same transaction, target = campaign id, metadata = `{count}` only. If the audit insert fails the read fails.
2. **RLS.** The application-role policy on `campaign_responses` now also requires `status <> 'pending'`, so a direct SELECT can no longer see pending rows even for an owner/admin. Associated and erased rows stay readable as before (the CRM source filters join them). The application role loses SELECT on `campaign_response_consents`; its only reader was the service above and the definer now reads it.
3. **API.** `GET /api/workspaces/:tenantId/campaigns/:campaignId/connect/responses` calls the service. Members, viewers, outsiders of the ministry and other tenants all get the same 403; anonymous gets 401. An owner/admin gets 200 with an empty list for a campaign that is unknown or that has no pending responses, so no existence signal beyond what owners already see.
4. **Audit.** Counts only. Denied requests fail before any data is touched and write nothing (a denied attempt would be rolled back with the request transaction).

Not changed: consent, account separation and QR lifecycle logic, the withdraw/erase/purge/recheck definers, the intake and association paths.

## What changed

- `drizzle/0045_pending_access.sql` (+ journal, snapshot): the audited definer, the narrowed `campaign_responses` policy and the revoked SELECT on `campaign_response_consents`. Re-runnable: `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` then `CREATE POLICY`, idempotent `REVOKE`. FORCE RLS is untouched; the definer runs under the existing tenant-scoped migration-owner policies, so it works with a restricted (non-bypass) owner and adds no policy.
- `src/server/connect-responses.ts`: `listPendingResponseSummaries` now calls the definer and maps 403 to one message for non-members and non-owner/admin members. The result gains `noticeVersionId`.
- `GET /api/workspaces/:tenantId/campaigns/:campaignId/connect/responses`: new, owner/admin only.
- `vitest.config.ts`: the integration project gets the `@/` alias so route handlers can be tested there.
- Existing HC-02 tests updated for the behavior change (direct reads of pending rows and of evidence rows are gone).

## Tests

- `hc-dec2-pending-access.test.ts` (10): owner/admin allowed; member, viewer, other-tenant owner, forged tenant setting or argument, empty actor, no context and revoked admin all denied with 42501 at DB level; PUBLIC cannot execute; direct reads show no pending row to any role and evidence and contact methods are unreadable; non-pending rows unchanged; one counts-only audit row per allowed read (no name, address or response id anywhere in the audit ledger); a denied read writes nothing; audit ledger is append-only for the application role; API 200 for owner/admin, identical 403 body for member, viewer, other tenant and unknown campaign, 401 for anonymous, empty list (never 404) for an unknown or empty campaign, 400 for a malformed id.
- `hc-dec2-owner.test.ts` (1, restricted owner, run as a non-superuser): real synthetic intake, then audited read and denial.
- Regression: HC-02, HC-03, HC-05, HC-06B/C, HC-07, retention, Connect landing, audit, RLS suites and the upgrade suites.

## What is NOT done

- No screen: the founder is replacing the UI kit, so no UI consumes the route yet.
- Denied attempts are not audited (a denied request rolls back before any data is touched). A security-event log for denials would be a separate, decided design.
- The audit row records the campaign, the actor and a count; a retention period for audit rows is not decided here.
- The staff rights-request procedure and the verification of owner/admin identity named in the HC-DEC2 gate are not built.
- Assigned-counselor access (HC-13), per-campaign roles and any wider role list are not implemented.

## Activation

HC-DEC2 and the other HC-02 activation decisions remain **UNAPPROVED**. This is engineering toward the selected direction only. Production intake, real invitation delivery and deployment stay hard-disabled.
