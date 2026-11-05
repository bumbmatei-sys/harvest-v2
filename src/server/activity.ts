import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, companies, contacts, users, workspaceMembers } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { withTenant } from "./tenancy";

/**
 * CRM activity is the append-only audit ledger, not a second copy of events.
 * Contact-related actions stay in the contact.* namespace and target the contact,
 * so the erasure definer unlinks them together with the rest of that person's history.
 */
export const crmActions = ["contact.create", "contact.update", "contact.consent_record", "contact.company_link", "contact.company_link_update", "contact.company_unlink", "company.create", "company.update"] as const;
export type CrmAction = typeof crmActions[number];
export type ActivityMetadata = { companyId?: string; fields?: string };

export async function recordActivity(tx: Transaction, event: { tenantId: string; actorId: string; action: CrmAction; targetId: string; metadata?: ActivityMetadata }) {
  await tx.insert(auditLogs).values({ tenantId: event.tenantId, actorId: event.actorId, action: event.action, targetId: event.targetId, metadata: { ...event.metadata } });
}

export type ActivityItem = {
  id: string; action: CrmAction; createdAt: Date; actor: { id: string; name: string | null; isMember: boolean };
  fields: string[]; channel?: string; status?: string;
  company?: { id: string; name: string } | null; contact?: { id: string; name: string } | null;
};
const ACTIVITY_LIMIT = 50;

async function shape(tx: Transaction, tenantId: string, rows: (typeof auditLogs.$inferSelect)[]): Promise<ActivityItem[]> {
  const actorIds = [...new Set(rows.map((row) => row.actorId))];
  // Names come only from users who belong to this workspace; former members stay anonymous.
  const actors = actorIds.length ? await tx.select({ id: users.id, name: users.name }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.tenantId, tenantId), inArray(workspaceMembers.userId, actorIds))) : [];
  const companyIds = [...new Set(rows.map((row) => row.action === "company.create" || row.action === "company.update" ? row.targetId : row.metadata.companyId).filter((value): value is string => !!value && uuidInput.safeParse(value).success))];
  const contactIds = [...new Set(rows.filter((row) => row.action.startsWith("contact.")).map((row) => row.targetId).filter((value): value is string => !!value && uuidInput.safeParse(value).success))];
  const companyRows = companyIds.length ? await tx.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.tenantId, tenantId), inArray(companies.id, companyIds))) : [];
  const contactRows = contactIds.length ? await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, contactIds), isNull(contacts.erasedAt))) : [];
  return rows.map((row) => {
    const actor = actors.find((item) => item.id === row.actorId);
    const companyId = row.action.startsWith("company.") ? row.targetId : row.metadata.companyId;
    return {
      id: row.id, action: row.action as CrmAction, createdAt: row.createdAt,
      actor: { id: row.actorId, name: actor?.name ?? null, isMember: !!actor },
      fields: row.metadata.fields ? row.metadata.fields.split(",").filter(Boolean) : [],
      channel: row.metadata.channel, status: row.metadata.status,
      company: companyId ? companyRows.find((item) => item.id === companyId) ?? null : undefined,
      contact: row.action.startsWith("contact.") && row.targetId ? contactRows.find((item) => item.id === row.targetId) ?? null : undefined,
    };
  });
}

export function listContactActivity(db: Database, userId: string, workspace: string, contact: string) {
  const id = uuidInput.parse(contact);
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:read", async (tx, tenantId) => {
    const [live] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt)));
    if (!live) return [];
    const rows = await tx.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.targetId, id), like(auditLogs.action, "contact.%")))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(ACTIVITY_LIMIT);
    return shape(tx, tenantId, rows);
  });
}

export function listCompanyActivity(db: Database, userId: string, workspace: string, company: string) {
  const id = uuidInput.parse(company);
  return withTenant(db, userId, uuidInput.parse(workspace), "companies:read", async (tx, tenantId) => {
    const rows = await tx.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), or(
      and(eq(auditLogs.targetId, id), like(auditLogs.action, "company.%")),
      and(inArray(auditLogs.action, ["contact.company_link", "contact.company_link_update", "contact.company_unlink"]), sql`${auditLogs.metadata}->>'companyId' = ${id}`),
    ))).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(ACTIVITY_LIMIT);
    return shape(tx, tenantId, rows);
  });
}
