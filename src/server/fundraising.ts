import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, campaignDrafts, campaigns, contacts, fundraisingCampaigns, fundraisingPledges, givingContactLinks, givingLedgerEntries, users } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import {
  fundraisingCreateInput, fundraisingCurrencies, fundraisingUpdateInput, giftCorrectionInput, giftCreateInput, idempotencyKeyInput, pledgeCreateInput,
  pledgeUpdateInput, type FundraisingCurrency, type FundraisingRow, type FundraisingStatus, type FundraisingTotals, type GiftRow, type PledgeRow,
} from "../lib/fundraising";
import { can } from "../lib/permissions";
import { message, type MessageKey } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import { workFingerprint } from "./jobs/primitives";

/**
 * Fundraising pledge campaigns (docs/superpowers/specs/2026-11-17-fundraising-pledge-campaigns-design.md, slices F1 and F3 for staff).
 * Record keeping only: no provider, no payment, no public page. A pledge is an intention; only gifts an owner or admin records as confirmed by the
 * ministry count toward "raised". Corrections append an exact reversal (and optionally a replacement) and never edit a ledger row.
 * Audit rows carry ids, states and field names, never names, contact details or amounts.
 */
export function fundraisingEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production";
}

const PAGE = 200;
const fail = (status: 400 | 404 | 409, key: MessageKey) => new AccessError(status, message(key));
const notFound = () => fail(404, "Fundraising.notFound");
const sqlState = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? sqlState(error.cause) : undefined;
};
/** Database refusals the service did not foresee become neutral answers; access denials (42501) keep their 403 path. */
async function mapped<T>(work: Promise<T>, conflict: MessageKey = "Fundraising.conflict"): Promise<T> {
  try { return await work; } catch (error) {
    const code = sqlState(error);
    if (code === "23503" || code === "23514" || code === "23505") throw fail(409, conflict);
    throw error;
  }
}
const audit = (tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, metadata: Record<string, string> = {}) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata });

const campaignColumns = {
  id: fundraisingCampaigns.id, campaignId: fundraisingCampaigns.campaignId, campaignName: campaigns.name, title: fundraisingCampaigns.title,
  summary: fundraisingCampaigns.summary, status: fundraisingCampaigns.status, goalCents: fundraisingCampaigns.goalCents, currency: fundraisingCampaigns.currency,
  version: fundraisingCampaigns.version, createdAt: fundraisingCampaigns.createdAt, updatedAt: fundraisingCampaigns.updatedAt,
};
type CampaignRecord = { id: string; campaignId: string | null; campaignName: string | null; title: string; summary: string | null; status: FundraisingStatus;
  goalCents: bigint; currency: string; version: number; createdAt: Date; updatedAt: Date };

/** Exact staff totals from the ledger (net of reversals) and live pledges, per campaign. Owner/admin rows only (RLS). */
async function totalsFor(tx: Transaction, tenantId: string, ids: string[]): Promise<Map<string, FundraisingTotals>> {
  const result = new Map<string, FundraisingTotals>();
  if (!ids.length) return result;
  for (const id of ids) result.set(id, { raisedCents: "0", giftCount: 0, pledgedCents: "0", pledgeCount: 0 });
  const gifts = await tx.select({ id: givingLedgerEntries.fundraisingId, raised: sql<string>`coalesce(sum(${givingLedgerEntries.amountCents}), 0)::text`,
    count: sql<number>`(count(*) filter (where ${givingLedgerEntries.kind} = 'gift') - count(*) filter (where ${givingLedgerEntries.kind} = 'reversal'))::int` })
    .from(givingLedgerEntries).where(and(eq(givingLedgerEntries.tenantId, tenantId), inArray(givingLedgerEntries.fundraisingId, ids))).groupBy(givingLedgerEntries.fundraisingId);
  for (const row of gifts) Object.assign(result.get(row.id)!, { raisedCents: row.raised, giftCount: row.count });
  const pledges = await tx.select({ id: fundraisingPledges.fundraisingId, pledged: sql<string>`coalesce(sum(${fundraisingPledges.amountCents}), 0)::text`, count: sql<number>`count(*)::int` })
    .from(fundraisingPledges).where(and(eq(fundraisingPledges.tenantId, tenantId), inArray(fundraisingPledges.fundraisingId, ids), ne(fundraisingPledges.status, "cancelled")))
    .groupBy(fundraisingPledges.fundraisingId);
  for (const row of pledges) Object.assign(result.get(row.id)!, { pledgedCents: row.pledged, pledgeCount: row.count });
  return result;
}
function present(row: CampaignRecord, totals: FundraisingTotals | null): FundraisingRow {
  return { ...row, status: row.status, goalCents: row.goalCents.toString(), currency: row.currency as FundraisingCurrency, createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(), totals };
}
async function campaignRow(tx: Transaction, tenantId: string, id: string) {
  const [row] = await tx.select(campaignColumns).from(fundraisingCampaigns)
    .leftJoin(campaigns, and(eq(campaigns.tenantId, fundraisingCampaigns.tenantId), eq(campaigns.id, fundraisingCampaigns.campaignId)))
    .where(and(eq(fundraisingCampaigns.tenantId, tenantId), eq(fundraisingCampaigns.id, id)));
  if (!row) throw notFound();
  return row as CampaignRecord;
}

