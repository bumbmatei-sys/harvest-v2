import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { newsletterCampaigns as campaigns, newsletterCampaignRevisions as revisions, newsletterCampaignLists as lists,
  newsletterCampaignSegments as segments } from "../../db/schema";
import { message } from "../../i18n/messages";
import { newsletterContent, newsletterStarters } from "../../lib/newsletter-content";
import { assertMailingAddress } from "./sender-setup";
import { audit, campaignPreview, conflict, digest, id, pageInput, unavailable, version, withNewsletter } from "./access";
import { assertVerified, identity } from "./identities";
import { draftSelectionInput, resolveRecipients, selectionPins } from "./recipients";
import { newsletterReviewLifetimeMs, newsletterScheduleHorizonMs, scheduleInput, type NewsletterSchedule } from "./schedule";
import { readTemplate } from "./templates";
import { AccessError } from "../permissions";
import { FakeNewsletterProvider } from "./fake-provider";

const header = z.string().trim().min(1).regex(/^[^\u0000-\u001f\u007f]+$/);
const draftInput = z.object({
  name: z.string().trim().min(1).max(100), subject: header.max(150),
  preheader: header.max(200).nullable().default(null), senderId: z.uuid().nullable().default(null),
  replyToId: z.uuid().nullable().default(null), selection: draftSelectionInput,
  content: newsletterContent.optional(), templateId: z.uuid().optional(),
  starterId: z.enum(["ministry-update", "event-invitation", "weekly-digest"]).optional(),
}).strict();
const validDraft = (v: z.infer<typeof draftInput>) => [v.content, v.templateId, v.starterId].filter(Boolean).length === 1;
const reviewInput = z.object({ version, dispatch: scheduleInput }).strict();
const dispatchInput = reviewInput.extend({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const scheduleTooFar = () => new AccessError(400, message("NewsletterEmail.scheduleTooFar"), { code: "SCHEDULE_TOO_FAR" });

function parseReviewInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  if (result.error.issues.some(issue => issue.message === message("NewsletterEmail.scheduleTooFar"))) throw scheduleTooFar();
  throw result.error;
}
const versionInput = z.object({ version }).strict();

function scope(tenant: string, campaign: string) {
  return and(eq(campaigns.tenantId, tenant), eq(campaigns.id, id(campaign)));
}

async function readCampaign(tx: Transaction, tenant: string, campaignId: string, lock = false) {
  const query = tx.select().from(campaigns).where(scope(tenant, campaignId));
  const [campaign] = lock ? await query.for("update") : await query;
  if (!campaign) throw unavailable();
  const revisionScope = (table: typeof revisions | typeof lists | typeof segments) => and(eq(table.tenantId, tenant),
    eq(table.campaignId, campaign.id), eq(table.revision, campaign.revision));
  const [revision] = await tx.select().from(revisions).where(revisionScope(revisions));
  if (!revision) throw unavailable();
  const listPins = await tx.select().from(lists).where(revisionScope(lists)).orderBy(asc(lists.listId));
  const segmentPins = await tx.select().from(segments).where(revisionScope(segments)).orderBy(asc(segments.segmentId));
  return { campaign, revision, listPins, segmentPins };
}

function campaignResponse({ campaign, revision, listPins, segmentPins }: Awaited<ReturnType<typeof readCampaign>>) {
  return { id: campaign.id, name: campaign.name, version: campaign.version, revision: campaign.revision, state: campaign.state,
    scheduledAt: campaign.scheduledAt, timezone: campaign.timezone, frozenAt: campaign.frozenAt,
    subject: revision.subject, preheader: revision.preheader, senderId: revision.senderId, replyToId: revision.replyToId,
    content: revision.content, plainText: revision.plainText,
    selection: { listIds: listPins.map(pin => pin.listId), segmentIds: segmentPins.flatMap(pin => pin.segmentId ?? []) },
    selectionNeedsReview: segmentPins.some(pin => pin.segmentId === null) };
}

export function listCampaigns(db: Database, actor: string, workspace: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const page = pageInput.parse(raw);
    const rows = await tx.select({ id: campaigns.id, name: campaigns.name, revision: campaigns.revision, state: campaigns.state,
      version: campaigns.version, scheduledAt: campaigns.scheduledAt, timezone: campaigns.timezone })
      .from(campaigns).where(and(eq(campaigns.tenantId, tenant), page.after ? gt(campaigns.id, page.after) : undefined))
      .orderBy(asc(campaigns.id)).limit(page.limit + 1);
    return { items: rows.slice(0, page.limit), nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null };
  });
}

