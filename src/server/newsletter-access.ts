import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { message } from "../i18n/messages";
import { AccessError, type Permission } from "./permissions";
import { withTenant } from "./tenancy";

export const newsletterMissing = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));

export async function withNewsletter<T>(db: Database, actor: string, workspace: string, capability: Permission,
  run: (tx: Transaction, tenant: string) => Promise<T>) {
  const tenant = z.uuid().safeParse(workspace);
  if (!tenant.success) throw newsletterMissing();
  let authorized = false;
  try {
    return await withTenant(db, actor, tenant.data, capability, (tx, id) => {
      authorized = true;
      return run(tx, id);
    });
  } catch (error) {
    if (!authorized && error instanceof AccessError && error.status === 403) throw newsletterMissing();
    throw error;
  }
}
