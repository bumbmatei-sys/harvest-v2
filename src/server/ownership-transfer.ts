import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { crmNotifications } from "../db/schema";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant, withUser } from "./tenancy";

export const transferInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("offer"), recipientUserId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.enum(["accept", "decline", "cancel"]), offerId: z.uuid() }).strict(),
]);
type Mutation = z.infer<typeof transferInput>;
type Status = { action: "status"; offerId?: string };
type TransferOutcome = {
  outcome: string; id?: string; fromUserId?: string; toUserId?: string; expiresAt?: string;
};

export function ownershipTransfer(db: Database, actor: string, tenant: string, input: Mutation): Promise<TransferOutcome>;
export function ownershipTransfer(db: Database, actor: string, tenant: string, input: Status): Promise<TransferOutcome | null>;
export async function ownershipTransfer(db: Database, actor: string, tenant: string, input: Mutation | Status) {
  const tenantId = z.uuid().parse(tenant);
  const id = "offerId" in input && input.offerId !== undefined ? z.uuid().parse(input.offerId) : null;
  const who = "recipientUserId" in input ? input.recipientUserId : null;
  // Commit business refusals as well: expiry and membership-change close the offer and leave an audit row.
  const outcome = await withUser(db, actor, async (tx) => {
    const { rows: [row] } = await tx.execute<{ data: TransferOutcome }>(sql`
      select public.workspace_ownership_transfer(${tenantId}::uuid,${input.action},${who},${id}::uuid) as data`);
    return row.data;
  });
  if (input.action === "status" && outcome.outcome === "not_found") return null;
  if (outcome.outcome === "forbidden") throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
  if (outcome.outcome === "not_found") throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
  if (input.action !== "status" && !["offered", "accepted", "cancelled", "declined"].includes(outcome.outcome)) {
    throw new AccessError(409, message(`OwnershipTransfer.${outcome.outcome}` as
      "OwnershipTransfer.ineligible_recipient" | "OwnershipTransfer.pending_exists" | "OwnershipTransfer.expired" |
      "OwnershipTransfer.membership_changed" | "OwnershipTransfer.already_closed"), { code: outcome.outcome });
  }
  return outcome;
}

const mine = (tenant: string, actor: string) => and(eq(crmNotifications.tenantId, tenant),
  eq(crmNotifications.recipientUserId, actor), eq(crmNotifications.kind, "ownership_transfer"));
export function listOwnershipNotifications(db: Database, actor: string, tenant: string) {
  return withTenant(db, actor, z.uuid().parse(tenant), "workspace:read", async (tx, id) => {
    const filter = mine(id, actor);
    const items = await tx.select({ id: crmNotifications.id, kind: crmNotifications.kind, offerId: crmNotifications.ownershipOfferId,
      actorUserId: crmNotifications.actorUserId, readAt: crmNotifications.readAt, createdAt: crmNotifications.createdAt })
      .from(crmNotifications).where(filter)
      .orderBy(desc(crmNotifications.createdAt), desc(crmNotifications.id)).limit(20);
    const [{ unread }] = await tx.select({ unread: count() }).from(crmNotifications).where(and(filter, isNull(crmNotifications.readAt)));
    return { items, unread };
  });
}

export function markOwnershipNotifications(db: Database, actor: string, tenant: string, ids: string[] | "all") {
  return withTenant(db, actor, z.uuid().parse(tenant), "workspace:read", async (tx, id) => {
    const updated = await tx.update(crmNotifications).set({ readAt: new Date() })
      .where(and(mine(id, actor), isNull(crmNotifications.readAt), ids === "all" ? undefined : inArray(crmNotifications.id, ids)))
      .returning({ id: crmNotifications.id });
    return { updated: updated.length };
  });
}
