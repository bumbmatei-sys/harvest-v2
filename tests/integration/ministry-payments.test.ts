import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { withUser } from "../../src/server/tenancy";
import { changePaymentAccount, donationManagementLink, ministryFinanceLedger, ownDonationReceipts,
  paymentAccount, startMinistryCheckout } from "../../src/server/ministry-payments/service";
import { fakeConnectedAccountId, fakePaymentProvider } from "../../src/server/ministry-payments/provider";
import { handleMinistryPaymentWebhook } from "../../src/server/ministry-payments/webhook";

const owner = "payment-owner", admin = "payment-admin", donor = "payment-donor", outsider = "payment-outsider";
const secret = "test-only-connect-signing-secret";
const id = () => randomUUID();
const now = Math.floor(Date.now() / 1000);
const settings = { action: "connect", requestKey: "account-1", legalName: "Synthetic Missionary", country: "US", currency: "USD" };
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, outside: string, item: string;
const send = async (eventId: string, type: string, object: object, opts: { signed?: boolean; created?: number; ministry?: string; stamp?: number } = {}) => {
  const body = JSON.stringify({ id: eventId, type, created: opts.created ?? now, account: fakeConnectedAccountId(opts.ministry ?? tenant),
    data: { object: { ...object, sensitive: "never-store-this@example.invalid" } } });
  const timestamp = opts.stamp ?? now;
  const digest = createHmac("sha256", opts.signed === false ? "wrong-key" : secret).update(`${timestamp}.${body}`).digest("hex");
  const request = new Request("https://app.example.invalid/api/payments/stripe/connect-webhook", {
    method: "POST", body, headers: { "stripe-signature": `t=${timestamp},v1=${digest}` },
  });
  return handleMinistryPaymentWebhook(request, f.workerPool, secret, "fake", now);
};
const outcome = async (...args: Parameters<typeof send>) => (await send(...args)).json();

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values([owner, admin, donor, outsider].map(id => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, owner, "Missionary team", "evangelist_missionary")).tenantId;
  outside = (await createWorkspace(f.db, outsider, "Other team", "church")).tenantId;
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values ($1,$2,'admin'),($1,$3,'member')", [tenant, admin, donor]);
  item = id();
  await f.admin.query("insert into catalog_items(tenant_id,id,kind,slug,title,state,visibility) values($1,$2,'course','synthetic-course','Course','published','listed')", [tenant, item]);
}, 120_000);
afterAll(async () => { await f?.close(); });

it("keeps finance roles and connections scoped to the ministry", async () => {
  expect((await paymentAccount(f.db, admin, tenant)).account.status).toBe("not_connected");
  const first = await changePaymentAccount(f.db, admin, tenant, settings);
  expect(first).toMatchObject({ onboardingUrl: expect.stringContaining("example.invalid"), account: { status: "restricted" } });
  expect(await changePaymentAccount(f.db, owner, tenant, settings)).toEqual(first);
  await expect(changePaymentAccount(f.db, owner, tenant, { ...settings, legalName: "Different" })).rejects.toMatchObject({ status: 409 });
  await changePaymentAccount(f.db, outsider, outside, { ...settings, legalName: "Outside ministry" });
  await expect(changePaymentAccount(f.db, donor, tenant, { action: "sync" })).rejects.toMatchObject({ status: 404 });
  await expect(paymentAccount(f.db, outsider, tenant)).rejects.toMatchObject({ status: 404 });
  expect(await changePaymentAccount(f.db, admin, tenant, { action: "sync" })).toMatchObject({ account: { status: "ready" } });
  const direct = await withUser(f.db, outsider, async tx => {
    await tx.execute(sql`select set_config('app.tenant_id',${tenant},true)`);
    return tx.execute(sql`select * from ministry_payment_accounts`);
  });
  expect(direct.rows).toEqual([]);
  await expect(f.workerPool.query("select * from ministry_payment_accounts")).rejects.toMatchObject({ code: "42501" });
});

it("builds idempotent direct charges with canonical server-side course pricing", async () => {
  await changePaymentAccount(f.db, owner, tenant, { action: "price", itemId: item, amountMinor: "10001", currency: "USD" });
  const provider = { ...fakePaymentProvider, createDirectCharge: vi.fn(fakePaymentProvider.createDirectCharge) };
  const request = { kind: "sale", requestKey: "sale-1", itemId: item };
  const checkout = await startMinistryCheckout(f.db, donor, tenant, request, provider);
  expect(checkout).toMatchObject({ amountMinor: "10001", applicationFeeMinor: "300" });
  expect(await startMinistryCheckout(f.db, donor, tenant, request, provider)).toEqual(checkout);
  expect(provider.createDirectCharge).toHaveBeenCalledWith(expect.objectContaining({ accountId: fakeConnectedAccountId(tenant),
    idempotencyKey: checkout.id, amountMinor: 10001n, applicationFeeMinor: 300n }));
  await expect(startMinistryCheckout(f.db, donor, tenant, { ...request, amountMinor: "1" })).rejects.toThrow();
  expect((await f.admin.query("select count(*)::int as n from ministry_payment_intents where kind='sale'")).rows[0].n).toBe(1);
});

