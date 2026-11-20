import { randomBytes } from "node:crypto";
import { and, asc, eq, exists, gt, isNull, sql } from "drizzle-orm";
import { ZodError, z } from "zod";
import type { Pool } from "pg";
import type { Database } from "../../db/client";
import { contacts, newsletterSubscribers, newsletterSubscriptions } from "../../db/schema";
import { peopleQuery } from "../contacts";
import { signNewsletterPreference } from "../newsletter-public";
import { AccessError } from "../permissions";
import { getNewsletterCampaign, savedNewsletterView } from "./campaigns";
import { withNewsletter } from "../newsletter-access";
import type { DeliveryResult, ReconciliationResult } from "./port";
import { assertFakeNewsletter, type FakeNewsletterRuntime } from "./registry";
import { renderNewsletter } from "./render";

type Due = { tenant_id: string; campaign_id: string; actor: string; cursor: string | null };
type Lease = { tenant_id: string; delivery_id: string; lease_id: string; reconcile: boolean };
type Payload = {
  recipient: string; subject: string; preview_text: string; content: unknown; sender_name: string;
  sender_email: string; reply_to: string; postal_address: string; scope: "all" | "list";
};
type Worker = Pick<Pool, "query">;
const audienceBatch = 100;

async function findCandidates(db: Database, due: Due) {
  const { tenant_id: tenant, actor, campaign_id: campaign, cursor } = due;
  const { revision } = await getNewsletterCampaign(db, actor, tenant, campaign);
  return withNewsletter(db, actor, tenant, "newsletter:read", async tx => {
    const view = revision.viewId
      ? await savedNewsletterView(tx, tenant, revision.viewId, revision.viewVersion!, revision.segmentId !== null)
      : null;
    const listMatch = revision.listId ? exists(tx.select({ one: sql`1` }).from(newsletterSubscriptions)
      .innerJoin(newsletterSubscribers, and(eq(newsletterSubscribers.tenantId, newsletterSubscriptions.tenantId),
        eq(newsletterSubscribers.id, newsletterSubscriptions.subscriberId)))
      .where(and(eq(newsletterSubscriptions.tenantId, tenant), eq(newsletterSubscriptions.listId, revision.listId),
        eq(newsletterSubscriptions.state, "subscribed"), eq(newsletterSubscribers.contactId, contacts.id)))) : undefined;
    return tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenant), isNull(contacts.erasedAt),
      cursor ? gt(contacts.id, cursor) : undefined, listMatch,
      view ? peopleQuery(tx, tenant, view.state, view.definitions, revision.segmentId === null).where : undefined))
      .orderBy(asc(contacts.id)).limit(audienceBatch + 1);
  });
}

export async function stageNewsletterAudience(db: Database, worker: Worker, runtime: FakeNewsletterRuntime) {
  assertFakeNewsletter(runtime);
  const { rows } = await worker.query<Due>("select * from public.newsletter_due()");
  for (const due of rows) {
    let candidates: Awaited<ReturnType<typeof findCandidates>>;
    try {
      candidates = await findCandidates(db, due);
    } catch (error) {
      if (!(error instanceof AccessError || error instanceof ZodError)) throw error;
      await worker.query("select public.newsletter_reject_audience($1,$2,$3)", [due.tenant_id, due.campaign_id, due.cursor]);
      continue;
    }
    await worker.query("select public.newsletter_stage($1,$2,$3,$4,$5)",
      [due.tenant_id, due.campaign_id, due.cursor, candidates.slice(0, audienceBatch).map(row => row.id), candidates.length <= audienceBatch]);
  }
  return rows.length;
}

export async function verifySyntheticSender(worker: Worker, runtime: FakeNewsletterRuntime, tenant: string, sender: string, domain: string) {
  assertFakeNewsletter(runtime);
  if (!await runtime.provider.verifySender(runtime.credential, domain)) return false;
  const { rows: [row] } = await worker.query<{ verified: boolean }>(
    "select public.newsletter_verify_test_sender($1,$2,$3) as verified", [z.uuid().parse(tenant), z.uuid().parse(sender), domain]);
  return row.verified;
}

async function dispatch(worker: Worker, runtime: FakeNewsletterRuntime, lease: Lease): Promise<DeliveryResult | null> {
  const { tenant_id: tenantId, delivery_id: key, lease_id: leaseId } = lease;
  const nonce = randomBytes(32).toString("base64url");
  const { rows: [payload] } = await worker.query<Payload>("select * from public.newsletter_start($1,$2,$3,$4)",
    [tenantId, key, leaseId, nonce]);
  if (!payload) return null;
  const url = new URL("/api/newsletter/unsubscribe", runtime.publicOrigin);
  url.searchParams.set("scope", payload.scope);
  url.searchParams.set("token", signNewsletterPreference(runtime.preferenceKey, payload.scope, nonce));
  const unsubscribe = url.href;
  const sender = { name: payload.sender_name, email: payload.sender_email, replyTo: payload.reply_to };
  let rendered: ReturnType<typeof renderNewsletter>;
  try {
    rendered = renderNewsletter(payload.content, { ...sender, postalAddress: payload.postal_address, unsubscribe });
  } catch {
    return { outcome: "failed" };
  }
  try {
    return await runtime.provider.deliver(runtime.credential, {
      ...rendered, tenantId, key, sender, recipient: payload.recipient, subject: payload.subject, previewText: payload.preview_text,
      unsubscribe, trackClicks: false, trackOpens: false,
    });
  } catch {
    return { outcome: "unknown" };
  }
}

async function reconcile(runtime: FakeNewsletterRuntime, lease: Lease): Promise<ReconciliationResult> {
  try {
    return await runtime.provider.reconcile(runtime.credential, lease.tenant_id, lease.delivery_id);
  } catch {
    return { outcome: "unknown" };
  }
}

export async function drainNewsletter(db: Database, worker: Worker, runtime: FakeNewsletterRuntime) {
  await stageNewsletterAudience(db, worker, runtime);
  const { rows } = await worker.query<Lease>("select * from public.newsletter_claim(10)");
  for (const lease of rows) {
    // Each database statement is committed before calling the provider. An expired handoff is reconciled by key.
    const result = lease.reconcile ? await reconcile(runtime, lease) : await dispatch(worker, runtime, lease);
    if (result) await worker.query("select public.newsletter_finish($1,$2,$3,$4,$5)",
      [lease.tenant_id, lease.delivery_id, lease.lease_id, result.outcome, result.outcome === "accepted" ? result.providerId : null]);
  }
  await worker.query("select public.newsletter_settle()");
  return { claimed: rows.length };
}

export async function applyNewsletterCallback(worker: Worker, runtime: FakeNewsletterRuntime, body: Uint8Array, signature: string | null) {
  assertFakeNewsletter(runtime);
  const event = runtime.provider.verifyCallback(body, signature, runtime.callbackSecret);
  if (!event) return null;
  const { rows: [row] } = await worker.query<{ applied: boolean }>(
    "select public.newsletter_callback($1,$2,$3,$4,$5,$6,$7) as applied",
    [event.tenantId, event.id, event.deliveryId, event.providerId, event.outcome, event.linkId ?? null, event.occurredAt]);
  return row.applied;
}
