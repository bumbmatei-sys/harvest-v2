import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { uuidInput } from "../lib/contact-input";
import { connectPurposeInput, type ConnectPurpose } from "../lib/connect-data";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

// HC-02 rights hooks for restricted pending Connect responses. Owners/admins act on a verified
// request; there is no guest self-service path until HC-07/HC-14. Nothing here returns a
// preferred name, contact method, submission key or CRM link: the database withholds them.
const responseMissing = () => new AccessError(404, message("ConnectData.responseNotFound"));

/**
 * Pending-response metadata (HC-DEC2 direction: owner/admin only). The database definer is the only reader: it re-checks the
 * owner/admin role, returns status, timing, link, form version, notice version and the purposes in force (none once expired),
 * and writes an audit row with the count only. Denied roles get 403 here, before any data is touched.
 */
export async function listPendingResponseSummaries(db: Database, userId: string, workspace: string, campaign: string) {
  const campaignId = uuidInput.parse(campaign);
  // Non-members and members without the owner/admin role get the same 403, so the answer says nothing about membership.
  return withTenant(db, userId, uuidInput.parse(workspace), "connect:privacy", async (tx, tenantId) => {
    const result = await tx.execute(sql`select * from public.read_pending_response_metadata(${tenantId}::uuid, ${campaignId}::uuid)`);
    return (result.rows as { response_id: string; link_id: string; form_version_id: string; notice_version_id: string | null; status: string;
      submitted_at: Date | string; expires_at: Date | string | null; active_purposes: string[] }[]).map((row) => ({
      id: row.response_id, linkId: row.link_id, formVersionId: row.form_version_id, noticeVersionId: row.notice_version_id, status: row.status,
      submittedAt: new Date(row.submitted_at), expiresAt: row.expires_at ? new Date(row.expires_at) : null, activePurposes: row.active_purposes }));
  }).catch((error: unknown) => { throw error instanceof AccessError && error.status === 403 ? new AccessError(403, message("Errors.workspaceAccessDenied")) : error; });
}

const withdrawalOutcomes = z.enum(["withdrawn", "not_granted", "already_withdrawn", "not_pending", "not_found"]);
export function withdrawConnectResponsePurpose(db: Database, userId: string, workspace: string, response: string, purposeInput: unknown) {
  const id = uuidInput.parse(response), purpose = connectPurposeInput.parse(purposeInput);
  return withTenant(db, userId, uuidInput.parse(workspace), "connect:privacy", async (tx, tenantId) => {
    const result = await tx.execute(sql`select public.withdraw_connect_response_purpose(${tenantId}::uuid, ${id}::uuid, ${purpose}) as outcome`);
    const outcome = withdrawalOutcomes.parse(result.rows[0]?.outcome);
    if (outcome === "not_found") throw responseMissing();
    return { outcome };
  });
}

export function eraseConnectResponse(db: Database, userId: string, workspace: string, response: string) {
  const id = uuidInput.parse(response);
  return withTenant(db, userId, uuidInput.parse(workspace), "connect:privacy", async (tx, tenantId) => {
    const result = await tx.execute(sql`select public.erase_connect_response(${tenantId}::uuid, ${id}::uuid) as erased`);
    if (!result.rows[0]?.erased) throw responseMissing();
    return { erased: true };
  });
}

/** Erases this workspace's pending responses whose form-version retention has elapsed. */
export function purgeExpiredConnectResponses(db: Database, userId: string, workspace: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "connect:privacy", async (tx, tenantId) => {
    const result = await tx.execute(sql`select public.purge_expired_connect_responses(${tenantId}::uuid) as purged`);
    return { purged: Number(result.rows[0]?.purged ?? 0) };
  });
}

/** The recheck a future sender or assigner must make immediately before acting on a purpose. */
export function isConnectResponsePurposeActive(db: Database, userId: string, workspace: string, response: string, purpose: ConnectPurpose) {
  const id = uuidInput.parse(response), checked = connectPurposeInput.parse(purpose);
  return withTenant(db, userId, uuidInput.parse(workspace), "connect:privacy", async (tx, tenantId) => {
    const result = await tx.execute(sql`select public.connect_response_purpose_active(${tenantId}::uuid, ${id}::uuid, ${checked}) as active`);
    return result.rows[0]?.active === true;
  });
}
