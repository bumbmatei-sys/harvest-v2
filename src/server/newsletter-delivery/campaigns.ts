import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { auditLogs, crmSavedViews, newsletterCampaigns, newsletterLists, newsletterRevisions, newsletterSegments,
  newsletterSenders, newsletterTemplates } from "../../db/schema";
import { message } from "../../i18n/messages";
import { viewState } from "../../lib/crm-fields";
import { newsletterPage } from "../../lib/newsletter";
import { loadDefinitions, resolveState } from "../crm-filters";
import { AccessError } from "../permissions";
import { newsletterMissing, withNewsletter } from "../newsletter-access";
import { newsletterContent, newsletterLinkCount, renderNewsletter } from "./render";
import { assertFakeNewsletter, type FakeNewsletterRuntime } from "./registry";

const id = z.uuid();
const version = z.number().int().positive().max(2_147_483_646);
const line = (max: number, min = 0) => z.string().trim().min(min).max(max).regex(/^[^\x00-\x1f\x7f]*$/);
const content = z.unknown().transform((value, context) => {
  const clean = newsletterContent(value);
  if (clean) return clean;
  context.addIssue({ code: "custom", message: "Invalid newsletter content" });
  return z.NEVER;
});
const audienceSelection = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), listId: id }).strict(),
  z.object({ kind: z.literal("segment"), listId: id, segmentId: id }).strict(),
  z.object({ kind: z.literal("view"), viewId: id }).strict(),
]);
const draft = z.object({
  subject: line(150, 1), previewText: line(200).default(""), senderId: id, audience: audienceSelection, content,
}).strict();
const senderEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());
const senderInput = z.object({ name: line(100, 1), email: senderEmail, replyTo: senderEmail, postalAddress: line(240, 1) }).strict();
const templateInput = z.object({ name: line(100, 1), content }).strict();
export const newsletterTimeZone = z.string().max(80).refine(zone => {
  if (zone !== "UTC" && !/^[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z0-9_+-]+)+$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
});
const reviewInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("now"), version, timeZone: newsletterTimeZone }).strict(),
  z.object({ mode: z.literal("schedule"), version, timeZone: newsletterTimeZone,
    scheduledFor: z.iso.datetime({ offset: true }).refine(value => Date.parse(value) > Date.now()) }).strict(),
]);
const conflict = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
const audit = (tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, revision?: number) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata: revision ? { version: String(revision) } : {} });

export async function savedNewsletterView(tx: Transaction, tenant: string, viewId: string, pinned?: number, segment = false) {
  const [view] = await tx.select().from(crmSavedViews).where(and(eq(crmSavedViews.tenantId, tenant),
    eq(crmSavedViews.id, viewId), eq(crmSavedViews.objectType, "person"), isNull(crmSavedViews.ownerUserId),
    pinned === undefined ? undefined : eq(crmSavedViews.version, pinned)));
  if (!view) throw newsletterMissing();
  const parsed = viewState.parse(view.state);
  if (segment && parsed.sources.length) throw newsletterMissing();
  const definitions = await loadDefinitions(tx, tenant, "person");
  return { version: view.version, state: resolveState("person", parsed, definitions), definitions };
}

async function audienceRefs(tx: Transaction, tenant: string, selection: z.infer<typeof audienceSelection>) {
  if (selection.kind === "view") {
    const view = await savedNewsletterView(tx, tenant, selection.viewId);
    return { viewId: selection.viewId, viewVersion: view.version };
  }
  const [list] = await tx.select().from(newsletterLists).where(and(eq(newsletterLists.tenantId, tenant), eq(newsletterLists.id, selection.listId)));
  if (!list) throw newsletterMissing();
  if (selection.kind === "list") return { listId: list.id };
  const [segment] = await tx.select().from(newsletterSegments).where(and(eq(newsletterSegments.tenantId, tenant),
    eq(newsletterSegments.audienceId, list.audienceId), eq(newsletterSegments.id, selection.segmentId)));
  if (!segment) throw newsletterMissing();
  await savedNewsletterView(tx, tenant, segment.savedViewId, segment.savedViewVersion, true);
  return { listId: list.id, segmentId: segment.id, viewId: segment.savedViewId, viewVersion: segment.savedViewVersion };
}

function campaignWhere(tenant: string, campaign: string) {
  const parsed = id.safeParse(campaign);
  if (!parsed.success) throw newsletterMissing();
  return and(eq(newsletterCampaigns.tenantId, tenant), eq(newsletterCampaigns.id, parsed.data));
}

async function readDraft(tx: Transaction, tenant: string, campaign: string) {
  const [row] = await tx.select({ campaign: newsletterCampaigns, revision: newsletterRevisions }).from(newsletterCampaigns)
    .innerJoin(newsletterRevisions, and(eq(newsletterRevisions.tenantId, newsletterCampaigns.tenantId),
      eq(newsletterRevisions.campaignId, newsletterCampaigns.id), eq(newsletterRevisions.version, newsletterCampaigns.revision)))
    .where(campaignWhere(tenant, campaign));
  if (!row) throw newsletterMissing();
  const { id, tenantId, status, revision, approvedRevision, approvedBy, scheduledFor, timeZone, createdAt } = row.campaign;
  return { campaign: { id, tenantId, status, revision, approvedRevision, approvedBy, scheduledFor, timeZone, createdAt }, revision: row.revision };
}

