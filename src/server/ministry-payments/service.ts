import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { auditLogs, catalogItems, ministryDonationReceipts, ministryPaymentAccounts,
  ministryPaymentOnboarding, ministryPaymentPrices } from "../../db/schema";
import { idempotencyKeyInput } from "../../lib/fundraising";
import { message } from "../../i18n/messages";
import { checkoutInput, ministryApplicationFee, paymentAccountAction, paymentPolicy, type MinistryPaymentKind } from "../../lib/ministry-payments";
import { AccessError, can } from "../permissions";
import { withTenant, withUser } from "../tenancy";
import { fakeConnectedAccountId, fakePaymentProvider, type AccountStatus, type MinistryPaymentProvider } from "./provider";

export const paymentMissing = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));
const conflict = (code: string) => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { code });

const synthetic = (provider: MinistryPaymentProvider) => {
  if (provider.identity !== "fake") throw paymentMissing();
};

async function finance<T>(db: Database, user: string, tenant: string,
  run: (tx: Transaction, id: string, access: string) => Promise<T>) {
  try {
    return await withTenant(db, user, z.uuid().parse(tenant), "payments:finance", (tx, id, _role, access) => run(tx, id, access));
  } catch (error) {
    if (error instanceof AccessError && error.status === 403) throw paymentMissing();
    throw error;
  }
}

type Merchant = typeof ministryPaymentAccounts.$inferSelect;
function accountView(row: Merchant | undefined) {
  if (!row) return { status: "not_connected" as const };
  const { legalName, currency, country, chargesEnabled, payoutsEnabled, requirementsDue, disconnectedAt } = row;
  const status = disconnectedAt ? "disconnected" : requirementsDue.length ? "needs_information" :
    chargesEnabled && payoutsEnabled ? "ready" : "restricted";
  return { status, legalName, currency, country, chargesEnabled, payoutsEnabled, requirementsDue };
}

export function paymentAccount(db: Database, actor: string, tenant: string) {
  return finance(db, actor, tenant, async (tx, id, access) => {
    const [account] = await tx.select().from(ministryPaymentAccounts).where(eq(ministryPaymentAccounts.tenantId, id));
    // Founder decision 27 Nov: only the owner connects, syncs or disconnects the payout account.
    return { account: accountView(account), policy: paymentPolicy, canManageAccount: can(access, "payments:manage") };
  });
}

type AccountChange = { action: "connect" | "sync" | "disconnect"; accountId: string; requestKey?: string; fingerprint?: string;
  legalName?: string; country?: string; currency?: string; status?: AccountStatus };
const textArray = (values: string[]) => `{${values.map(value => `"${value.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;
/** All payout-account writes go through the owner-only definer; the app role has no write grant on the table. */
async function saveAccount(tx: Transaction, tenant: string, provider: MinistryPaymentProvider, change: AccountChange) {
  const { rows: [row] } = await tx.execute<{ outcome: "ok" | "replay" | "key_conflict" | "account_changed" | "missing" }>(sql`
    select public.ministry_payment_account_change(${tenant}::uuid,${change.action},${provider.identity},${change.accountId},
      ${change.requestKey ?? null},${change.fingerprint ?? null},${change.legalName ?? null},${change.country ?? null},
      ${change.currency ?? null},${change.status?.chargesEnabled ?? null}::boolean,${change.status?.payoutsEnabled ?? null}::boolean,
      ${change.status ? textArray(change.status.requirementsDue) : null}::text[]) as outcome`);
  if (row.outcome === "key_conflict" || row.outcome === "account_changed") throw conflict(row.outcome);
  if (row.outcome === "missing") throw paymentMissing();
  const [saved] = await tx.select().from(ministryPaymentAccounts).where(eq(ministryPaymentAccounts.tenantId, tenant));
  return { outcome: row.outcome, account: saved };
}