export function getCampaign(db: Database, actor: string, workspace: string, campaign: string) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) =>
    campaignResponse(await readCampaign(tx, tenant, campaign)));
}

async function saveDraft(tx: Transaction, tenant: string, actor: string, input: z.infer<typeof draftInput>,
  previous?: Awaited<ReturnType<typeof readCampaign>>["campaign"]) {
  const content = input.content ?? (input.templateId ? (await readTemplate(tx, tenant, input.templateId)).content :
    newsletterStarters.find(starter => starter.id === input.starterId)!.content);
  const pins = await selectionPins(tx, tenant, input.selection);
  if (input.senderId) await identity(tx, tenant, input.senderId);
  if (input.replyToId) await identity(tx, tenant, input.replyToId);
  const preview = await campaignPreview(tx, tenant, content, input.preheader);
  const [campaign] = previous ? await tx.update(campaigns).set({
    name: input.name, version: previous.version + 1, revision: previous.revision + 1, state: "draft", reviewDigest: null, reviewExpiresAt: null,
    scheduledAt: null, timezone: null, senderVersion: null, replyVersion: null, senderDomainVersion: null,
  }).where(scope(tenant, previous.id)).returning()
    : await tx.insert(campaigns).values({ tenantId: tenant, name: input.name, createdBy: actor }).returning();
  const key = { tenantId: tenant, campaignId: campaign.id, revision: campaign.revision };
  const [revision] = await tx.insert(revisions).values({ ...key, content, subject: input.subject, preheader: input.preheader,
    senderId: input.senderId, replyToId: input.replyToId, plainText: preview.text }).returning();
  // A draft may start without a list; review requires one.
  const listPins = pins.lists.length ? await tx.insert(lists).values(pins.lists.map(list => ({ ...key, listId: list.id, listVersion: list.version }))).returning() : [];
  const segmentPins = pins.segments.length ? await tx.insert(segments).values(pins.segments.map(segment => ({
    ...key, segmentId: segment.id, segmentVersion: segment.version,
  }))).returning() : [];
  await audit(tx, tenant, actor, previous ? "newsletter.campaign.edit" : "newsletter.campaign.create", campaign.id, campaign.version);
  return { ...campaignResponse({ campaign, revision, listPins, segmentPins }), preview };
}

export function writeCampaign(db: Database, actor: string, workspace: string, raw: unknown, campaignId?: string) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    if (!campaignId) return saveDraft(tx, tenant, actor, draftInput.refine(validDraft).parse(raw));
    const input = draftInput.extend({ version }).refine(validDraft).parse(raw);
    const { campaign } = await readCampaign(tx, tenant, campaignId, true);
    if (campaign.version !== input.version || !["draft", "reviewed"].includes(campaign.state) || campaign.frozenAt) throw conflict("STALE_VERSION");
    return saveDraft(tx, tenant, actor, input, campaign);
  });
}

export function duplicateCampaign(db: Database, actor: string, workspace: string, campaignId: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const row = await readCampaign(tx, tenant, campaignId);
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(raw);
    const { content, subject, preheader, senderId, replyToId, selection, selectionNeedsReview } = campaignResponse(row);
    if (selectionNeedsReview) throw conflict("SELECTION_CHANGED");
    return saveDraft(tx, tenant, actor, { name, content, subject, preheader, senderId, replyToId, selection });
  });
}

