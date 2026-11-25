import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { withTenant } from "../../src/server/tenancy";

/**
 * A campaign seeded on a database that has been migrated only part of the way (the restricted-owner upgrade tests stop before migration 0106). Today's
 * `createCampaign` writes every column of the current table, including ones added later (the cover reference), so it fails with "undefined column" on
 * an older schema. This inserts the six columns campaigns have had since 0021 and nothing else, through the same tenant context the runtime uses.
 */
export async function createLegacyCampaign(db: Database, userId: string, workspace: string, input: { name: string; type: string }, key: string): Promise<{ id: string }> {
  const fingerprint = createHash("sha256").update(`legacy-campaign:${workspace}:${key}:${input.name}:${input.type}`).digest("hex");
  return withTenant(db, userId, workspace, "campaigns:write", async (tx, tenantId) => {
    const result = await tx.execute(sql`insert into campaigns (tenant_id, owner_user_id, type, name, idempotency_key, fingerprint)
      values (${tenantId}, ${userId}, ${input.type}, ${input.name}, ${key}, ${fingerprint}) returning id`);
    return { id: (result.rows[0] as { id: string }).id };
  });
}
