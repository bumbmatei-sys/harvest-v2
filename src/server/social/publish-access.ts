import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { auditLogs } from "../../db/schema";
import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { withTenant } from "../tenancy";
import { assertEnabled, type SocialDeps } from "./registry";

export const unavailable = () => new AccessError(404, message("Errors.workspaceUnavailable"));
export const publishConflict = (code = "STALE_VERSION") =>
  new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { code });
export class PublishValidationError extends Error {
  readonly status = 422;
  constructor(readonly details: Record<string, unknown>) {
    super(message("Errors.checkTheSuppliedDetails"));
  }
}
export const publishInvalid = (code: string, details: Record<string, unknown> = {}) => new PublishValidationError({ ...details, code });
export const versionInput = z.number().int().min(1).max(2_147_483_646);
export const recordId = (id: string) => {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw unavailable();
  return parsed.data;
};
export async function withPublish<T>(db: Database, user: string, workspace: string, deps: SocialDeps,
  run: (tx: Transaction, tenant: string) => Promise<T>) {
  assertEnabled(deps);
  try { return await withTenant(db, user, recordId(workspace), "social:schedule", run); }
  catch (error) {
    if (error instanceof AccessError && error.status === 403) throw unavailable();
    throw error;
  }
}
export const auditPublish = (tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata: {} });
