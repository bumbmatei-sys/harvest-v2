import { readFile } from "node:fs/promises";
import { test } from "@playwright/test";
import { Client } from "pg";

/**
 * The fake provider only knows the fixed `test-<platform>` accounts, and an account can be active in one ministry at a time (unique index
 * social_connections_account_idx on provider and external account where status <> 'revoked'). Browser specs that share one server and database (the same
 * Playwright shard) would otherwise get 409 when the next spec links the same account, so a spec revokes its ministry's connections when it ends, pass or fail.
 */
export async function releaseSocialConnections(tenantId: string) {
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  try { await admin.query("update social_connections set status='revoked' where tenant_id=$1 and status <> 'revoked'", [tenantId]); } finally { await admin.end(); }
}

/** Call once at the top of a spec file; call the returned function with the ministry's id right after creating it. */
export function releaseSocialConnectionsAfterEach() {
  let tenant: string | null = null;
  test.afterEach(async () => { if (tenant) { const id = tenant; tenant = null; await releaseSocialConnections(id); } });
  return (tenantId: string) => { tenant = tenantId; };
}
