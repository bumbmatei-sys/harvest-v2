import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { socialWebhookEvents } from "../../db/schema";
import { message } from "../../i18n/messages";
import { appendOutboxEvent } from "../jobs/outbox";
import { rawBodyHash } from "../jobs/primitives";
import { assertEnabled, defaultSocialDeps, type SocialDeps } from "./registry";
import { socialProviders, type SocialProviderId } from "./types";
import { webhookSecrets } from "./webhook-secrets";

// Inbound provider events. One answer shape for every refusal (nothing says why), one answer for everything signed:
//   not accepted -> 404 { error }   disabled, unknown provider, wrong content type, too large, unreadable, bad signature
//   accepted     -> 202 { accepted: true }   new, duplicate, unknown account, too old/new, unrecognised: all identical
export const MAX_SOCIAL_WEBHOOK_BYTES = 65_536;
// Providers retry for about two days (assumption from public docs) and sign the body only, so replay is bounded by the event id
// (kept at least 30 days: retention TODO) plus this age window. The future bound is clock skew only.
export const EVENT_MAX_AGE_MS = 72 * 3_600_000;
export const EVENT_MAX_FUTURE_MS = 5 * 60_000;
const noStore = { "Cache-Control": "private, no-store" };
const rejected = () => Response.json({ error: message("Errors.webhookUnavailable") }, { status: 404, headers: noStore });
const accepted = () => Response.json({ accepted: true }, { status: 202, headers: noStore });

async function boundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SOCIAL_WEBHOOK_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch { return null; } finally { reader.releaseLock(); }
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); } catch { return null; }
}

/** `db` may be a getter so a refusal never needs a database connection. */
export async function receiveSocialWebhook(database: Database | (() => Database), request: Request, providerParam: string, deps: SocialDeps = defaultSocialDeps()): Promise<Response> {
  try { assertEnabled(deps); } catch { return rejected(); }
  if (!(socialProviders as readonly string[]).includes(providerParam)) return rejected();
  let provider;
  try { provider = deps.provider(providerParam as SocialProviderId); } catch { return rejected(); }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return rejected();
  const rawBody = await boundedBody(request);
  if (rawBody === null) return rejected();
  let secrets: string[];
  try { secrets = webhookSecrets(); } catch { console.error("social_webhook_key_unavailable"); return rejected(); }
  // Always run the comparison (even for a missing header) so timing does not separate the refusals.
  if (!provider.verifyWebhook(rawBody, request.headers.get(provider.signatureHeader), secrets)) return rejected();

  // From here the delivery is authentic. Everything that cannot or should not be applied is acknowledged identically.
  const event = provider.parseWebhookEvent(rawBody);
  if (!event || event.kind === "other" || !event.accountRef) return accepted();
  const now = deps.now().getTime();
  if (event.occurredAt.getTime() > now + EVENT_MAX_FUTURE_MS || event.occurredAt.getTime() < now - EVENT_MAX_AGE_MS) return accepted();
  try {
    const db = typeof database === "function" ? database() : database;
    // The tenant comes from our own connection record for this provider account, never from anything in the payload.
    const { rows } = await db.execute<{ tenant_id: string; connection_id: string }>(sql`select tenant_id, connection_id from public.social_resolve_account(${provider.id}, ${event.accountRef})`);
    const target = rows[0];
    if (!target) return accepted();
    const bodyHash = rawBodyHash(Buffer.from(rawBody, "utf8"));
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${target.tenant_id}, true)`);
      const detail: { platform?: string; errorCategory?: string } = {};
      if (event.platform) detail.platform = event.platform;
      if (event.errorCategory) detail.errorCategory = event.errorCategory;
      const [inserted] = await tx.insert(socialWebhookEvents).values({ tenantId: target.tenant_id, connectionId: target.connection_id, provider: provider.id, providerEventId: event.eventId,
        eventType: event.kind, externalAccountRef: event.accountRef!, subjectRef: event.subjectRef, detail, bodyHash, occurredAt: event.occurredAt,
      }).onConflictDoNothing({ target: [socialWebhookEvents.tenantId, socialWebhookEvents.provider, socialWebhookEvents.providerEventId] }).returning({ id: socialWebhookEvents.id });
      // A duplicate id inserts nothing and queues nothing, whatever its body.
      if (inserted) await appendOutboxEvent(tx, target.tenant_id, { kind: "social.webhook", idempotencyKey: `social-webhook:${inserted.id}`, payload: { eventId: inserted.id } });
    });
  } catch { console.error("social_webhook_store_failed"); return Response.json({ error: message("Errors.somethingWentWrongPleaseTryAgain") }, { status: 500, headers: noStore }); }
  return accepted();
}
