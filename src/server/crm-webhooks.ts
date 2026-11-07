import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, crmWebhookDeliveries, crmWebhookEndpoints, outboxEvents } from "../db/schema";
import { message } from "../i18n/messages";
import { uuidInput } from "../lib/contact-input";
import { crmEnvelope, crmEventTypes, type CrmEventEnvelope, type CrmEventType } from "./crm-events";
import { backoffMs } from "./jobs/primitives";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import {
  endpointSecret, httpsTransport, parseDestination, resolveDestination, signDelivery, systemResolver, TransportError, type Resolver, type Transport,
} from "./webhooks/destination";

/**
 * CRM-08 outbound webhooks: the smallest delivery foundation for CRM events (no general integration
 * platform). Owners and admins register HTTPS endpoints for chosen CRM event types; the CRM event
 * consumer turns each dispatched event into one delivery row per subscribed endpoint; an operator-run
 * delivery pass sends due deliveries, signed, with bounded time and retries. Real sending is OFF unless
 * the deployment sets HARVEST_WEBHOOK_DELIVERY=enabled and a signing key; development never sends.
 */
export const MAX_ENDPOINTS_PER_WORKSPACE = 10;
export const DELIVERY_TIMEOUT_MS = 10_000;
// One attempt is at most DNS_TIMEOUT_MS + DELIVERY_TIMEOUT_MS; the lease leaves ample margin over that.
export const DELIVERY_LEASE_MS = 60_000;
const eventTypes = z.array(z.enum(crmEventTypes as [CrmEventType, ...CrmEventType[]])).min(1).max(50)
  .refine((list) => new Set(list).size === list.length, "DUPLICATE_EVENT_TYPE");
const destination = z.string().trim().max(2000).refine((value) => parseDestination(value) !== null, "INVALID_DESTINATION");
export const endpointInput = z.object({ url: destination, eventTypes }).strict();
export const endpointPatch = z.object({
  version: z.number().int().min(1), url: destination.optional(), eventTypes: eventTypes.optional(),
  status: z.enum(["active", "disabled"]).optional(), rotateSecret: z.literal(true).optional(),
}).strict();

const missing = () => new AccessError(404, message("Errors.webhookEndpointNotAvailable"));
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
const badDestination = () => new AccessError(400, message("Errors.webhookDestinationInvalid"));

/** The server key every endpoint secret derives from. Absent means webhooks cannot be configured or sent. */
export function webhookSigningKey(env: NodeJS.ProcessEnv = process.env) {
  const key = env.HARVEST_WEBHOOK_SIGNING_KEY;
  return key && key.length >= 32 ? key : null;
}
export function webhookDeliveryEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.HARVEST_WEBHOOK_DELIVERY === "enabled" && webhookSigningKey(env) !== null;
}
const requireKey = (key: string | null) => {
  if (!key) throw new AccessError(409, message("Errors.webhooksAreNotConfigured"));
  return key;
};
const publicEndpoint = (row: typeof crmWebhookEndpoints.$inferSelect) => ({
  id: row.id, url: row.url, eventTypes: row.eventTypes as CrmEventType[], status: row.status, secretVersion: row.secretVersion,
  version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt,
});
// The ledger gets the host only: a path or query string can carry a receiver's own token.
const auditEndpoint = (tx: Transaction, tenantId: string, actorId: string, action: string, row: { id: string; url: string }, extra: Record<string, string> = {}) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action, targetId: row.id, metadata: { host: new URL(row.url).hostname, ...extra } });

export async function listWebhookEndpoints(db: Database, userId: string, workspace: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "webhooks:manage", async (tx, tenantId) => {
    const rows = await tx.select().from(crmWebhookEndpoints).where(eq(crmWebhookEndpoints.tenantId, tenantId)).orderBy(asc(crmWebhookEndpoints.createdAt), asc(crmWebhookEndpoints.id));
    return { endpoints: rows.map(publicEndpoint), eventTypes: crmEventTypes, deliveryEnabled: webhookDeliveryEnabled() };
  });
}

