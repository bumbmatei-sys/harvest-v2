import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditLogs, campaigns, users } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { CAMPAIGN_PAGE_SIZE, campaignIdempotencyKey, campaignInput, campaignPage } from "../lib/campaigns";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import { workFingerprint } from "./jobs/primitives";

// Idempotency material stays internal, like the outbox's key/fingerprint pair.
const columns = {
  tenantId: campaigns.tenantId, id: campaigns.id, ownerUserId: campaigns.ownerUserId,
  type: campaigns.type, status: campaigns.status, name: campaigns.name,
  description: campaigns.description, mission: campaigns.mission,
  country: campaigns.country, cityRegion: campaigns.cityRegion,
  startDate: campaigns.startDate, endDate: campaigns.endDate, timeZone: campaigns.timeZone,
  structure: campaigns.structure, createdAt: campaigns.createdAt, updatedAt: campaigns.updatedAt,
};

export function createCampaign(db: Database, userId: string, workspace: string, data: unknown, key: unknown) {
  const input = campaignInput.parse(data), idempotencyKey = campaignIdempotencyKey.parse(key);
  const fingerprint = workFingerprint("campaign.create", { ...input, ownerUserId: userId });
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const [inserted] = await tx.insert(campaigns).values({ ...input, tenantId, ownerUserId: userId, idempotencyKey, fingerprint })
      .onConflictDoNothing({ target: [campaigns.tenantId, campaigns.idempotencyKey] }).returning(columns);
    if (inserted) {
      await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "campaign.create", targetId: inserted.id });
      return inserted;
    }
    const [existing] = await tx.select({ ...columns, fingerprint: campaigns.fingerprint }).from(campaigns)
      .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.idempotencyKey, idempotencyKey)));
    if (!existing || existing.fingerprint !== fingerprint) throw new AccessError(409, message("Campaigns.idempotencyConflict"));
    const { fingerprint: _fingerprint, ...row } = existing;
    void _fingerprint;
    return row;
  });
}

export function listCampaigns(db: Database, userId: string, workspace: string, pageInput: unknown = 1) {
  const page = campaignPage.parse(pageInput);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:read", async (tx, tenantId) => {
    const where = and(eq(campaigns.tenantId, tenantId), isNull(campaigns.archivedAt));
    const [{ total }] = await tx.select({ total: count() }).from(campaigns).where(where);
    const rows = await tx.select(columns).from(campaigns).where(where)
      .orderBy(desc(campaigns.createdAt), desc(campaigns.id)).limit(CAMPAIGN_PAGE_SIZE).offset((page - 1) * CAMPAIGN_PAGE_SIZE);
    return { campaigns: rows, total, page, pageSize: CAMPAIGN_PAGE_SIZE };
  });
}

export function getCampaign(db: Database, userId: string, workspace: string, campaign: string) {
  const id = uuidInput.parse(campaign);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:read", async (tx, tenantId) => {
    const [row] = await tx.select({ ...columns, ownerName: users.name }).from(campaigns).innerJoin(users, eq(users.id, campaigns.ownerUserId))
      .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, id), isNull(campaigns.archivedAt)));
    if (!row) throw new AccessError(404, message("Campaigns.notFound"));
    return row;
  });
}
