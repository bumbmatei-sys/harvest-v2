import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import type { PaymentProviderIdentity } from "./provider";

const signatureTolerance = 300;
const maxBytes = 64 * 1024;
const reference = z.string().regex(/^[A-Za-z0-9_:-]{1,120}$/);
const currency = z.string().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase());
const amount = z.number().int().min(0).max(1_000_000_000_000);
const envelope = z.object({ id: reference, account: reference, type: z.string().max(100),
  created: z.number().int().min(0).max(4_102_444_800), data: z.object({ object: z.unknown() }) });
const object = z.object({
  id: reference,
  amount: amount.optional(),
  amount_received: amount.optional(),
  currency: currency.optional(),
  payment_intent: reference.nullish(),
  charge: reference.nullish(),
  latest_charge: reference.nullish(),
  status: z.string().max(40).optional(),
  metadata: z.object({ harvest_intent_id: z.uuid().optional() }).optional(),
  charges_enabled: z.boolean().optional(),
  payouts_enabled: z.boolean().optional(),
  requirements: z.object({ currently_due: z.array(z.string().regex(/^[a-zA-Z0-9_.]{1,120}$/)).max(80) }).optional(),
});
type Kind = "ignored" | "account_status" | "account_disconnected" | "subscription_ended" |
  "charge" | "application_fee" | "refund" | "dispute_opened" | "dispute_won" | "dispute_lost" | "payout";

export function validConnectSignature(body: Uint8Array, header: string | null, secret: string, now = Math.floor(Date.now() / 1000)) {
  if (!secret || !header || header.length > 2000 || body.length > maxBytes) return false;
  const parts = header.split(",");
  const stamps = parts.filter(part => /^t=\d{1,12}$/.test(part));
  if (stamps.length !== 1 || parts.filter(part => part.startsWith("t=")).length !== 1) return false;
  const timestamp = stamps[0].slice(2);
  if (Math.abs(now - Number(timestamp)) > signatureTolerance) return false;
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest();
  return parts.some(part => /^v1=[a-fA-F0-9]{64}$/.test(part) && timingSafeEqual(digest, Buffer.from(part.slice(3), "hex")));
}

async function boundedBody(request: Request) {
  if (!request.body || Number(request.headers.get("content-length")) > maxBytes) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, total);
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function normalized(raw: unknown) {
  const event = envelope.safeParse(raw);
  if (!event.success) return null;
  const { id, account, type, created, data } = event.data;
  const parsed = object.safeParse(data.object);
  const value = parsed.data;
  let kind: Kind = "ignored";
  let payment: string | null = null;
  let objectId = value?.id ?? null;
  let money = value?.amount ?? null;
  if (value) {
    switch (type) {
      case "account.updated":
        if (value.id === account) kind = "account_status";
        break;
      case "account.application.deauthorized":
        kind = "account_disconnected";
        break;
      case "payment_intent.succeeded":
        kind = "charge";
        payment = value.id;
        objectId = value.latest_charge ?? value.id;
        money = value.amount_received ?? null;
        break;
      case "charge.succeeded":
        // The intent event supplies the checkout reference for intent-backed charges.
        if (!value.payment_intent) { kind = "charge"; payment = value.id; }
        break;
      case "application_fee.created":
        kind = "application_fee";
        payment = value.payment_intent ?? value.charge ?? null;
        break;
      case "refund.created":
      case "refund.updated":
        if (value.status === "succeeded") {
          kind = "refund";
          payment = value.payment_intent ?? value.charge ?? null;
        }
        break;
      case "charge.dispute.created":
        kind = "dispute_opened";
        payment = value.payment_intent ?? value.charge ?? null;
        break;
      case "charge.dispute.closed":
        if (value.status === "won" || value.status === "lost") {
          kind = value.status === "won" ? "dispute_won" : "dispute_lost";
          payment = value.payment_intent ?? value.charge ?? null;
        }
        break;
      case "payout.paid":
        kind = "payout";
        break;
      case "customer.subscription.deleted":
        kind = "subscription_ended";
        break;
    }
  }
  return { id, account, kind, objectId, payment, intent: value?.metadata?.harvest_intent_id ?? null, amount: money,
    currency: value?.currency ?? null, time: new Date(created * 1000), charges: value?.charges_enabled ?? null,
    payouts: value?.payouts_enabled ?? null, due: value?.requirements?.currently_due ?? null };
}

export async function handleMinistryPaymentWebhook(request: Request, worker: Pick<Pool, "query">,
  secret: string, provider: PaymentProviderIdentity, now?: number) {
  const body = await boundedBody(request);
  if (!body || !validConnectSignature(body, request.headers.get("stripe-signature"), secret, now)) {
    return Response.json({ outcome: "invalid_signature" }, { status: 400 });
  }
  let raw: unknown;
  try { raw = JSON.parse(body.toString("utf8")); }
  catch { return Response.json({ outcome: "invalid_event" }, { status: 400 }); }
  const event = normalized(raw);
  if (!event) return Response.json({ outcome: "invalid_event" }, { status: 400 });
  const { rows: [row] } = await worker.query<{ outcome: "recorded" | "ignored" | "duplicate" }>(
    "select public.ministry_payment_record_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as outcome",
    [provider, event.id, event.account, event.kind, event.objectId, event.payment, event.intent, event.amount,
      event.currency, event.time, event.charges, event.payouts, event.due],
  );
  return Response.json({ outcome: row.outcome }, { headers: { "Cache-Control": "no-store" } });
}