/** Creates an endpoint and returns its signing secret. This is the only response that contains it. */
export async function createWebhookEndpoint(db: Database, userId: string, workspace: string, data: unknown, signingKey = webhookSigningKey()) {
  const parsed = endpointInput.safeParse(data);
  if (!parsed.success) throw parsed.error.issues.some((issue) => issue.message === "INVALID_DESTINATION") ? badDestination() : parsed.error;
  const input = parsed.data;
  return withTenant(db, userId, uuidInput.parse(workspace), "webhooks:manage", async (tx, tenantId) => {
    const key = requireKey(signingKey);
    // Serialize creates per workspace so the cap holds under concurrency.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('crm_webhook_endpoints'), hashtext(${tenantId}))`);
    const [{ value }] = await tx.select({ value: count() }).from(crmWebhookEndpoints).where(eq(crmWebhookEndpoints.tenantId, tenantId));
    if (value >= MAX_ENDPOINTS_PER_WORKSPACE) throw new AccessError(409, message("Errors.webhookEndpointLimitReached"));
    const [row] = await tx.insert(crmWebhookEndpoints).values({ tenantId, url: input.url, eventTypes: input.eventTypes, createdBy: userId }).returning();
    await auditEndpoint(tx, tenantId, userId, "crm.webhook_create", row);
    return { endpoint: publicEndpoint(row), secret: endpointSecret(key, tenantId, row.id, row.secretVersion) };
  });
}

export async function updateWebhookEndpoint(db: Database, userId: string, workspace: string, endpoint: string, data: unknown, signingKey = webhookSigningKey()) {
  const id = uuidInput.parse(endpoint);
  const parsed = endpointPatch.safeParse(data);
  if (!parsed.success) throw parsed.error.issues.some((issue) => issue.message === "INVALID_DESTINATION") ? badDestination() : parsed.error;
  const { version, rotateSecret, ...input } = parsed.data;
  return withTenant(db, userId, uuidInput.parse(workspace), "webhooks:manage", async (tx, tenantId) => {
    const key = rotateSecret ? requireKey(signingKey) : null;
    const [current] = await tx.select().from(crmWebhookEndpoints).where(and(eq(crmWebhookEndpoints.tenantId, tenantId), eq(crmWebhookEndpoints.id, id))).for("update");
    if (!current) throw missing();
    if (current.version !== version) throw stale();
    const changed = (["url", "eventTypes", "status"] as const).filter((field) => input[field] !== undefined && JSON.stringify(input[field]) !== JSON.stringify(current[field]));
    if (!changed.length && !rotateSecret) return { endpoint: publicEndpoint(current) };
    const [row] = await tx.update(crmWebhookEndpoints).set({
      ...Object.fromEntries(changed.map((field) => [field, input[field]])),
      ...(rotateSecret ? { secretVersion: sql`${crmWebhookEndpoints.secretVersion} + 1` } : {}),
      updatedAt: new Date(), version: sql`${crmWebhookEndpoints.version} + 1`,
    }).where(and(eq(crmWebhookEndpoints.tenantId, tenantId), eq(crmWebhookEndpoints.id, id), eq(crmWebhookEndpoints.version, version))).returning();
    if (!row) throw stale();
    await auditEndpoint(tx, tenantId, userId, "crm.webhook_update", row, { fields: [...changed, ...(rotateSecret ? ["secret"] : [])].join(",") });
    return { endpoint: publicEndpoint(row), ...(key ? { secret: endpointSecret(key, tenantId, row.id, row.secretVersion) } : {}) };
  });
}

