import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import type { crmImportEntities, crmImportStatuses } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { withTenant } from "./tenancy";

type ImportDiagnostic = {
  id: string;
  entity: typeof crmImportEntities[number];
  status: typeof crmImportStatuses[number];
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt: string | Date | null;
  rolledBackAt: string | Date | null;
};

export function getCrmImportDiagnostics(db: Database, userId: string, workspace: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:read_diagnostics", async (tx, tenantId) => {
    const { rows } = await tx.execute<ImportDiagnostic>(sql`
      select id, entity, status, created_at as "createdAt", updated_at as "updatedAt",
        completed_at as "completedAt", rolled_back_at as "rolledBackAt"
      from public.crm_import_diagnostics(${tenantId}::uuid)
      order by created_at desc, id desc
    `);
    return { imports: rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      completedAt: row.completedAt && new Date(row.completedAt).toISOString(),
      rolledBackAt: row.rolledBackAt && new Date(row.rolledBackAt).toISOString(),
    })) };
  });
}
