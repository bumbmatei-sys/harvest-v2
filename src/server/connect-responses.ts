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

export const PENDING_PAGE_DEFAULT = 50, PENDING_PAGE_MAX = 200;
const cursorKey = z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?[+-]\d\d(:?\d\d)?$/);
/** limit: integer >= 1 (above the maximum is clamped); cursor: the opaque token a previous page returned. Anything else is a ZodError (400). */
const pendingPageInput = z.object({ limit: z.number().int().min(1).optional(), cursor: z.string().max(200).optional() });
const encodeCursor = (key: string, id: string) => Buffer.from(JSON.stringify([key, id])).toString("base64url");
function decodeCursor(token: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new z.ZodError([{ code: "custom", path: ["cursor"], message: "invalid cursor" }]);
  return z.tuple([cursorKey, uuidInput]).parse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
}

/**
 * Pending-response metadata (HC-DEC2 direction: owner/admin only). The database definer is the only reader: it re-checks the
 * owner/admin role, returns one bounded page (default 50, max 200, ordered by submitted time then id, keyset cursor) of status, timing,
 * link, form version, notice version and the purposes in force (none once expired), and writes one audit row per call with the
 * count of rows returned only. Denied roles get 403 here, before any data is touched.
 */
export async function listPendingResponsePage(db: Database, userId: string, workspace: string, campaign: string, pageInput: { limit?: number; cursor?: string } = {}) {
  const campaignId = uuidInput.parse(campaign), page = pendingPageInput.parse(pageInput);
  const limit = Math.min(page.limit ?? PENDING_PAGE_DEFAULT, PENDING_PAGE_MAX);
  const after = page.cursor !== undefined ? decodeCursor(page.cursor) : null;
  // Non-members and members without the owner/admin role get the same 403, so the answer says nothing about membership.
  return withTenant(db, userId, uuidInput.parse(workspace), "connect:privacy", async (tx, tenantId) => {
    const result = await tx.execute(sql`select * from public.read_pending_response_metadata(${tenantId}::uuid, ${campaignId}::uuid, ${limit}::integer, ${after?.[0] ?? null}::timestamptz, ${after?.[1] ?? null}::uuid)`);
    const rows = result.rows as { response_id: string; link_id: string; form_version_id: string; notice_version_id: string | null; status: string;
      submitted_at: Date | string; expires_at: Date | string | null; active_purposes: string[]; cursor_key: string; has_more: boolean }[];
    const last = rows.at(-1);
    return { items: rows.map((row) => ({
      id: row.response_id, linkId: row.link_id, formVersionId: row.form_version_id, noticeVersionId: row.notice_version_id, status: row.status,
      submittedAt: new Date(row.submitted_at), expiresAt: row.expires_at ? new Date(row.expires_at) : null, activePurposes: row.active_purposes })),
      nextCursor: last?.has_more ? encodeCursor(last.cursor_key, last.response_id) : null };
  }).catch((error: unknown) => { throw error instanceof AccessError && error.status === 403 ? new AccessError(403, message("Errors.workspaceAccessDenied")) : error; });
}

/** First page only (default size). Use listPendingResponsePage when the caller must see every row. */
export async function listPendingResponseSummaries(db: Database, userId: string, workspace: string, campaign: string) {
  return (await listPendingResponsePage(db, userId, workspace, campaign)).items;
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
