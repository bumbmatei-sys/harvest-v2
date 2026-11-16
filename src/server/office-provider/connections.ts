import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { auditLogs, officeConnections } from "../../db/schema";
import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { withTenant } from "../tenancy";
import { credentialBinding, sealCredential } from "../social/credential-envelope";
import type { AccountProvider } from "./types";
// Integration defaults are hard-disabled. Test deps must supply an entirely in-memory provider.
export const OFFICE_INTEGRATION_ENABLED = false;
export type ConnectionDeps = { enabled: boolean; provider: AccountProvider };
const assertEnabled = (deps?: ConnectionDeps) => { if (!deps?.enabled) throw new AccessError(404, message("Errors.workspaceUnavailable")); };
const inputSchema = z.object({ kind: z.enum(["mail", "calendar", "files"]), provider: z.enum(["fake", "zernio"]), accountRef: z.string().min(1).max(200).refine(s => s.isWellFormed() && !s.includes("\u0000")), credential: z.string().min(1).max(500) }).strict();
export async function linkOfficeConnection(db: Database, userId: string, workspace: string, data: unknown, deps?: ConnectionDeps) {
  assertEnabled(deps); const input = inputSchema.parse(data), tenant = z.uuid().parse(workspace);
  await withTenant(db, userId, tenant, "social:connect", async () => {});
  const accounts = await deps!.provider.listAccounts({ secret: input.credential });
  if (!accounts.some(a => a.ref === input.accountRef)) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
  const id = randomUUID(), envelope = sealCredential({ secret: input.credential }, credentialBinding(tenant, id));
  return withTenant(db, userId, tenant, "social:connect", async tx => {
    await tx.insert(officeConnections).values({ tenantId: tenant, id, ownerUserId: userId, kind: input.kind, provider: input.provider, externalAccountRef: input.accountRef, credentialEnvelope: envelope as unknown as Record<string, unknown> });
    await tx.insert(auditLogs).values({ tenantId: tenant, actorId: userId, action: "office.connection_link", targetId: id, metadata: { kind: input.kind } });
    return { id, kind: input.kind };
  });
}
export async function listOfficeConnections(db: Database, userId: string, workspace: string, deps?: ConnectionDeps) {
  assertEnabled(deps);
  return withTenant(db, userId, z.uuid().parse(workspace), "social:connect", async (tx, tenant) => tx.select({ id: officeConnections.id, kind: officeConnections.kind, accountRef: officeConnections.externalAccountRef }).from(officeConnections).where(and(eq(officeConnections.tenantId, tenant), eq(officeConnections.ownerUserId, userId))));
}
