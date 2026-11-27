import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { crmRightsRequests } from "../db/schema";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

const instant = z.iso.datetime({ offset: true }).transform(value => new Date(value));
const createInput = z.object({ kind: z.enum(["access", "erasure", "correction"]) }).strict();
const updateInput = z.object({
  id: z.uuid(), version: z.number().int().min(1).max(2147483646),
  verification: z.enum(["pending", "verified", "failed"]),
  deadline: instant,
  outcome: z.enum(["fulfilled", "refused", "withdrawn"]).nullable(),
}).strict().refine(input => input.outcome !== "fulfilled" || input.verification === "verified");

export function listRightsRequests(db: Database, user: string, workspace: string, page: string | null) {
  const offset = (z.coerce.number().int().min(1).max(10_000).parse(page ?? 1) - 1) * 50;
  return withTenant(db, user, z.uuid().parse(workspace), "connect:privacy", async (tx, tenant) => {
    const rows = await tx.select().from(crmRightsRequests).where(eq(crmRightsRequests.tenantId, tenant))
      .orderBy(desc(crmRightsRequests.receivedAt), desc(crmRightsRequests.id)).limit(51).offset(offset);
    return { requests: rows.slice(0, 50), hasMore: rows.length > 50 };
  });
}

export function createRightsRequest(db: Database, user: string, workspace: string, raw: unknown) {
  const { kind } = createInput.parse(raw);
  return withTenant(db, user, z.uuid().parse(workspace), "connect:privacy", async (tx, tenant) => {
    const [row] = await tx.insert(crmRightsRequests).values({
      tenantId: tenant, handlerId: user, kind, verification: "pending", deadline: sql`now() + interval '1 month'`,
    }).returning();
    return row;
  });
}

export function updateRightsRequest(db: Database, user: string, workspace: string, raw: unknown) {
  const { id, version, verification, deadline, outcome } = updateInput.parse(raw);
  return withTenant(db, user, z.uuid().parse(workspace), "connect:privacy", async (tx, tenant) => {
    const filter = and(eq(crmRightsRequests.tenantId, tenant), eq(crmRightsRequests.id, id));
    const [current] = await tx.select().from(crmRightsRequests).where(filter).for("update");
    if (!current) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
    if (current.version !== version) throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
    if (deadline < current.receivedAt) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
    const [row] = await tx.update(crmRightsRequests).set({
      handlerId: user, verification, deadline, outcome,
      closedAt: outcome ? current.closedAt ?? new Date() : null,
      version: version + 1,
    }).where(filter).returning();
    return row;
  });
}