export function changePaymentAccount(db: Database, actor: string, tenant: string, raw: unknown, provider = fakePaymentProvider) {
  synthetic(provider);
  return finance(db, actor, tenant, async (tx, id, access) => {
    const input = paymentAccountAction.parse(raw);
    // Founder decision 27 Nov: admins keep read access and pricing, but the payout account is the owner's alone.
    if (input.action !== "price" && !can(access, "payments:manage")) throw paymentMissing();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('ministry-payments:' || ${id}, 0))`);
    const key = eq(ministryPaymentAccounts.tenantId, id);
    const [account] = await tx.select().from(ministryPaymentAccounts).where(key);
    const audit = async (action: string) => {
      await tx.insert(auditLogs).values({ tenantId: id, actorId: actor, action: `ministry.payments.${action}`, targetId: id });
    };
    if (input.action === "connect") {
      const { requestKey, legalName, country, currency } = input;
      const fingerprint = createHash("sha256").update(JSON.stringify([legalName, country, currency])).digest("hex");
      const request = and(eq(ministryPaymentOnboarding.tenantId, id), eq(ministryPaymentOnboarding.requestKey, requestKey));
      const [prior] = await tx.select().from(ministryPaymentOnboarding).where(request);
      if (prior && prior.fingerprint !== fingerprint) throw conflict("key_conflict");
      const link = await provider.onboarding({ tenantId: id, idempotencyKey: requestKey, country, currency });
      if (prior) return { account: accountView(account), onboardingUrl: account?.disconnectedAt ? null : link.url };
      if (account && (account.provider !== provider.identity || account.accountId !== link.accountId)) throw conflict("account_changed");
      const saved = await saveAccount(tx, id, provider, { action: "connect", accountId: link.accountId, requestKey, fingerprint,
        legalName, country, currency });
      if (saved.outcome === "replay") return { account: accountView(saved.account), onboardingUrl: saved.account?.disconnectedAt ? null : link.url };
      await audit("connect");
      return { account: accountView(saved.account), onboardingUrl: link.url };
    }
    if (!account || account.provider !== provider.identity) throw paymentMissing();
    if (input.action === "price") {
      const [item] = await tx.select({ id: catalogItems.id }).from(catalogItems).where(and(
        eq(catalogItems.tenantId, id), eq(catalogItems.id, input.itemId),
      ));
      if (!item) throw paymentMissing();
      if (input.currency !== account.currency) throw conflict("currency_mismatch");
      const price = { currency: input.currency, amountMinor: BigInt(input.amountMinor) };
      await tx.insert(ministryPaymentPrices).values({ tenantId: id, itemId: item.id, ...price })
        .onConflictDoUpdate({ target: [ministryPaymentPrices.tenantId, ministryPaymentPrices.itemId], set: price });
      await audit("price");
      return { itemId: item.id, amountMinor: input.amountMinor, currency: input.currency };
    }
    if (account.disconnectedAt) {
      if (input.action === "disconnect") return { account: accountView(account) };
      throw paymentMissing();
    }
    if (input.action === "disconnect") {
      await provider.disconnect(account.accountId);
      const saved = await saveAccount(tx, id, provider, { action: "disconnect", accountId: account.accountId });
      await audit("disconnect");
      return { account: accountView(saved.account) };
    }
    const status = await provider.accountStatus(account.accountId);
    const saved = await saveAccount(tx, id, provider, { action: "sync", accountId: account.accountId, status });
    await audit("sync");
    return { account: accountView(saved.account) };
  });
}

type Checkout = { outcome: "ok"; id: string; accountId: string; amountMinor: string; currency: string;
  kind: MinistryPaymentKind; cadence: "once" | "monthly"; personalSupport: boolean } | { outcome: "missing" | "key_conflict" };

export async function startMinistryCheckout(db: Database, actor: string, tenant: string, raw: unknown, provider = fakePaymentProvider) {
  synthetic(provider);
  const input = checkoutInput.parse(raw);
  const id = z.uuid().parse(tenant);
  const { rows: [row] } = await withUser(db, actor, tx => tx.execute<{ data: Checkout }>(sql`
    select public.ministry_fake_checkout(${id}::uuid,${input.requestKey},${input.kind},
      ${input.kind === "donation" ? input.cadence : "once"},${input.kind === "sale" ? input.itemId : null}::uuid,
      ${input.kind === "donation" ? input.amountMinor : null}::bigint) as data`));
  const intent = row.data;
  if (intent.outcome === "key_conflict") throw conflict("key_conflict");
  if (intent.outcome !== "ok") throw paymentMissing();
  const { accountId, amountMinor, currency, kind, cadence, personalSupport } = intent;
  const fee = ministryApplicationFee(kind, BigInt(amountMinor));
  const result = await provider.createDirectCharge({ accountId, amountMinor: BigInt(amountMinor), currency, kind, cadence,
    applicationFeeMinor: fee, idempotencyKey: intent.id, intentId: intent.id });
  return { id: intent.id, ...result, amountMinor, currency, cadence, applicationFeeMinor: fee.toString(),
    mayNotBeTaxDeductible: kind === "donation" && personalSupport };
}

export function ministryFinanceLedger(db: Database, actor: string, tenant: string) {
  return finance(db, actor, tenant, async (tx, id) => {
    const { rows } = await tx.execute<{
      id: string; accountId: string; kind: string; amountMinor: string; currency: string; occurredAt: Date;
      paymentRef: string | null; objectRef: string; relatedChargeId: string | null;
    }>(sql`
      SELECT e.id, e.account_id AS "accountId", e.kind, e.amount_minor::text AS "amountMinor", e.currency,
        e.occurred_at AS "occurredAt", e.payment_ref AS "paymentRef", e.object_ref AS "objectRef",
        COALESCE(CASE WHEN e.kind = 'charge' THEN e.id END, c.id) AS "relatedChargeId"
      FROM public.ministry_payment_ledger e
      LEFT JOIN LATERAL (
        SELECT charge.id FROM public.ministry_payment_ledger charge
        WHERE e.kind <> 'charge' AND charge.kind = 'charge' AND charge.tenant_id = e.tenant_id
          AND charge.account_id = e.account_id AND charge.currency = e.currency
          AND (charge.payment_ref = e.payment_ref OR charge.object_ref = e.payment_ref)
        ORDER BY charge.occurred_at, charge.id LIMIT 1
      ) c ON true
      WHERE e.tenant_id = ${id}::uuid ORDER BY e.occurred_at DESC, e.id DESC LIMIT 100`);
    return { items: rows };
  });
}

export function ownDonationReceipts(db: Database, donorId: string) {
  return withUser(db, donorId, async tx => {
    const rows = await tx.select({
      id: ministryDonationReceipts.id, tenantId: ministryDonationReceipts.tenantId, legalName: ministryDonationReceipts.legalName,
      amountMinor: ministryDonationReceipts.amountMinor, currency: ministryDonationReceipts.currency, paidAt: ministryDonationReceipts.paidAt,
      mayNotBeTaxDeductible: ministryDonationReceipts.personalSupport, cadence: ministryDonationReceipts.cadence,
    }).from(ministryDonationReceipts).where(eq(ministryDonationReceipts.donorId, donorId))
      .orderBy(desc(ministryDonationReceipts.paidAt), desc(ministryDonationReceipts.id)).limit(100);
    return { items: rows.map(({ amountMinor, ...row }) => ({ ...row, amountMinor: amountMinor.toString() })) };
  });
}

export function donationManagementLink(db: Database, actor: string, receiptId: string, raw: unknown) {
  const { requestKey } = z.strictObject({ requestKey: idempotencyKeyInput }).parse(raw);
  const id = z.uuid().parse(receiptId);
  return withUser(db, actor, async tx => {
    const [receipt] = await tx.select({ tenantId: ministryDonationReceipts.tenantId, intentId: ministryDonationReceipts.intentId })
      .from(ministryDonationReceipts).where(and(eq(ministryDonationReceipts.id, id),
        eq(ministryDonationReceipts.donorId, actor), eq(ministryDonationReceipts.cadence, "monthly")));
    if (!receipt) throw paymentMissing();
    return fakePaymentProvider.subscriptionPortal(fakeConnectedAccountId(receipt.tenantId), receipt.intentId, requestKey);
  });
}