export async function deleteWebhookEndpoint(db: Database, userId: string, workspace: string, endpoint: string) {
  const id = uuidInput.parse(endpoint);
  return withTenant(db, userId, uuidInput.parse(workspace), "webhooks:manage", async (tx, tenantId) => {
    const [row] = await tx.delete(crmWebhookEndpoints).where(and(eq(crmWebhookEndpoints.tenantId, tenantId), eq(crmWebhookEndpoints.id, id))).returning();
    if (!row) throw missing();
    await auditEndpoint(tx, tenantId, userId, "crm.webhook_delete", row);
    return { deleted: true };
  });
}

/** Delivery history for one endpoint: outcome codes and timing only, never bodies or URLs. */
export async function listWebhookDeliveries(db: Database, userId: string, workspace: string, endpoint: string) {
  const id = uuidInput.parse(endpoint);
  return withTenant(db, userId, uuidInput.parse(workspace), "webhooks:manage", async (tx, tenantId) => {
    const [owner] = await tx.select({ id: crmWebhookEndpoints.id }).from(crmWebhookEndpoints).where(and(eq(crmWebhookEndpoints.tenantId, tenantId), eq(crmWebhookEndpoints.id, id)));
    if (!owner) throw missing();
    const rows = await tx.select({
      id: crmWebhookDeliveries.id, eventId: crmWebhookDeliveries.eventId, eventType: crmWebhookDeliveries.eventType, status: crmWebhookDeliveries.status,
      attempts: crmWebhookDeliveries.attempts, maxAttempts: crmWebhookDeliveries.maxAttempts, nextAttemptAt: crmWebhookDeliveries.nextAttemptAt,
      lastStatusCode: crmWebhookDeliveries.lastStatusCode, lastError: crmWebhookDeliveries.lastError, deliveredAt: crmWebhookDeliveries.deliveredAt,
      createdAt: crmWebhookDeliveries.createdAt,
    }).from(crmWebhookDeliveries).where(and(eq(crmWebhookDeliveries.tenantId, tenantId), eq(crmWebhookDeliveries.endpointId, id)))
      .orderBy(desc(crmWebhookDeliveries.createdAt), desc(crmWebhookDeliveries.id)).limit(50);
    return { deliveries: rows };
  });
}

/**
 * CRM event consumer: one delivery row per active endpoint subscribed to the event type. The unique
 * (endpoint, event) key makes a retried or replayed job create nothing new.
 */
export async function fanOutWebhookDeliveries(tx: Transaction, event: CrmEventEnvelope) {
  const endpoints = await tx.select({ id: crmWebhookEndpoints.id }).from(crmWebhookEndpoints).where(and(eq(crmWebhookEndpoints.tenantId, event.tenantId),
    eq(crmWebhookEndpoints.status, "active"), sql`${event.type} = any(${crmWebhookEndpoints.eventTypes})`));
  if (!endpoints.length) return 0;
  const inserted = await tx.insert(crmWebhookDeliveries).values(endpoints.map((endpoint) => ({ tenantId: event.tenantId, endpointId: endpoint.id, eventId: event.id, eventType: event.type })))
    .onConflictDoNothing({ target: [crmWebhookDeliveries.tenantId, crmWebhookDeliveries.endpointId, crmWebhookDeliveries.eventId] }).returning({ id: crmWebhookDeliveries.id });
  return inserted.length;
}

type Claimed = { id: string; token: string; url: string; endpointId: string; secretVersion: number; body: string; eventId: string; eventType: string; attempts: number; maxAttempts: number };
type Outcome = { ok: true; status: number } | { ok: false; error: "TIMEOUT" | "NETWORK" | "BLOCKED_DESTINATION" | "INVALID_DESTINATION" | "HTTP_STATUS" | "REDIRECT"; status?: number; permanent?: boolean };
export type DeliveryOptions = { transport?: Transport; resolve?: Resolver; signingKey?: string | null; enabled?: boolean; limit?: number; now?: () => Date };