export function getNewsletterCampaign(db: Database, actor: string, workspace: string, campaign: string) {
  return withNewsletter(db, actor, workspace, "newsletter:read", (tx, tenant) => readDraft(tx, tenant, campaign));
}

export function saveNewsletterCampaign(db: Database, actor: string, workspace: string, raw: unknown, campaign?: string) {
  return withNewsletter(db, actor, workspace, "newsletter:manage", async (tx, tenantId) => {
    const { expectedVersion, ...values } = draft.extend({ expectedVersion: version.optional() }).parse(raw);
    if ((campaign === undefined) !== (expectedVersion === undefined)) throw conflict();
    const [sender] = await tx.select({ id: newsletterSenders.id }).from(newsletterSenders)
      .where(and(eq(newsletterSenders.tenantId, tenantId), eq(newsletterSenders.id, values.senderId), isNull(newsletterSenders.disabledAt)));
    if (!sender) throw newsletterMissing();
    const { audience, ...definition } = values;
    const refs = await audienceRefs(tx, tenantId, audience);
    let revision = 1;
    if (campaign !== undefined) {
      const where = campaignWhere(tenantId, campaign);
      const [current] = await tx.select().from(newsletterCampaigns).where(where).for("update");
      if (!current) throw newsletterMissing();
      if (current.status !== "draft" || current.revision !== expectedVersion) throw conflict();
      revision = current.revision + 1;
      await tx.update(newsletterCampaigns).set({ revision }).where(where);
    } else {
      campaign = randomUUID();
      await tx.execute(sql`insert into public.newsletter_campaigns(tenant_id,id) values(${tenantId}::uuid,${campaign}::uuid)`);
    }
    await tx.insert(newsletterRevisions).values({ ...definition, ...refs, tenantId, campaignId: campaign, version: revision,
      linkCount: newsletterLinkCount(definition.content) });
    await audit(tx, tenantId, actor, "newsletter.campaign.save", campaign, revision);
    return readDraft(tx, tenantId, campaign);
  });
}

export function reviewNewsletterCampaign(db: Database, actor: string, workspace: string, campaign: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:review", async (tx, tenant) => {
    const input = reviewInput.parse(raw);
    await readDraft(tx, tenant, campaign);
    const scheduled = input.mode === "schedule" ? input.scheduledFor : null;
    const { rows: [row] } = await tx.execute<{ changed: boolean }>(sql`select public.newsletter_review(
      ${tenant}::uuid,${campaign}::uuid,${input.version},${scheduled}::timestamptz,${input.timeZone}) as changed`);
    if (!row.changed) throw conflict();
    await audit(tx, tenant, actor, "newsletter.campaign.review", campaign, input.version);
    return readDraft(tx, tenant, campaign);
  });
}

export function cancelNewsletterCampaign(db: Database, actor: string, workspace: string, campaign: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:review", async (tx, tenant) => {
    const input = z.object({ version }).strict().parse(raw);
    const current = await readDraft(tx, tenant, campaign);
    const { rows: [row] } = await tx.execute<{ changed: boolean }>(sql`select public.newsletter_cancel(
      ${tenant}::uuid,${campaign}::uuid,${input.version}) as changed`);
    if (!row.changed) throw conflict();
    if (current.campaign.status !== "cancelled") await audit(tx, tenant, actor, "newsletter.campaign.cancel", campaign, input.version);
    return readDraft(tx, tenant, campaign);
  });
}

export function listNewsletterDeliveryConfig(db: Database, actor: string, workspace: string, kind: "campaigns" | "templates" | "senders", raw: unknown) {
  const table = { campaigns: newsletterCampaigns, templates: newsletterTemplates, senders: newsletterSenders }[kind];
  return withNewsletter(db, actor, workspace, "newsletter:read", async (tx, tenant) => {
    const { after, limit } = newsletterPage.pick({ after: true, limit: true }).parse(raw);
    const scope = and(eq(table.tenantId, tenant), after ? gt(table.id, after) : undefined);
    if (kind === "campaigns") {
      const rows = await tx.select({
        id: newsletterCampaigns.id, status: newsletterCampaigns.status, version: newsletterCampaigns.revision,
        approvedRevision: newsletterCampaigns.approvedRevision, scheduledFor: newsletterCampaigns.scheduledFor,
        timeZone: newsletterCampaigns.timeZone, createdAt: newsletterCampaigns.createdAt, subject: newsletterRevisions.subject,
        previewText: newsletterRevisions.previewText, senderId: newsletterRevisions.senderId,
      }).from(newsletterCampaigns).innerJoin(newsletterRevisions, and(eq(newsletterRevisions.tenantId, newsletterCampaigns.tenantId),
        eq(newsletterRevisions.campaignId, newsletterCampaigns.id), eq(newsletterRevisions.version, newsletterCampaigns.revision)))
        .where(scope).orderBy(asc(newsletterCampaigns.id)).limit(limit + 1);
      return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
    }
    const rows = await tx.select().from(table).where(scope).orderBy(asc(table.id)).limit(limit + 1);
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
  });
}