async function reviewData(tx: Transaction, tenant: string, row: Awaited<ReturnType<typeof readCampaign>>, dispatch: NewsletterSchedule) {
  const { campaign, revision, listPins, segmentPins } = row;
  if (!revision.senderId || !revision.replyToId) throw conflict("IDENTITY_REQUIRED");
  const from = await identity(tx, tenant, revision.senderId);
  const reply = await identity(tx, tenant, revision.replyToId);
  assertVerified(from, true);
  assertVerified(reply, false);
  await assertMailingAddress(tx, tenant, revision.content);
  if (segmentPins.some(pin => !pin.segmentId)) throw conflict("SELECTION_CHANGED");
  if (!listPins.length) throw conflict("SELECTION_REQUIRED");
  const selection = { listIds: listPins.map(pin => pin.listId), segmentIds: segmentPins.map(pin => pin.segmentId!) };
  const pins = await selectionPins(tx, tenant, selection);
  if (pins.lists.some((list, index) => list.version !== listPins[index].listVersion) ||
      pins.segments.some((segment, index) => segment.version !== segmentPins[index].segmentVersion)) throw conflict("SELECTION_CHANGED");
  const { recipients, estimate } = await resolveRecipients(tx, tenant, selection, pins);
  const preview = { subject: revision.subject, preheader: revision.preheader, ...(await campaignPreview(tx, tenant, revision.content, revision.preheader)) };
  if (dispatch.mode === "schedule" && Date.parse(dispatch.schedule.at) <= Date.now()) throw conflict("SCHEDULE_IN_PAST");
  const identities = {
    senderVersion: from.identity.version, replyVersion: reply.identity.version,
    senderDomainVersion: from.domain!.version,
  };
  const summary = { from: from.identity.address, replyTo: reply.identity.address, preview, estimate, dispatch,
    lists: pins.lists.map(({ id, name }) => ({ id, name })), segments: pins.segments.map(({ id, version }) => ({ id, version })) };
  const fingerprint = JSON.stringify([tenant, campaign.id, revision.revision, identities, summary, recipients]);
  return { summary, identities, fingerprint, recipients };
}

export function reviewCampaign(db: Database, actor: string, workspace: string, campaignId: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const input = parseReviewInput(reviewInput, raw);
    const row = await readCampaign(tx, tenant, campaignId, true);
    if (row.campaign.version !== input.version || !["draft", "reviewed"].includes(row.campaign.state)) throw conflict("STALE_VERSION");
    const review = await reviewData(tx, tenant, row, input.dispatch);
    const token = randomBytes(32).toString("base64url");
    const [saved] = await tx.update(campaigns).set({ version: input.version + 1, state: "reviewed", ...review.identities,
      reviewExpiresAt: sql`statement_timestamp() + ${newsletterReviewLifetimeMs} * interval '1 millisecond'`,
      reviewDigest: digest(token + review.fingerprint) }).where(scope(tenant, campaignId))
      .returning({ expiresAt: campaigns.reviewExpiresAt });
    const expiresAt = saved.expiresAt!;
    if (input.dispatch.mode === "schedule" &&
        Date.parse(input.dispatch.schedule.at) > expiresAt.getTime() - newsletterReviewLifetimeMs + newsletterScheduleHorizonMs) {
      throw scheduleTooFar();
    }
    await audit(tx, tenant, actor, "newsletter.campaign.review", campaignId, input.version + 1);
    return { ...review.summary, token, expiresAt, version: input.version + 1 };
  });
}