/**
 * One delivery pass (operator-run, like the job drain). Deliveries go ONE AT A TIME: claim one in a short
 * transaction, send it with no transaction open, record its outcome against the lease token, then claim the
 * next. A lease therefore only has to cover a single bounded attempt (DNS + timeout), so an overlapping pass
 * cannot take over an item this pass is about to send.
 */
export async function runWebhookDeliveries(db: Database, userId: string, workspace: string, options: DeliveryOptions = {}) {
  const enabled = options.enabled ?? webhookDeliveryEnabled(), signingKey = options.signingKey === undefined ? webhookSigningKey() : options.signingKey;
  const limit = z.number().int().min(1).max(100).parse(options.limit ?? 25), hint = uuidInput.parse(workspace);
  // Membership and permission are checked even when sending is off.
  const tenantId = await withTenant(db, userId, hint, "jobs:operate", async (_tx, tenant) => tenant);
  if (!enabled || !signingKey) return { disabled: true as const, attempted: 0, succeeded: 0, retrying: 0, dead: 0 };
  const now = options.now ?? (() => new Date()), transport = options.transport ?? httpsTransport, resolve = options.resolve ?? systemResolver;
  const summary = { disabled: false as const, attempted: 0, succeeded: 0, retrying: 0, dead: 0 };
  for (let i = 0; i < limit; i++) {
    const item = await withTenant(db, userId, hint, "jobs:operate", (tx) => claimNext(tx, tenantId));
    if (item === "none") break;
    if (item === "skipped") continue;
    summary.attempted++;
    const outcome = await attempt(item, tenantId, signingKey, transport, resolve, now);
    const status = await withTenant(db, userId, hint, "jobs:operate", async (tx) => {
      const values = outcome.ok
        ? { status: "succeeded" as const, lastStatusCode: outcome.status, lastError: null, deliveredAt: sql`now()`, lockedAt: null, lockToken: null, updatedAt: sql`now()` }
        : { ...failure(item.attempts, outcome.permanent ? item.attempts : item.maxAttempts, outcome.error), lastStatusCode: outcome.status ?? null };
      const [row] = await tx.update(crmWebhookDeliveries).set(values).where(and(eq(crmWebhookDeliveries.tenantId, tenantId), eq(crmWebhookDeliveries.id, item.id),
        eq(crmWebhookDeliveries.status, "in_flight"), eq(crmWebhookDeliveries.lockToken, item.token))).returning({ status: crmWebhookDeliveries.status });
      return row?.status;
    });
    if (status === "succeeded") summary.succeeded++; else if (status === "dead") summary.dead++; else if (status) summary.retrying++;
  }
  return summary;
}

