import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// This is a local/test contract, not an adapter for a real provider.
export const syntheticEvent = z.object({
  id: z.string().min(1).max(100), resourceId: z.string().min(1).max(100),
  sequence: z.number().int().min(0).max(2_147_483_647), occurredAt: z.iso.datetime({ offset: true }),
  data: z.object({ value: z.string().max(200) }).strict(),
}).strict();
export const syntheticConnection = z.object({
  id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/), tenantId: z.uuid(), signingKey: z.string().min(32).max(200),
}).strict();
export type SyntheticConnection = z.infer<typeof syntheticConnection>;
export const MAX_WEBHOOK_BYTES = 65_536;
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signSyntheticWebhook(body: Uint8Array, connectionId: string, signingKey: string, timestamp: string) {
  return createHmac("sha256", signingKey).update(`synthetic.${connectionId}.${timestamp}.`).update(body).digest("hex");
}
export function verifySyntheticSignature(body: Uint8Array, connection: SyntheticConnection, timestamp: string | null, signature: string | null, now = Date.now()) {
  if (!timestamp || !/^\d{10}$/.test(timestamp) || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = signSyntheticWebhook(body, connection.id, connection.signingKey, timestamp);
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}
export function readSyntheticConnections(): SyntheticConnection[] {
  // Disabled unless explicitly configured; never fall back to a built-in key.
  const raw = process.env.HARVEST_SYNTHETIC_WEBHOOKS;
  if (!raw) return [];
  try {
    const connections = z.array(syntheticConnection).max(100).parse(JSON.parse(raw));
    if (new Set(connections.map((connection) => connection.id)).size !== connections.length) throw new Error("DUPLICATE_CONNECTION");
    return connections;
  } catch { throw new Error("INVALID_SYNTHETIC_WEBHOOK_CONFIGURATION"); }
}