it("verifies and deduplicates events, reconciles a late charge and issues receipts only to the donor", async () => {
  const gift = await startMinistryCheckout(f.db, donor, tenant, { kind: "donation", requestKey: "monthly-1", cadence: "monthly", amountMinor: "5000" });
  expect(gift).toMatchObject({ applicationFeeMinor: "0", mayNotBeTaxDeductible: true, cadence: "monthly" });
  const paid = { id: "pi_synthetic", latest_charge: "ch_synthetic", amount_received: 5000, currency: "usd", metadata: { harvest_intent_id: gift.id } };
  const refund = { id: "re_synthetic", charge: paid.latest_charge, status: "succeeded", amount: 1000, currency: "usd" };
  expect((await send("evt_invalid", "payment_intent.succeeded", paid, { signed: false })).status).toBe(400);
  expect((await send("evt_replay", "payment_intent.succeeded", paid, { stamp: now - 301 })).status).toBe(400);
  expect(await outcome("evt_refund", "refund.created", refund)).toEqual({ outcome: "recorded" });
  expect(await outcome("evt_refund", "refund.created", refund)).toEqual({ outcome: "duplicate" });
  expect(await outcome("evt_same_refund", "refund.updated", refund)).toEqual({ outcome: "ignored" });
  expect(await outcome("evt_wrong_account", "payment_intent.succeeded", paid, { ministry: outside })).toEqual({ outcome: "ignored" });
  expect(await outcome("evt_charge_before_intent", "charge.succeeded", {
    id: paid.latest_charge, payment_intent: paid.id, amount: 5000, currency: "usd",
  })).toEqual({ outcome: "ignored" });
  expect(await outcome("evt_paid", "payment_intent.succeeded", paid, { created: now - 10 })).toEqual({ outcome: "recorded" });
  expect(await outcome("evt_second_invoice", "payment_intent.succeeded", { ...paid, id: "pi_next_month", latest_charge: "ch_next_month" })).toEqual({ outcome: "recorded" });
  const receipts = await ownDonationReceipts(f.db, donor);
  expect(receipts.items).toHaveLength(2);
  expect(receipts.items[0]).toMatchObject({ legalName: "Synthetic Missionary", amountMinor: "5000", currency: "USD", mayNotBeTaxDeductible: true });
  expect(await ownDonationReceipts(f.db, outsider)).toEqual({ items: [] });
  await expect(donationManagementLink(f.db, outsider, receipts.items[0].id, { requestKey: "portal-1" })).rejects.toMatchObject({ status: 404 });
  await expect(donationManagementLink(f.db, donor, receipts.items[0].id, { requestKey: "portal-1" })).resolves.toMatchObject({ portalUrl: expect.stringContaining("example.invalid") });
  const ledger = await ministryFinanceLedger(f.db, admin, tenant);
  const charge = ledger.items.find(row => row.kind === "charge" && row.paymentRef === paid.id);
  expect(ledger.items.find(row => row.kind === "refund")).toMatchObject({ relatedChargeId: charge?.id, paymentRef: paid.latest_charge });
  await expect(ministryFinanceLedger(f.db, donor, tenant)).rejects.toMatchObject({ status: 404 });
  const events = await f.admin.query("select * from ministry_payment_events");
  expect(events.rows.every(row => Object.keys(row).sort().join(",") === "account_id,event_id,outcome,provider")).toBe(true);
  expect(JSON.stringify(events.rows)).not.toContain("never-store-this");
  await expect(f.admin.query("update ministry_payment_ledger set amount_minor=1")).rejects.toMatchObject({ code: "42501" });
  await expect(f.admin.query("truncate ministry_payment_ledger cascade")).rejects.toMatchObject({ code: "42501" });
});

it("keeps payment facts append-only and applies newer account status before older events", async () => {
  const money = { amount: 500, currency: "usd" };
  expect(await outcome("evt_fee", "application_fee.created", { ...money, id: "fee_1", payment_intent: "pi_sale" })).toEqual({ outcome: "recorded" });
  expect(await outcome("evt_dispute_late", "charge.dispute.closed", { ...money, id: "dp_1", payment_intent: "pi_sale", status: "lost" })).toEqual({ outcome: "recorded" });
  expect(await outcome("evt_dispute_early", "charge.dispute.created", { ...money, id: "dp_1", payment_intent: "pi_sale" }, { created: now - 5 })).toEqual({ outcome: "recorded" });
  expect(await outcome("evt_payout", "payout.paid", { ...money, id: "po_1" })).toEqual({ outcome: "recorded" });
  const account = fakeConnectedAccountId(tenant);
  expect(await outcome("evt_restricted", "account.updated", { id: account, charges_enabled: false, payouts_enabled: false,
    requirements: { currently_due: ["business_profile.url"] } }, { created: now + 600 })).toEqual({ outcome: "recorded" });
  expect(await outcome("evt_stale_status", "account.updated", { id: account, charges_enabled: true, payouts_enabled: true,
    requirements: { currently_due: [] } }, { created: now + 500 })).toEqual({ outcome: "ignored" });
  expect((await paymentAccount(f.db, owner, tenant)).account.status).toBe("needs_information");
  expect(await changePaymentAccount(f.db, owner, tenant, { action: "disconnect" })).toMatchObject({ account: { status: "disconnected" } });
  expect(await changePaymentAccount(f.db, owner, tenant, settings)).toMatchObject({ account: { status: "disconnected" }, onboardingUrl: null });
  await expect(startMinistryCheckout(f.db, donor, tenant, { kind: "donation", requestKey: "disabled", amountMinor: "500" })).rejects.toMatchObject({ status: 404 });
});
