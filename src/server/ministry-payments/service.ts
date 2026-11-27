import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { auditLogs, catalogItems, ministryDonationReceipts, ministryPaymentAccounts, ministryPaymentLedger,
  ministryPaymentOnboarding, ministryPaymentPrices } from "../../db/schema";
import { idempotencyKeyInput } from "../../lib/fundraising";
import { message } from "../../i18n/messages";
import { checkoutInput, ministryApplicationFee, paymentAccountAction, paymentPolicy, type MinistryPaymentKind } from "../../lib/ministry-payments";
import { AccessError } from "../permissions";
import { withTenant, withUser } from "../tenancy";
import { fakeConnectedAccountId, fakePaymentProvider, type MinistryPaymentProvider } from "./provider";

export const paymentMissing = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));
const conflict = (code: string) => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { code });

const synthetic = (provider: MinistryPaymentProvider) => {
  if (provider.identity !== "fake") throw paymentMissing();
};

async function finance<T>(db: Database, user: string, tenant: string, run: (tx: Transaction, id: string) => Promise<T>) {
  try {
    return await withTenant(db, user, z.uuid().parse(tenant), "workspace:read", (tx, id, _role, access) => {
      if (access !== "owner" && access !== "admin") throw paymentMissing();
      return run(tx, id);
    });
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
  return finance(db, actor, tenant, async (tx, id) => {
    const [account] = await tx.select().from(ministryPaymentAccounts).where(eq(ministryPaymentAccounts.tenantId, id));
    return { account: accountView(account), policy: paymentPolicy };
  });
}

export function changePaymentAccount(db: Database, actor: string, tenant: string, raw: unknown, provider = fakePaymentProvider) {
  synthetic(provider);
  return finance(db, actor, tenant, async (tx, id) => {
    const input = paymentAccountAction.parse(raw);
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
      const [saved] = await tx.insert(ministryPaymentAccounts).values({
        tenantId: id, accountId: link.accountId, provider: provider.identity, legalName, country, currency,
      }).onConflictDoUpdate({ target: ministryPaymentAccounts.tenantId, set: {
        legalName, country, currency, disconnectedAt: null, statusReportedAt: new Date(),
        chargesEnabled: false, payoutsEnabled: false, requirementsDue: [],
      } }).returning();
      await tx.insert(ministryPaymentOnboarding).values({ tenantId: id, requestKey, fingerprint });
      await audit("connect");
      return { account: accountView(saved), onboardingUrl: link.url };
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
    const status = input.action === "disconnect" ? { chargesEnabled: false, payoutsEnabled: false, requirementsDue: [] } :
      await provider.accountStatus(account.accountId);
    if (input.action === "disconnect") await provider.disconnect(account.accountId);
    const now = new Date();
    const [saved] = await tx.update(ministryPaymentAccounts).set({ ...status, statusReportedAt: now,
      disconnectedAt: input.action === "disconnect" ? now : null }).where(key).returning();
    await audit(input.action);
    return { account: accountView(saved) };
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
    const rows = await tx.select().from(ministryPaymentLedger).where(eq(ministryPaymentLedger.tenantId, id))
      .orderBy(desc(ministryPaymentLedger.occurredAt), desc(ministryPaymentLedger.id)).limit(100);
    return { items: rows.map(({ amountMinor, ...row }) => ({ ...row, amountMinor: amountMinor.toString() })) };
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
