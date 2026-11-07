import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { campaignResponseConsents, campaignResponses } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { connectPurposeInput, type ConnectPurpose } from "../lib/connect-data";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

// HC-02 rights hooks for restricted pending Connect responses. Owners/admins act on a verified
// request; there is no guest self-service path until HC-07/HC-14. Nothing here returns a
// preferred name, contact method, submission key or CRM link: the database withholds them.
const responseMissing = () => new AccessError(404, message("ConnectData.responseNotFound"));

/** Metadata only: status, timing and the purposes currently in force for each response. */
export function listPendingResponseSummaries(db: Database, userId: string, workspace: string, campaign: string) {
  const campaignId = uuidInput.parse(campaign);
  return withTenant(db, userId, uuidInput.parse(workspace), "connect:privacy", async (tx, tenantId) => {
    const rows = await tx.select({ id: campaignResponses.id, linkId: campaignResponses.linkId, formVersionId: campaignResponses.formVersionId,
      status: campaignResponses.status, submittedAt: campaignResponses.submittedAt, expiresAt: campaignResponses.expiresAt })
      .from(campaignResponses)
      .where(and(eq(campaignResponses.tenantId, tenantId), eq(campaignResponses.campaignId, campaignId), eq(campaignResponses.status, "pending")))
      .orderBy(asc(campaignResponses.submittedAt), asc(campaignResponses.id));
    const evidence = rows.length ? await tx.select({ responseId: campaignResponseConsents.responseId, purpose: campaignResponseConsents.purpose, status: campaignResponseConsents.status })
      .from(campaignResponseConsents).where(and(eq(campaignResponseConsents.tenantId, tenantId), inArray(campaignResponseConsents.responseId, rows.map((row) => row.id)), isNull(campaignResponseConsents.redactedAt))) : [];
    return rows.map((row) => {
      const mine = evidence.filter((event) => event.responseId === row.id);
      const withdrawn = new Set(mine.filter((event) => event.status === "withdrawn").map((event) => event.purpose));
      const activePurposes = mine.filter((event) => event.status === "granted" && !withdrawn.has(event.purpose)).map((event) => event.purpose).sort();
      return { ...row, activePurposes };
    });
  });
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