/** Recovers expired leases, then claims the next due delivery (or settles it without sending). */
async function claimNext(tx: Transaction, tenantId: string): Promise<Claimed | "none" | "skipped"> {
  // A crashed pass leaves leases behind; those attempts count, then the delivery is retried or dead.
  const expired = await tx.select().from(crmWebhookDeliveries).where(and(eq(crmWebhookDeliveries.tenantId, tenantId), eq(crmWebhookDeliveries.status, "in_flight"),
    sql`${crmWebhookDeliveries.lockedAt} <= now() - ${DELIVERY_LEASE_MS} * interval '1 millisecond'`)).limit(100).for("update", { skipLocked: true });
  for (const row of expired) await tx.update(crmWebhookDeliveries).set(failure(row.attempts, row.maxAttempts, "LEASE_EXPIRED"))
    .where(and(eq(crmWebhookDeliveries.tenantId, tenantId), eq(crmWebhookDeliveries.id, row.id)));
  const [row] = await tx.select().from(crmWebhookDeliveries).where(and(eq(crmWebhookDeliveries.tenantId, tenantId), eq(crmWebhookDeliveries.status, "pending"),
    lte(crmWebhookDeliveries.nextAttemptAt, sql`now()`))).orderBy(asc(crmWebhookDeliveries.nextAttemptAt), asc(crmWebhookDeliveries.id)).limit(1).for("update", { skipLocked: true });
  if (!row) return "none";
  const where = and(eq(crmWebhookDeliveries.tenantId, tenantId), eq(crmWebhookDeliveries.id, row.id));
  const [endpoint] = await tx.select().from(crmWebhookEndpoints).where(and(eq(crmWebhookEndpoints.tenantId, tenantId), eq(crmWebhookEndpoints.id, row.endpointId)));
  // Endpoint changes apply to queued deliveries: disabled, or no longer subscribed to this type, means not sent.
  if (!endpoint || endpoint.status !== "active" || !endpoint.eventTypes.includes(row.eventType)) {
    await tx.update(crmWebhookDeliveries).set({ status: "cancelled", lastError: "ENDPOINT_INACTIVE", updatedAt: sql`now()` }).where(where);
    return "skipped";
  }
  const [event] = await tx.select().from(outboxEvents).where(and(eq(outboxEvents.tenantId, tenantId), eq(outboxEvents.id, row.eventId)));
  // The event is read at send time, so an erasure that ran after the write is already reflected.
  const envelope = event ? crmEnvelope(event) : null;
  if (!envelope) {
    await tx.update(crmWebhookDeliveries).set({ status: "dead", lastError: "EVENT_UNAVAILABLE", updatedAt: sql`now()` }).where(where);
    return "skipped";
  }
  const token = randomUUID();
  await tx.update(crmWebhookDeliveries).set({ status: "in_flight", attempts: sql`${crmWebhookDeliveries.attempts} + 1`, lockedAt: sql`now()`, lockToken: token, updatedAt: sql`now()` }).where(where);
  return { id: row.id, token, url: endpoint.url, endpointId: endpoint.id, secretVersion: endpoint.secretVersion, body: JSON.stringify(envelope),
    eventId: envelope.id, eventType: envelope.type, attempts: row.attempts + 1, maxAttempts: row.maxAttempts };
}

function failure(attempts: number, maxAttempts: number, error: NonNullable<typeof crmWebhookDeliveries.$inferInsert["lastError"]>) {
  const dead = attempts >= maxAttempts;
  return { status: dead ? "dead" as const : "pending" as const, lastError: error, lockedAt: null, lockToken: null, updatedAt: sql`now()`,
    nextAttemptAt: dead ? sql`now()` : sql`now() + ${backoffMs(Math.max(1, attempts))} * interval '1 millisecond'` };
}

async function attempt(item: Claimed, tenantId: string, signingKey: string, transport: Transport, resolve: Resolver, now: () => Date): Promise<Outcome> {
  // Re-validated on every attempt: DNS may have changed since the endpoint was saved.
  const target = await resolveDestination(item.url, resolve);
  if (!target.ok) return { ok: false, error: target.error, permanent: target.error !== "NETWORK" };
  const timestamp = Math.floor(now().getTime() / 1000).toString();
  const secret = endpointSecret(signingKey, tenantId, item.endpointId, item.secretVersion);
  try {
    const { status } = await transport({ url: target.url, address: target.address, family: target.family, body: item.body, timeoutMs: DELIVERY_TIMEOUT_MS, headers: {
      "content-type": "application/json", "user-agent": "Harvest-Webhooks/1",
      "harvest-event-id": item.eventId, "harvest-event-type": item.eventType, "harvest-timestamp": timestamp,
      "harvest-signature": signDelivery(secret, item.eventId, timestamp, item.body),
    } });
    if (status >= 200 && status < 300) return { ok: true, status };
    if (status >= 300 && status < 400) return { ok: false, error: "REDIRECT", status };
    return { ok: false, error: "HTTP_STATUS", status: status >= 100 && status <= 599 ? status : undefined };
  } catch (error) {
    return { ok: false, error: error instanceof TransportError ? error.code : "NETWORK" };
  }
}
