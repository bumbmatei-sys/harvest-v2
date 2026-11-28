import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { connectContactDecryptAudit as events } from "../db/schema";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

const pageSize = 50;
const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);
const missing = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));

export async function listContactDecryptAudit(db: Database, user: string, rawTenant: string, cursor: unknown) {
  const tenant = z.uuid().parse(rawTenant);
  const after = cursorSchema.nullable().parse(cursor);
  let preceding: SQL | undefined;
  if (after) {
    const [time, id] = after;
    preceding = sql`(${events.createdAt}, ${events.id}) < (${time}::timestamptz, ${id}::uuid)`;
  }
  try {
    return await withTenant(db, user, tenant, "workspace:read", async (tx, id, _effectiveRole, role) => {
      if (role !== "owner" && role !== "admin") throw missing();
      const rows = await tx.select({
        id: events.id, tenantId: events.tenantId, recordId: events.recordId, purpose: events.purpose,
        actorId: events.actorId, actorKind: events.actorKind,
        createdAt: sql<string>`to_char(${events.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      }).from(events).where(and(eq(events.tenantId, id), preceding))
        .orderBy(desc(events.createdAt), desc(events.id)).limit(pageSize + 1);
      const items = rows.slice(0, pageSize);
      const last = items.at(-1);
      return { items, next: rows.length > pageSize && last ? [last.createdAt, last.id] : null };
    });
  } catch (error) {
    if (error instanceof AccessError && error.status === 403) throw missing();
    throw error;
  }
}
