import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { externalWebhookEvents } from "../../db/schema";
import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { appendOutboxEvent } from "../jobs/outbox";
import { rawBodyHash } from "../jobs/primitives";
import { MAX_WEBHOOK_BYTES, readSyntheticConnections, syntheticEvent, verifySyntheticSignature, type SyntheticConnection } from "./synthetic";

export class WebhookRequestError extends Error {
  constructor(public status: 413 | 415, detail: string) { super(detail); }
}
async function boundedRawBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WEBHOOK_BYTES) {
        await reader.cancel();
        throw new WebhookRequestError(413, message("Errors.webhookPayloadTooLarge"));
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function receiveWebhook(db: Database, request: Request, provider: string, connections: readonly SyntheticConnection[] = readSyntheticConnections()) {
  if (provider !== "synthetic") throw new AccessError(404, message("Errors.webhookUnavailable"));
  // The connection ID selects trusted server configuration; it never supplies
  // workspace identity. The signature binds this ID, provider, timestamp and body.
  const connection = connections.find((entry) => entry.id === request.headers.get("x-harvest-connection"));
  if (!connection) throw new AccessError(404, message("Errors.webhookUnavailable"));
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new WebhookRequestError(415, message("Errors.checkTheSuppliedDetails"));
  }
  const body = await boundedRawBody(request);
  if (!verifySyntheticSignature(body, connection, request.headers.get("x-harvest-timestamp"), request.headers.get("x-harvest-signature"))) {
    throw new AccessError(401, message("Errors.webhookSignatureInvalid"));
  }
  let rawBody: string;
  try { rawBody = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body); }
  catch { throw new SyntaxError("INVALID_ENCODING"); }
  const input = syntheticEvent.parse(JSON.parse(rawBody)), bodyHash = rawBodyHash(body);
  // Only the successfully verified server-side connection establishes context.
  return db.transaction(async (tx) => {
    const tenantId = connection.tenantId;
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    const [inserted] = await tx.insert(externalWebhookEvents).values({ tenantId, provider, connectionId: connection.id,
      providerEventId: input.id, resourceId: input.resourceId, sequence: input.sequence, rawBody, bodyHash,
      payload: input.data, occurredAt: new Date(input.occurredAt),
    }).onConflictDoNothing({ target: [externalWebhookEvents.tenantId, externalWebhookEvents.provider, externalWebhookEvents.providerEventId] }).returning();
    if (!inserted) {
      const [existing] = await tx.select().from(externalWebhookEvents).where(and(eq(externalWebhookEvents.tenantId, tenantId), eq(externalWebhookEvents.provider, provider), eq(externalWebhookEvents.providerEventId, input.id)));
      if (!existing || existing.connectionId !== connection.id || existing.bodyHash !== bodyHash) throw new AccessError(409, message("Errors.webhookEventConflict"));
      return { accepted: true, duplicate: true };
    }
    await appendOutboxEvent(tx, tenantId, { kind: "webhook.synthetic", idempotencyKey: `webhook:${inserted.id}`, payload: { eventId: inserted.id } });
    return { accepted: true, duplicate: false };
  });
}