export function listFundraising(db: Database, userId: string, workspace: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "fundraising:read", async (tx, tenantId, _role, access) => {
    const rows = await tx.select(campaignColumns).from(fundraisingCampaigns)
      .leftJoin(campaigns, and(eq(campaigns.tenantId, fundraisingCampaigns.tenantId), eq(campaigns.id, fundraisingCampaigns.campaignId)))
      .where(eq(fundraisingCampaigns.tenantId, tenantId)).orderBy(desc(fundraisingCampaigns.createdAt), desc(fundraisingCampaigns.id)).limit(PAGE) as CampaignRecord[];
    const totals = can(access, "giving:record") ? await totalsFor(tx, tenantId, rows.map((row) => row.id)) : null;
    return rows.map((row) => present(row, totals?.get(row.id) ?? null));
  });
}

export function getFundraising(db: Database, userId: string, workspace: string, fundraising: string) {
  const id = uuidInput.parse(fundraising);
  return withTenant(db, userId, uuidInput.parse(workspace), "fundraising:read", async (tx, tenantId, _role, access) => {
    const row = await campaignRow(tx, tenantId, id);
    const totals = can(access, "giving:record") ? (await totalsFor(tx, tenantId, [id])).get(id)! : null;
    return present(row, totals);
  });
}

/** Goal and currency from the outreach campaign's budget settings (CW-09 step 6), when fundraising was turned on there with a supported currency. */
async function budgetDefaults(tx: Transaction, tenantId: string, campaignId: string): Promise<{ goalCents: string; currency: FundraisingCurrency } | null> {
  const [draft] = await tx.select({ budget: campaignDrafts.budget }).from(campaignDrafts).where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.campaignId, campaignId)));
  const budget = draft?.budget;
  if (!budget?.fundraisingEnabled || !budget.fundraisingGoalMinor || budget.fundraisingGoalMinor < 1) return null;
  if (!(fundraisingCurrencies as readonly string[]).includes(budget.currency)) return null;
  return { goalCents: String(budget.fundraisingGoalMinor), currency: budget.currency as FundraisingCurrency };
}

/**
 * What the outreach campaign page shows: its live fundraiser (goal, raised, progress) or, when there is none, the goal and currency its budget settings
 * would start one with. Owners and admins see raised figures; anyone else with Giving sees the goal only.
 */
export function campaignFundraising(db: Database, userId: string, workspace: string, campaign: string) {
  const campaignId = uuidInput.parse(campaign);
  return withTenant(db, userId, uuidInput.parse(workspace), "fundraising:read", async (tx, tenantId, _role, access) => {
    const [linked] = await tx.select({ id: fundraisingCampaigns.id }).from(fundraisingCampaigns)
      .where(and(eq(fundraisingCampaigns.tenantId, tenantId), eq(fundraisingCampaigns.campaignId, campaignId), ne(fundraisingCampaigns.status, "archived")));
    if (linked) {
      const row = await campaignRow(tx, tenantId, linked.id);
      return { fundraising: present(row, can(access, "giving:record") ? (await totalsFor(tx, tenantId, [row.id])).get(row.id)! : null), defaults: null };
    }
    return { fundraising: null, defaults: await budgetDefaults(tx, tenantId, campaignId) };
  });
}

