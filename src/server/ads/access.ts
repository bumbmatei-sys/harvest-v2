import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { adsAccounts, adsAds, adsAdSets, adsCampaigns, auditLogs, socialConnections } from "../../db/schema";
import type { AdLevel } from "../../lib/ads/ads";
import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { withTenant } from "../tenancy";
import { credentialBinding, openCredential } from "../social/credential-envelope";
import { assertAdsEnabled, type AdsDeps } from "./registry";
import { AdsProviderError } from "./port";

export const unavailable = () => new AccessError(404, message("Errors.workspaceUnavailable"));
export const stale = (code = "STALE_VERSION") => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { code });
export class AdsValidationError extends Error {
  readonly status = 422;
  constructor(readonly details: Record<string, unknown>) { super(message("Errors.checkTheSuppliedDetails")); }
}
export const invalid = (code: string, details: Record<string, unknown> = {}) => new AdsValidationError({ ...details, code });
export const recordId = (id: string) => { const p = z.uuid().safeParse(id); if (!p.success) throw unavailable(); return p.data; };
/** Parses with a zod schema; the response never echoes the input. */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw invalid("ADS_INVALID_INPUT", { fields: [...new Set(r.error.issues.map(i => i.path.join(".") || "_"))].slice(0, 10) });
  return r.data;
}

export async function withAds<T>(db: Database, user: string, workspace: string, deps: AdsDeps, run: (tx: Transaction, tenant: string, role: string) => Promise<T>) {
  assertAdsEnabled(deps);
  try { return await withTenant(db, user, recordId(workspace), "ads:manage", run); }
  catch (error) { if (error instanceof AccessError && error.status === 403) throw unavailable(); throw error; }
}
export const audit = (tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, metadata: Record<string, string> = {}) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action: `ads.${action}`, targetId, metadata });

export type AccountContext = { account: typeof adsAccounts.$inferSelect; connection: typeof socialConnections.$inferSelect };
export async function loadAccount(tx: Transaction, tenant: string, adAccountId: string, lock = false): Promise<AccountContext> {
  const query = tx.select({ account: adsAccounts, connection: socialConnections }).from(adsAccounts)
    .innerJoin(socialConnections, and(eq(socialConnections.tenantId, adsAccounts.tenantId), eq(socialConnections.id, adsAccounts.connectionId)))
    .where(and(eq(adsAccounts.tenantId, tenant), eq(adsAccounts.id, recordId(adAccountId))));
  const [row] = await (lock ? query.$dynamic().for("update", { of: adsAccounts }).for("share", { of: socialConnections }) : query);
  if (!row) throw unavailable();
  return row;
}
/** An ad account whose connection is revoked or disabled accepts no provider call. */
export function providerAccess(ctx: AccountContext, deps: AdsDeps) {
  if (ctx.connection.status !== "active") throw invalid("CONNECTION_INACTIVE");
  const provider = deps.provider(ctx.connection.provider);
  if (provider.id !== ctx.connection.provider) throw new AdsProviderError("UNAVAILABLE");
  const credential = openCredential(ctx.connection.credentialEnvelope, credentialBinding(ctx.connection.tenantId, ctx.connection.id));
  return { provider, credential, query: { accountRef: ctx.connection.externalAccountRef, adAccountRef: ctx.account.externalRef } };
}
export type Access = ReturnType<typeof providerAccess>;
export function providerFailure(error: unknown): never {
  if (error instanceof AdsProviderError) {
    if (error.code === "AUTH") throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { code: "PROVIDER_AUTH" });
    throw new AdsValidationError({ code: `PROVIDER_${error.code}`, retryable: error.retryable ? 1 : 0 });
  }
  throw error;
}
export const failureCode = (error: unknown) => error instanceof AdsProviderError ? error.code : "ERROR";
export const isAmbiguous = (error: unknown) => error instanceof AdsProviderError && (error.code === "UNAVAILABLE" || error.code === "RATE_LIMITED" && false);

export const entityTables = { campaign: adsCampaigns, adset: adsAdSets, ad: adsAds } as const;
export async function loadEntity(tx: Transaction, tenant: string, level: AdLevel, id: string, lock = false) {
  const table = entityTables[level] as typeof adsCampaigns;
  const q = tx.select().from(table).where(and(eq(table.tenantId, tenant), eq(table.id, recordId(id))));
  const [row] = await (lock ? q.$dynamic().for("update") : q);
  if (!row) throw unavailable();
  return row;
}
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("base64url");
/** A stable, valid version 4-shaped id derived from a seed, so automatic actions have repeatable idempotency keys. */
export function derivedKey(seed: string) {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