export function createNewsletterSender(db: Database, actor: string, workspace: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:manage", async (tx, tenantId) => {
    const { name, email, replyTo, postalAddress } = senderInput.parse(raw);
    const senderId = randomUUID();
    await tx.execute(sql`insert into public.newsletter_senders(tenant_id,id,name,email,reply_to,postal_address)
      values(${tenantId}::uuid,${senderId}::uuid,${name},${email},${replyTo},${postalAddress})`);
    const [sender] = await tx.select().from(newsletterSenders)
      .where(and(eq(newsletterSenders.tenantId, tenantId), eq(newsletterSenders.id, senderId)));
    await audit(tx, tenantId, actor, "newsletter.sender.create", sender.id);
    return sender;
  });
}

export function disableNewsletterSender(db: Database, actor: string, workspace: string, sender: string) {
  return withNewsletter(db, actor, workspace, "newsletter:manage", async (tx, tenant) => {
    const valid = id.safeParse(sender);
    if (!valid.success) throw newsletterMissing();
    const { rows: [row] } = await tx.execute<{ changed: boolean }>(sql`select public.newsletter_disable_sender(
      ${tenant}::uuid,${sender}::uuid) as changed`);
    if (!row.changed) throw newsletterMissing();
    await audit(tx, tenant, actor, "newsletter.sender.disable", sender);
    return { id: sender, disabled: true };
  });
}

export function saveNewsletterTemplate(db: Database, actor: string, workspace: string, raw: unknown, template?: string) {
  return withNewsletter(db, actor, workspace, "newsletter:manage", async (tx, tenantId) => {
    const { expectedVersion, ...values } = templateInput.extend({ expectedVersion: version.optional() }).parse(raw);
    if ((template === undefined) !== (expectedVersion === undefined)) throw conflict();
    if (template === undefined) {
      const [saved] = await tx.insert(newsletterTemplates).values({ ...values, tenantId }).returning();
      await audit(tx, tenantId, actor, "newsletter.template.save", saved.id, saved.version);
      return saved;
    }
    const parsed = id.safeParse(template);
    if (!parsed.success) throw newsletterMissing();
    const where = and(eq(newsletterTemplates.tenantId, tenantId), eq(newsletterTemplates.id, parsed.data));
    const [current] = await tx.select({ version: newsletterTemplates.version }).from(newsletterTemplates).where(where);
    if (!current) throw newsletterMissing();
    const [saved] = await tx.update(newsletterTemplates).set({ ...values, version: current.version + 1 })
      .where(and(where, eq(newsletterTemplates.version, expectedVersion!))).returning();
    if (!saved) throw conflict();
    await audit(tx, tenantId, actor, "newsletter.template.save", saved.id, saved.version);
    return saved;
  });
}

async function previewInput(db: Database, actor: string, workspace: string, campaign: string) {
  return withNewsletter(db, actor, workspace, "newsletter:read", async (tx, tenant) => {
    const { revision } = await readDraft(tx, tenant, campaign);
    const [sender] = await tx.select().from(newsletterSenders)
      .where(and(eq(newsletterSenders.tenantId, tenant), eq(newsletterSenders.id, revision.senderId)));
    return { revision, sender };
  });
}
const previewUnsubscribe = "https://preview.example.test/api/newsletter/unsubscribe";
export async function previewNewsletterCampaign(db: Database, actor: string, workspace: string, campaign: string) {
  const { revision, sender } = await previewInput(db, actor, workspace, campaign);
  const rendered = renderNewsletter(revision.content, { ...sender, unsubscribe: previewUnsubscribe });
  return { subject: revision.subject, previewText: revision.previewText, html: rendered.html, text: rendered.text };
}

export async function testNewsletterCampaign(db: Database, actor: string, workspace: string, campaign: string, runtime: FakeNewsletterRuntime) {
  assertFakeNewsletter(runtime);
  const { revision } = await previewInput(db, actor, workspace, campaign);
  const sender = { name: "Newsletter Preview", email: "sender@example.test", replyTo: "replies@example.test", postalAddress: "Preview address" };
  const rendered = renderNewsletter(revision.content, { ...sender, unsubscribe: previewUnsubscribe });
  const { outcome } = await runtime.provider.deliver(runtime.credential, { ...rendered, tenantId: revision.tenantId, key: randomUUID(),
    sender, recipient: "preview@example.test", unsubscribe: previewUnsubscribe, subject: revision.subject,
    previewText: revision.previewText, trackClicks: false, trackOpens: false });
  await withNewsletter(db, actor, workspace, "newsletter:manage",
    (tx, tenant) => audit(tx, tenant, actor, `newsletter.campaign.test.${outcome}`, campaign, revision.version));
  return { outcome };
}