export async function createFundraising(db: Database, userId: string, workspace: string, data: unknown, key: unknown) {
  const input = fundraisingCreateInput.parse(data), idempotencyKey = idempotencyKeyInput.parse(key);
  return mapped(withTenant(db, userId, uuidInput.parse(workspace), "fundraising:manage", async (tx, tenantId) => {
    let goalCents = input.goalCents, currency = input.currency;
    if (input.campaignId) {
      // The outreach campaign must be one this person can see (row-level security on campaigns); a foreign key alone would not check that.
      const [visible] = await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, input.campaignId), isNull(campaigns.archivedAt)));
      if (!visible) throw fail(404, "Fundraising.campaignNotFound");
      const defaults = goalCents && currency ? null : await budgetDefaults(tx, tenantId, input.campaignId);
      goalCents ??= defaults?.goalCents ?? null; currency ??= defaults?.currency ?? null;
    }
    if (!goalCents || !currency) throw fail(400, "Fundraising.goalRequired");
    const values = { title: input.title, summary: input.summary, campaignId: input.campaignId, goalCents, currency };
    const fingerprint = workFingerprint("fundraising.create", values);
    const [inserted] = await tx.insert(fundraisingCampaigns).values({ ...values, goalCents: BigInt(goalCents), tenantId, createdBy: userId, idempotencyKey, fingerprint })
      .onConflictDoNothing({ target: [fundraisingCampaigns.tenantId, fundraisingCampaigns.idempotencyKey] }).returning({ id: fundraisingCampaigns.id });
    if (inserted) {
      await audit(tx, tenantId, userId, "fundraising.create", inserted.id, input.campaignId ? { campaign: input.campaignId } : {});
      return present(await campaignRow(tx, tenantId, inserted.id), null);
    }
    const [existing] = await tx.select({ id: fundraisingCampaigns.id, fingerprint: fundraisingCampaigns.fingerprint }).from(fundraisingCampaigns)
      .where(and(eq(fundraisingCampaigns.tenantId, tenantId), eq(fundraisingCampaigns.idempotencyKey, idempotencyKey)));
    if (!existing || existing.fingerprint !== fingerprint) throw fail(409, "Fundraising.idempotencyConflict");
    return present(await campaignRow(tx, tenantId, existing.id), null);
  }), "Fundraising.campaignTaken");
}

const transitions = { open: ["draft", "published"], close: ["published", "closed"], archive: [null, "archived"] } as const;
export async function updateFundraising(db: Database, userId: string, workspace: string, fundraising: string, data: unknown) {
  const id = uuidInput.parse(fundraising), input = fundraisingUpdateInput.parse(data);
  return mapped(withTenant(db, userId, uuidInput.parse(workspace), input.action === "open" ? "fundraising:publish" : "fundraising:manage", async (tx, tenantId) => {
    const current = await campaignRow(tx, tenantId, id);
    if (current.version !== input.version) throw fail(409, "Fundraising.stale");
    const changes: Partial<typeof fundraisingCampaigns.$inferInsert> = {}, fields: string[] = [];
    if (input.title !== undefined && input.title !== current.title) { changes.title = input.title; fields.push("title"); }
    if (input.summary !== undefined && input.summary !== current.summary) { changes.summary = input.summary; fields.push("summary"); }
    if (input.goalCents !== undefined && BigInt(input.goalCents) !== current.goalCents) { changes.goalCents = BigInt(input.goalCents); fields.push("goal"); }
    if (input.currency !== undefined && input.currency !== current.currency) { changes.currency = input.currency; fields.push("currency"); }
    if (fields.length && current.status === "archived") throw fail(409, "Fundraising.archived");
    let action = "fundraising.update";
    if (input.action) {
      const [from, to] = transitions[input.action];
      const allowed = input.action === "archive" ? current.status === "draft" || current.status === "closed" : current.status === from;
      if (!allowed) throw fail(409, "Fundraising.invalidTransition");
      changes.status = to;
      if (to === "published") changes.publishedAt = new Date();
      if (to === "closed") changes.closedAt = new Date();
      action = `fundraising.${input.action}`;
    }
    if (!fields.length && !input.action) return present(current, null);
    const [updated] = await tx.update(fundraisingCampaigns).set({ ...changes, version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(fundraisingCampaigns.tenantId, tenantId), eq(fundraisingCampaigns.id, id), eq(fundraisingCampaigns.version, input.version))).returning({ id: fundraisingCampaigns.id });
    if (!updated) throw fail(409, "Fundraising.stale");
    await audit(tx, tenantId, userId, action, id, { version: String(current.version + 1), ...(fields.length ? { fields: fields.join(",") } : {}) });
    return present(await campaignRow(tx, tenantId, id), null);
  }), input.currency ? "Fundraising.currencyLocked" : "Fundraising.conflict");
}