export function dispatchCampaign(db: Database, actor: string, workspace: string, campaignId: string, raw: unknown, mode: NewsletterSchedule["mode"]) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const input = parseReviewInput(dispatchInput, raw);
    const row = await readCampaign(tx, tenant, campaignId, true);
    if (input.dispatch.mode !== mode || row.campaign.version !== input.version ||
        row.campaign.state !== "reviewed" || !row.campaign.reviewDigest) throw conflict("REVIEW_REQUIRED");
    const review = await reviewData(tx, tenant, row, input.dispatch);
    if (!row.campaign.reviewExpiresAt || row.campaign.reviewExpiresAt.getTime() <= Date.now() ||
        !timingSafeEqual(Buffer.from(row.campaign.reviewDigest, "hex"), Buffer.from(digest(input.token + review.fingerprint), "hex"))) {
      throw conflict("REVIEW_REQUIRED");
    }
    const scheduledAt = mode === "schedule" && input.dispatch.mode === "schedule" ? new Date(input.dispatch.schedule.at) : new Date();
    if (scheduledAt.getTime() > row.campaign.reviewExpiresAt.getTime() - newsletterReviewLifetimeMs + newsletterScheduleHorizonMs) {
      throw scheduleTooFar();
    }
    const timezone = input.dispatch.mode === "schedule" ? input.dispatch.schedule.timezone : "UTC";
    const state = review.summary.estimate.eligible ? "scheduled" : "failed";
    const selectedAt = new Date();
    for (let offset = 0; offset < review.recipients.length; offset += 250) {
      const values = review.recipients.slice(offset, offset + 250).map(recipient => {
        const binding = recipient.reason ? null : recipient.addressId + ":" + recipient.contactVersion;
        const deliveryState = recipient.reason ? "skipped" : "queued";
        return sql`(${tenant}::uuid,${campaignId}::uuid,${row.campaign.revision},${recipient.subscriberId}::uuid,
          ${recipient.listId}::uuid,${recipient.subscriptionVersion},${binding},${deliveryState},${recipient.reason},
          ${selectedAt.toISOString()}::timestamptz,${scheduledAt.toISOString()}::timestamptz)`;
      });
      await tx.execute(sql`
        insert into public.newsletter_deliveries
          (tenant_id,campaign_id,revision,subscriber_id,list_id,subscription_version,address_binding,state,skip_reason,selected_at,next_check_at)
        values ${sql.join(values, sql`,`)}`);
    }
    await tx.update(campaigns).set({ state, version: input.version + 1, scheduledAt, timezone, reviewDigest: null, reviewExpiresAt: null,
      frozenAt: selectedAt }).where(scope(tenant, campaignId));
    await audit(tx, tenant, actor, "newsletter.campaign.dispatch", campaignId, input.version + 1);
    return { state, scheduledAt, timezone, version: input.version + 1, deliveryMode: "synthetic" };
  });
}

export function cancelCampaign(db: Database, actor: string, workspace: string, campaignId: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const input = versionInput.parse(raw);
    const { campaign } = await readCampaign(tx, tenant, campaignId, true);
    if (campaign.version !== input.version || !["draft", "reviewed", "scheduled", "sending"].includes(campaign.state)) throw conflict("STALE_VERSION");
    await tx.update(campaigns).set({ state: "cancelled", reviewDigest: null, reviewExpiresAt: null, version: input.version + 1 }).where(scope(tenant, campaignId));
    await tx.execute(sql`select public.newsletter_cancel_queued(${tenant}::uuid,${campaignId}::uuid)`);
    await audit(tx, tenant, actor, "newsletter.campaign.cancel", campaignId, input.version + 1);
    return { state: "cancelled", version: input.version + 1 };
  });
}

export function testCampaign(db: Database, actor: string, workspace: string, campaignId: string, adminAddress: string | undefined) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    if (!z.email().safeParse(adminAddress).success) throw unavailable();
    const { revision } = await readCampaign(tx, tenant, campaignId);
    if (!revision.senderId || !revision.replyToId) throw conflict("IDENTITY_REQUIRED");
    const sender = await identity(tx, tenant, revision.senderId);
    const reply = await identity(tx, tenant, revision.replyToId);
    assertVerified(sender, true);
    assertVerified(reply, false);
    return { to: adminAddress!, from: sender.identity.address, replyTo: reply.identity.address,
      subject: message("NewsletterEmail.testSubject", { subject: revision.subject }),
      preheader: revision.preheader, ...(await campaignPreview(tx, tenant, revision.content, revision.preheader)) };
  }).then(async preview => {
    const result = await new FakeNewsletterProvider().submit({ ...preview, deliveryId: randomUUID() });
    return { test: true, mailbox: "synthetic", state: result.state };
  });
}

/** Test send for the editor: the synthetic sink only, so it needs no verified sender. The message is rendered exactly as a real one would be. */
export function testCampaignToSink(db: Database, actor: string, workspace: string, campaignId: string, adminAddress: string | undefined) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    if (!z.email().safeParse(adminAddress).success) throw unavailable();
    const { revision } = await readCampaign(tx, tenant, campaignId);
    return { to: adminAddress!, from: "test@newsletter.example.test", replyTo: "test@newsletter.example.test",
      subject: message("NewsletterEmail.testSubject", { subject: revision.subject }), preheader: revision.preheader,
      ...(await campaignPreview(tx, tenant, revision.content, revision.preheader)) };
  }).then(async preview => {
    const result = await new FakeNewsletterProvider().submit({ ...preview, deliveryId: randomUUID() });
    return { test: true, mailbox: "synthetic", state: result.state };
  });
}
