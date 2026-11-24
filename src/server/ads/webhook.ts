import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { message } from "../../i18n/messages";
import { webhookSecrets } from "../social/webhook-secrets";
import { assertAdsEnabled, defaultAdsDeps, type AdsDeps } from "./registry";

// Inbound Ads events. Same shape as the social webhook: every refusal looks the same (404), everything signed is acknowledged identically (202).
// No webhook is ever registered by this code; deliveries are processed only when the hard-off constant is changed in a reviewed change (tests inject deps).
export const MAX_ADS_WEBHOOK_BYTES = 65_536;
export const ADS_EVENT_MAX_AGE_MS = 72 * 3_600_000;
export const ADS_EVENT_MAX_FUTURE_MS = 5 * 60_000;
const noStore = { "Cache-Control": "private, no-store" };
const rejected = () => Response.json({ error: message("Errors.webhookUnavailable") }, { status: 404, headers: noStore });
const accepted = () => Response.json({ accepted: true }, { status: 202, headers: noStore });

async function boundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_ADS_WEBHOOK_BYTES) { await reader.cancel(); return null; } chunks.push(value); } }
  catch { return null; } finally { reader.releaseLock(); }
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); } catch { return null; }
}

export async function receiveAdsWebhook(database: Database | (() => Database), request: Request, providerParam: string, deps: AdsDeps = defaultAdsDeps()): Promise<Response> {
  try { assertAdsEnabled(deps); } catch { return rejected(); }
  if (providerParam !== "zernio" && providerParam !== "fake") return rejected();
  let provider;
  try { provider = deps.provider(providerParam); } catch { return rejected(); }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return rejected();
  const rawBody = await boundedBody(request);
  if (rawBody === null) return rejected();
  let secrets: string[];
  try { secrets = webhookSecrets(); } catch { console.error("ads_webhook_key_unavailable"); return rejected(); }
  if (!provider.verifyWebhook(rawBody, request.headers.get(provider.signatureHeader), secrets)) return rejected();
  const event = provider.parseWebhookEvent(rawBody);
  if (!event) return accepted();
  const now = deps.now().getTime();
  if (event.occurredAt.getTime() > now + ADS_EVENT_MAX_FUTURE_MS || event.occurredAt.getTime() < now - ADS_EVENT_MAX_AGE_MS) return accepted();
  try {
    const db = typeof database === "function" ? database() : database;
    const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
    // The ministry comes from our own ad-account record for this provider account, never from the payload. A duplicate event id changes nothing.
    await db.execute(sql`select public.ads_webhook_apply(${provider.id}, ${event.eventId}, ${event.type}, ${event.accountRef}, ${event.subjectRef}, ${bodyHash}, ${event.occurredAt.toISOString()}::timestamptz, ${JSON.stringify(event.data)}::jsonb)`);
  } catch { console.error("ads_webhook_store_failed"); return Response.json({ error: message("Errors.somethingWentWrongPleaseTryAgain") }, { status: 500, headers: noStore }); }
  return accepted();
}