/** A same-ministry CRM contact the person can see and that is not erased. Linking is an explicit staff choice, never an email match. */
async function liveContact(tx: Transaction, tenantId: string, contactId: string | null) {
  if (!contactId) return null;
  const [row] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId), isNull(contacts.erasedAt)));
  if (!row) throw fail(404, "Fundraising.contactNotFound");
  return row.id;
}
async function campaignForRecords(tx: Transaction, tenantId: string, id: string) {
  const [row] = await tx.select({ id: fundraisingCampaigns.id, status: fundraisingCampaigns.status, currency: fundraisingCampaigns.currency }).from(fundraisingCampaigns)
    .where(and(eq(fundraisingCampaigns.tenantId, tenantId), eq(fundraisingCampaigns.id, id)));
  if (!row) throw notFound();
  return row;
}

const pledgeColumns = {
  id: fundraisingPledges.id, amountCents: fundraisingPledges.amountCents, currency: fundraisingPledges.currency, status: fundraisingPledges.status,
  supporterName: fundraisingPledges.supporterName, supporterContact: fundraisingPledges.supporterContact, contactId: fundraisingPledges.contactId,
  expectedOn: fundraisingPledges.expectedOn, version: fundraisingPledges.version, createdAt: fundraisingPledges.createdAt,
};
type PledgeRecord = { id: string; amountCents: bigint; currency: string; status: PledgeRow["status"]; supporterName: string | null; supporterContact: string | null;
  contactId: string | null; expectedOn: string | null; version: number; createdAt: Date };
const presentPledge = (row: PledgeRecord, gifted = "0"): PledgeRow => ({ ...row, amountCents: row.amountCents.toString(), createdAt: row.createdAt.toISOString(), giftedCents: gifted });

/** Supporter details: owners and admins only, and every read is audited (ids only). */
export function listPledges(db: Database, userId: string, workspace: string, fundraising: string) {
  const id = uuidInput.parse(fundraising);
  return withTenant(db, userId, uuidInput.parse(workspace), "giving:read_donors", async (tx, tenantId) => {
    await campaignForRecords(tx, tenantId, id);
    const rows = await tx.select(pledgeColumns).from(fundraisingPledges).where(and(eq(fundraisingPledges.tenantId, tenantId), eq(fundraisingPledges.fundraisingId, id)))
      .orderBy(desc(fundraisingPledges.createdAt), desc(fundraisingPledges.id)).limit(PAGE) as PledgeRecord[];
    const gifted = rows.length ? await tx.select({ id: givingLedgerEntries.pledgeId, total: sql<string>`sum(${givingLedgerEntries.amountCents})::text` }).from(givingLedgerEntries)
      .where(and(eq(givingLedgerEntries.tenantId, tenantId), inArray(givingLedgerEntries.pledgeId, rows.map((row) => row.id)))).groupBy(givingLedgerEntries.pledgeId) : [];
    const byPledge = new Map(gifted.map((row) => [row.id, row.total]));
    await audit(tx, tenantId, userId, "giving.donors.read", id, { view: "pledges" });
    return rows.map((row) => presentPledge(row, byPledge.get(row.id) ?? "0"));
  });
}

export async function recordPledge(db: Database, userId: string, workspace: string, fundraising: string, data: unknown, key: unknown) {
  const id = uuidInput.parse(fundraising), input = pledgeCreateInput.parse(data), idempotencyKey = idempotencyKeyInput.parse(key);
  return mapped(withTenant(db, userId, uuidInput.parse(workspace), "giving:record", async (tx, tenantId) => {
    const campaign = await campaignForRecords(tx, tenantId, id);
    if (campaign.status !== "draft" && campaign.status !== "published") throw fail(409, "Fundraising.notTakingPledges");
    const contactId = await liveContact(tx, tenantId, input.contactId);
    const values = { fundraisingId: id, amountCents: input.amountCents, supporterName: input.supporterName, supporterContact: input.supporterContact, contactId, expectedOn: input.expectedOn };
    const fingerprint = workFingerprint("fundraising.pledge", values);
    const [inserted] = await tx.insert(fundraisingPledges).values({ ...values, amountCents: BigInt(input.amountCents), currency: campaign.currency, tenantId, createdBy: userId, idempotencyKey, fingerprint })
      .onConflictDoNothing({ target: [fundraisingPledges.tenantId, fundraisingPledges.idempotencyKey] }).returning(pledgeColumns);
    if (inserted) {
      await audit(tx, tenantId, userId, "giving.pledge.record", inserted.id, { fundraising: id });
      return presentPledge(inserted as PledgeRecord);
    }
    const [existing] = await tx.select({ ...pledgeColumns, fingerprint: fundraisingPledges.fingerprint }).from(fundraisingPledges)
      .where(and(eq(fundraisingPledges.tenantId, tenantId), eq(fundraisingPledges.idempotencyKey, idempotencyKey)));
    if (!existing || existing.fingerprint !== fingerprint) throw fail(409, "Fundraising.idempotencyConflict");
    const { fingerprint: _f, ...row } = existing; void _f;
    return presentPledge(row as PledgeRecord);
  }));
}

export async function updatePledge(db: Database, userId: string, workspace: string, fundraising: string, pledge: string, data: unknown) {
  const id = uuidInput.parse(fundraising), pledgeId = uuidInput.parse(pledge), input = pledgeUpdateInput.parse(data);
  return mapped(withTenant(db, userId, uuidInput.parse(workspace), "giving:record", async (tx, tenantId) => {
    const [current] = await tx.select(pledgeColumns).from(fundraisingPledges)
      .where(and(eq(fundraisingPledges.tenantId, tenantId), eq(fundraisingPledges.fundraisingId, id), eq(fundraisingPledges.id, pledgeId)));
    if (!current) throw notFound();
    if (current.version !== input.version) throw fail(409, "Fundraising.stale");
    const to = input.action === "accept" ? "accepted" : "cancelled";
    if (!(input.action === "accept" ? current.status === "pending" : current.status !== "cancelled")) throw fail(409, "Fundraising.invalidTransition");
    const [updated] = await tx.update(fundraisingPledges).set({ status: to, version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(fundraisingPledges.tenantId, tenantId), eq(fundraisingPledges.id, pledgeId), eq(fundraisingPledges.version, input.version))).returning(pledgeColumns);
    if (!updated) throw fail(409, "Fundraising.stale");
    await audit(tx, tenantId, userId, `giving.pledge.${input.action}`, pledgeId, { fundraising: id, status: to });
    return presentPledge(updated as PledgeRecord);
  }));
}

/** Gifts and reversals of one campaign, newest first, with who recorded each one and who it came from. Owners and admins; audited. */
export function listGifts(db: Database, userId: string, workspace: string, fundraising: string) {
  const id = uuidInput.parse(fundraising);
  return withTenant(db, userId, uuidInput.parse(workspace), "giving:read_donors", async (tx, tenantId) => {
    await campaignForRecords(tx, tenantId, id);
    const reversal = sql`exists (select 1 from ${givingLedgerEntries} r where r.tenant_id = ${givingLedgerEntries.tenantId} and r.correction_of = ${givingLedgerEntries.id} and r.kind = 'reversal')`;
    const rows = await tx.select({
      id: givingLedgerEntries.id, kind: givingLedgerEntries.kind, amountCents: givingLedgerEntries.amountCents, currency: givingLedgerEntries.currency,
      giftDate: givingLedgerEntries.giftDate, pledgeId: givingLedgerEntries.pledgeId, correctionOf: givingLedgerEntries.correctionOf, reason: givingLedgerEntries.reason,
      methodLabel: givingLedgerEntries.methodLabel, reference: givingLedgerEntries.reference, confirmedBy: givingLedgerEntries.confirmedBy, confirmedByName: users.name,
      confirmedAt: givingLedgerEntries.confirmedAt, linkName: givingContactLinks.supporterName, linkContact: givingContactLinks.contactId,
      pledgeName: fundraisingPledges.supporterName, pledgeContact: fundraisingPledges.contactId, reversed: sql<boolean>`${reversal}`,
    }).from(givingLedgerEntries).innerJoin(users, eq(users.id, givingLedgerEntries.confirmedBy))
      .leftJoin(givingContactLinks, and(eq(givingContactLinks.tenantId, givingLedgerEntries.tenantId), eq(givingContactLinks.entryId, givingLedgerEntries.id)))
      .leftJoin(fundraisingPledges, and(eq(fundraisingPledges.tenantId, givingLedgerEntries.tenantId), eq(fundraisingPledges.id, givingLedgerEntries.pledgeId)))
      .where(and(eq(givingLedgerEntries.tenantId, tenantId), eq(givingLedgerEntries.fundraisingId, id)))
      .orderBy(desc(givingLedgerEntries.confirmedAt), desc(givingLedgerEntries.id)).limit(PAGE);
    await audit(tx, tenantId, userId, "giving.donors.read", id, { view: "gifts" });
    return rows.map(({ linkName, linkContact, pledgeName, pledgeContact, ...row }): GiftRow => ({
      ...row, amountCents: row.amountCents.toString(), confirmedAt: row.confirmedAt.toISOString(), reversed: Boolean(row.reversed),
      supporterName: linkName ?? pledgeName ?? null, contactId: linkContact ?? pledgeContact ?? null,
    }));
  });
}

async function replay(tx: Transaction, tenantId: string, idempotencyKey: string, fingerprint: string) {
  const [existing] = await tx.select({ id: givingLedgerEntries.id, fingerprint: givingLedgerEntries.fingerprint }).from(givingLedgerEntries)
    .where(and(eq(givingLedgerEntries.tenantId, tenantId), eq(givingLedgerEntries.idempotencyKey, idempotencyKey)));
  if (!existing) return null;
  if (existing.fingerprint !== fingerprint) throw fail(409, "Fundraising.idempotencyConflict");
  return existing.id;
}

/** Records a gift the ministry confirmed outside Harvest (amount, date, optional pledge or supporter, method as free text). Owners and admins. */
export async function recordGift(db: Database, userId: string, workspace: string, fundraising: string, data: unknown, key: unknown) {
  const id = uuidInput.parse(fundraising), input = giftCreateInput.parse(data), idempotencyKey = idempotencyKeyInput.parse(key);
  return mapped(withTenant(db, userId, uuidInput.parse(workspace), "giving:record", async (tx, tenantId) => {
    const campaign = await campaignForRecords(tx, tenantId, id);
    if (campaign.status === "archived") throw fail(409, "Fundraising.archived");
    if (input.pledgeId) {
      const [pledge] = await tx.select({ status: fundraisingPledges.status }).from(fundraisingPledges)
        .where(and(eq(fundraisingPledges.tenantId, tenantId), eq(fundraisingPledges.fundraisingId, id), eq(fundraisingPledges.id, input.pledgeId)));
      if (!pledge) throw fail(404, "Fundraising.pledgeNotFound");
      if (pledge.status === "cancelled") throw fail(409, "Fundraising.pledgeCancelled");
    }
    // A gift recorded against a pledge takes its supporter from the pledge; otherwise the optional supporter goes in the detachable link row.
    const contactId = input.pledgeId ? null : await liveContact(tx, tenantId, input.contactId), supporterName = input.pledgeId ? null : input.supporterName;
    const values = { fundraisingId: id, amountCents: input.amountCents, giftDate: input.giftDate, pledgeId: input.pledgeId, methodLabel: input.methodLabel, reference: input.reference, contactId, supporterName };
    const fingerprint = workFingerprint("giving.gift", values);
    const [inserted] = await tx.insert(givingLedgerEntries).values({ tenantId, fundraisingId: id, pledgeId: input.pledgeId, amountCents: BigInt(input.amountCents), currency: campaign.currency,
      kind: "gift", giftDate: input.giftDate, methodLabel: input.methodLabel, reference: input.reference, confirmedBy: userId, idempotencyKey, fingerprint })
      .onConflictDoNothing().returning({ id: givingLedgerEntries.id });
    if (!inserted) return { id: (await replay(tx, tenantId, idempotencyKey, fingerprint)) ?? (() => { throw fail(409, "Fundraising.conflict"); })() };
    if (contactId || supporterName) await tx.insert(givingContactLinks).values({ tenantId, entryId: inserted.id, contactId, supporterName, createdBy: userId });
    await audit(tx, tenantId, userId, "giving.gift.confirm", inserted.id, { fundraising: id, ...(input.pledgeId ? { pledge: input.pledgeId } : {}) });
    return { id: inserted.id };
  }));
}

/**
 * Corrects a gift: appends its exact reversal and, when a replacement amount is given, one new gift in the same chain. The original row never changes.
 * One reversal per gift (unique index), so a second or concurrent correction of the same gift is refused; a retried request replays.
 */
export async function correctGift(db: Database, userId: string, workspace: string, fundraising: string, entry: string, data: unknown, key: unknown) {
  const id = uuidInput.parse(fundraising), entryId = uuidInput.parse(entry), input = giftCorrectionInput.parse(data), idempotencyKey = idempotencyKeyInput.parse(key);
  return mapped(withTenant(db, userId, uuidInput.parse(workspace), "giving:correct", async (tx, tenantId) => {
    await campaignForRecords(tx, tenantId, id);
    const [original] = await tx.select().from(givingLedgerEntries)
      .where(and(eq(givingLedgerEntries.tenantId, tenantId), eq(givingLedgerEntries.fundraisingId, id), eq(givingLedgerEntries.id, entryId)));
    if (!original) throw notFound();
    if (original.kind !== "gift") throw fail(409, "Fundraising.invalidTransition");
    const fingerprint = workFingerprint("giving.correct", { entryId, reason: input.reason, replacementCents: input.replacementCents, replacementDate: input.replacementDate });
    const today = new Date().toISOString().slice(0, 10);
    const [reversal] = await tx.insert(givingLedgerEntries).values({ tenantId, fundraisingId: id, pledgeId: original.pledgeId, amountCents: -original.amountCents, currency: original.currency,
      kind: "reversal", correctionOf: entryId, reason: input.reason, giftDate: today, confirmedBy: userId, idempotencyKey, fingerprint })
      .onConflictDoNothing().returning({ id: givingLedgerEntries.id });
    if (!reversal) {
      const replayed = await replay(tx, tenantId, idempotencyKey, fingerprint);
      if (!replayed) throw fail(409, "Fundraising.alreadyCorrected");
      const [again] = await tx.select({ id: givingLedgerEntries.id }).from(givingLedgerEntries)
        .where(and(eq(givingLedgerEntries.tenantId, tenantId), eq(givingLedgerEntries.correctionOf, entryId), eq(givingLedgerEntries.kind, "gift")));
      return { reversalId: replayed, replacementId: again?.id ?? null };
    }
    let replacementId: string | null = null;
    if (input.replacementCents) {
      const [replacement] = await tx.insert(givingLedgerEntries).values({ tenantId, fundraisingId: id, pledgeId: original.pledgeId, amountCents: BigInt(input.replacementCents),
        currency: original.currency, kind: "gift", correctionOf: entryId, giftDate: input.replacementDate!, methodLabel: original.methodLabel, reference: original.reference,
        confirmedBy: userId, idempotencyKey: `${idempotencyKey.slice(0, 180)}:replacement`, fingerprint }).returning({ id: givingLedgerEntries.id });
      replacementId = replacement.id;
      const [link] = await tx.select().from(givingContactLinks).where(and(eq(givingContactLinks.tenantId, tenantId), eq(givingContactLinks.entryId, entryId)));
      if (link) await tx.insert(givingContactLinks).values({ tenantId, entryId: replacementId, contactId: link.contactId, supporterName: link.supporterName, createdBy: userId });
    }
    await audit(tx, tenantId, userId, "giving.gift.correct", entryId, { fundraising: id, reason: input.reason, reversal: reversal.id, ...(replacementId ? { replacement: replacementId } : {}) });
    return { reversalId: reversal.id, replacementId };
  }));
}
