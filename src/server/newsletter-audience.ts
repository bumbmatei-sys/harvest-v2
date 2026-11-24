import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, contacts, crmSavedViews, newsletterAudiences, newsletterCampaignLists, newsletterCampaignSegments, newsletterCampaigns, newsletterImportProvenance, newsletterLists, newsletterSegments, newsletterSubscribers, newsletterSubscriptions } from "../db/schema";
import { message } from "../i18n/messages";
import { fullState, viewState, type ViewState } from "../lib/crm-fields";
import { mayContact } from "./consent-gate";
import { consentState, loadDefinitions, resolveState } from "./crm-filters";
import { listContacts, peopleQuery, type ListExtension } from "./contacts";
import { segmentState } from "./newsletter";
import { audit as auditVersion, conflict, unavailable, withNewsletter } from "./newsletter-campaigns/access";
import { AccessError } from "./permissions";

/**
 * The newsletter Audience is a lens over CRM people. It adds no contact table: status is derived from the consent ledger
 * (`consentState`, the SQL twin of the send-time gate) and the list memberships NL-01 already stores. Nobody becomes
 * "subscribed" without a recorded newsletter consent, and do-not-contact (a withdrawal) always wins.
 */
export const audienceStatuses = ["subscribed", "not_on_list", "unsubscribed", "never", "suppressed"] as const;
export type AudienceStatus = typeof audienceStatuses[number];
export type AudienceLens = { kind: "all" } | { kind: "status"; status: AudienceStatus } | { kind: "list"; id: string } | { kind: "group"; id: string };

const nameInput = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const versionInput = z.object({ version: z.number().int().positive() }).strict();

/** One person's newsletter status. Suppressed and bounced first, then withdrawal, then an explicit grant plus a live list. */
export function audienceStatusSql(tenantId: string): SQL<AudienceStatus> {
  const consent = consentState(tenantId, "newsletter", "email");
  const memberships = (condition: SQL) => sql`exists (select 1 from newsletter_subscriptions ns
    join newsletter_subscribers s on s.tenant_id = ns.tenant_id and s.id = ns.subscriber_id
    join newsletter_lists l on l.tenant_id = ns.tenant_id and l.id = ns.list_id and l.archived_at is null
    where s.tenant_id = ${tenantId}::uuid and s.contact_id = contacts.id and ${condition})`;
  return sql<AudienceStatus>`(case
    when exists (select 1 from newsletter_subscribers s where s.tenant_id = ${tenantId}::uuid and s.contact_id = contacts.id and s.suppressed)
      or ${memberships(sql`ns.state in ('bounced','suppressed')`)} then 'suppressed'
    when ${consent} = 'withdrawn' then 'unsubscribed'
    when ${consent} = 'granted' and ${memberships(sql`ns.state = 'subscribed'`)} then 'subscribed'
    when ${memberships(sql`true`)} then 'unsubscribed'
    when ${consent} = 'granted' then 'not_on_list'
    else 'never' end)`;
}

/** This person's own row on one list (state, subscriber id and version for the row actions). */
function listColumns(tenantId: string, listId: string): Record<string, SQL> {
  const pick = (column: string) => sql`(select ${sql.raw(column)} from newsletter_subscriptions ns
    join newsletter_subscribers s on s.tenant_id = ns.tenant_id and s.id = ns.subscriber_id
    where ns.tenant_id = ${tenantId}::uuid and ns.list_id = ${listId}::uuid and s.contact_id = contacts.id)`;
  return { listState: pick("ns.state"), subscriberId: pick("s.id::text"), subscriptionVersion: pick("ns.version") };
}

function extensionFor(lens: AudienceLens): ListExtension {
  return {
    columns: (tenantId) => ({ audienceStatus: audienceStatusSql(tenantId), ...(lens.kind === "list" ? listColumns(tenantId, lens.id) : {}) }),
    where: async (tx, tenantId) => {
      if (lens.kind === "status") return sql`${audienceStatusSql(tenantId)} = ${lens.status}`;
      if (lens.kind === "list") {
        const [list] = await tx.select({ id: newsletterLists.id }).from(newsletterLists).where(and(eq(newsletterLists.tenantId, tenantId), eq(newsletterLists.id, lens.id), isNull(newsletterLists.archivedAt)));
        if (!list) throw unavailable();
        return sql`exists (select 1 from newsletter_subscriptions ns join newsletter_subscribers s on s.tenant_id = ns.tenant_id and s.id = ns.subscriber_id
          where ns.tenant_id = ${tenantId}::uuid and ns.list_id = ${lens.id}::uuid and s.contact_id = contacts.id)`;
      }
      if (lens.kind === "group") return peopleQuery(tx, tenantId, await segmentState(tx, tenantId, lens.id), await loadDefinitions(tx, tenantId, "person"), false).where;
      return undefined;
    },
  };
}

/** People for one lens: the shared CRM list (same predicates, filters, saved views and paging) plus the newsletter columns. */
export function listAudiencePeople(db: Database, user: string, workspace: string, params: Parameters<typeof listContacts>[3], lens: AudienceLens) {
  return withNewsletter(db, user, workspace, "newsletter:read", async () => undefined).then(() => listContacts(db, user, workspace, params, extensionFor(lens)));
}

/** Lists, saved groups and ministry-wide status counts. Counts are exact; nothing is sampled. */
export function audienceOverview(db: Database, user: string, workspace: string) {
  return withNewsletter(db, user, workspace, "newsletter:read", async (tx, tenantId) => {
    // The status expression is evaluated once per person (a lateral subquery), then grouped.
    const grouped = await tx.execute<{ status: AudienceStatus; n: number }>(sql`select s.status, count(*)::int as n from contacts
      cross join lateral (select ${audienceStatusSql(tenantId)} as status) s where contacts.tenant_id = ${tenantId}::uuid and contacts.erased_at is null group by s.status`);
    const counts = { all: 0, subscribed: 0, not_on_list: 0, unsubscribed: 0, never: 0, suppressed: 0 };
    for (const row of grouped.rows) { counts[row.status] = row.n; counts.all += row.n; }
    const lists = await tx.select({ id: newsletterLists.id, name: newsletterLists.name, audienceId: newsletterLists.audienceId, version: newsletterLists.version,
      subscribed: sql<number>`(select count(*) from newsletter_subscriptions ns join contacts c on c.tenant_id = ns.tenant_id
        join newsletter_subscribers s on s.tenant_id = ns.tenant_id and s.id = ns.subscriber_id and s.contact_id = c.id
        where ns.tenant_id = ${tenantId}::uuid and ns.list_id = newsletter_lists.id and ns.state = 'subscribed' and c.erased_at is null)::int`,
    }).from(newsletterLists).where(and(eq(newsletterLists.tenantId, tenantId), isNull(newsletterLists.archivedAt))).orderBy(asc(newsletterLists.name), asc(newsletterLists.id)).limit(200);
    const groups = await tx.select({ id: newsletterSegments.id, name: newsletterSegments.name, audienceId: newsletterSegments.audienceId, version: newsletterSegments.savedViewVersion })
      .from(newsletterSegments).where(and(eq(newsletterSegments.tenantId, tenantId), isNull(newsletterSegments.archivedAt))).orderBy(asc(newsletterSegments.name), asc(newsletterSegments.id)).limit(200);
    return { counts, lists, groups };
  });
}

async function defaultAudience(tx: Transaction, tenantId: string, user: string) {
  const [existing] = await tx.select({ id: newsletterAudiences.id }).from(newsletterAudiences).where(eq(newsletterAudiences.tenantId, tenantId)).orderBy(asc(newsletterAudiences.createdAt), asc(newsletterAudiences.id)).limit(1);
  if (existing) return existing.id;
  const [created] = await tx.insert(newsletterAudiences).values({ tenantId, name: "Subscribers", createdBy: user }).returning({ id: newsletterAudiences.id });
  return created.id;
}
const log = (tx: Transaction, tenantId: string, actor: string, action: string, target: string, metadata: Record<string, string> = {}) =>
  tx.insert(auditLogs).values({ tenantId, actorId: actor, action, targetId: target, metadata });
async function uniqueName(tx: Transaction, tenantId: string, name: string, except?: string) {
  const [clash] = await tx.select({ id: newsletterLists.id }).from(newsletterLists).where(and(eq(newsletterLists.tenantId, tenantId), isNull(newsletterLists.archivedAt),
    sql`lower(${newsletterLists.name}) = lower(${name})`, except ? sql`${newsletterLists.id} <> ${except}::uuid` : undefined)).limit(1);
  if (clash) throw conflict("NAME_TAKEN");
}
async function uniqueGroupName(tx: Transaction, tenantId: string, name: string, except?: string) {
  const [clash] = await tx.select({ id: newsletterSegments.id }).from(newsletterSegments).where(and(eq(newsletterSegments.tenantId, tenantId), isNull(newsletterSegments.archivedAt),
    sql`lower(${newsletterSegments.name}) = lower(${name})`, except ? sql`${newsletterSegments.id} <> ${except}::uuid` : undefined)).limit(1);
  if (clash) throw conflict("NAME_TAKEN");
}
async function activeGroup(tx: Transaction, tenantId: string, id: string) {
  const [group] = await tx.select().from(newsletterSegments).where(and(eq(newsletterSegments.tenantId, tenantId), eq(newsletterSegments.id, z.uuid().parse(id)), isNull(newsletterSegments.archivedAt))).for("update");
  if (!group) throw unavailable();
  return group;
}
async function activeList(tx: Transaction, tenantId: string, id: string, lock = false) {
  const query = tx.select().from(newsletterLists).where(and(eq(newsletterLists.tenantId, tenantId), eq(newsletterLists.id, z.uuid().parse(id)), isNull(newsletterLists.archivedAt)));
  const [list] = await (lock ? query.for("update") : query);
  if (!list) throw unavailable();
  return list;
}

export function createAudienceList(db: Database, user: string, workspace: string, raw: unknown) {
  const input = nameInput.parse(raw);
  return withNewsletter(db, user, workspace, "newsletter:manage", async (tx, tenantId) => {
    await uniqueName(tx, tenantId, input.name);
    const [list] = await tx.insert(newsletterLists).values({ tenantId, audienceId: await defaultAudience(tx, tenantId, user), name: input.name, createdBy: user }).returning();
    await log(tx, tenantId, user, "newsletter.list.create", list.id);
    return { id: list.id, name: list.name, version: list.version };
  });
}

export function renameAudienceList(db: Database, user: string, workspace: string, list: string, raw: unknown) {
  const input = nameInput.extend(versionInput.shape).parse(raw);
  return withNewsletter(db, user, workspace, "newsletter:manage", async (tx, tenantId) => {
    const current = await activeList(tx, tenantId, list, true);
    if (current.version !== input.version) throw conflict("STALE");
    await uniqueName(tx, tenantId, input.name, current.id);
    const [row] = await tx.update(newsletterLists).set({ name: input.name }).where(and(eq(newsletterLists.tenantId, tenantId), eq(newsletterLists.id, current.id))).returning();
    await auditVersion(tx, tenantId, user, "newsletter.list.rename", row.id, row.version);
    return { id: row.id, name: row.name, version: row.version };
  });
}

/** Deleting hides the list everywhere and keeps its memberships and history (consent evidence is never destroyed). */
export function deleteAudienceList(db: Database, user: string, workspace: string, list: string, raw: unknown) {
  const input = versionInput.parse(raw);
  return withNewsletter(db, user, workspace, "newsletter:manage", async (tx, tenantId) => {
    const current = await activeList(tx, tenantId, list, true);
    if (current.version !== input.version) throw conflict("STALE");
    const [inUse] = await tx.select({ id: newsletterCampaigns.id }).from(newsletterCampaignLists)
      .innerJoin(newsletterCampaigns, and(eq(newsletterCampaigns.tenantId, newsletterCampaignLists.tenantId), eq(newsletterCampaigns.id, newsletterCampaignLists.campaignId), eq(newsletterCampaigns.revision, newsletterCampaignLists.revision)))
      .where(and(eq(newsletterCampaignLists.tenantId, tenantId), eq(newsletterCampaignLists.listId, current.id), inArray(newsletterCampaigns.state, ["reviewed", "scheduled", "sending"]))).limit(1);
    if (inUse) throw conflict("LIST_IN_USE");
    const [row] = await tx.update(newsletterLists).set({ archivedAt: new Date() }).where(and(eq(newsletterLists.tenantId, tenantId), eq(newsletterLists.id, current.id))).returning();
    await auditVersion(tx, tenantId, user, "newsletter.list.delete", row.id, row.version);
    return { id: row.id };
  });
}

export type AddOutcome = "added" | "already" | "needs_consent" | "suppressed" | "opted_out" | "unavailable";
const peopleInput = z.object({ contactIds: z.array(z.uuid()).min(1).max(50).transform((ids) => [...new Set(ids)]) }).strict();
/**
 * Adds people to a list. A person is subscribed only when the consent ledger already holds an explicit newsletter grant
 * (the same send-time decision), so a person without one is reported as needs_consent and is never changed.
 */
export function addPeopleToList(db: Database, user: string, workspace: string, list: string, raw: unknown) {
  const input = peopleInput.parse(raw);
  return withNewsletter(db, user, workspace, "newsletter:manage", async (tx, tenantId) => {
    const target = await activeList(tx, tenantId, list);
    const outcomes: Record<string, AddOutcome> = {};
    for (const contactId of input.contactIds.sort()) {
      const [person] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId), isNull(contacts.erasedAt))).for("update");
      if (!person) { outcomes[contactId] = "unavailable"; continue; }
      const decision = await mayContact(tx, tenantId, contactId, "newsletter", "email");
      let [subscriber] = await tx.select().from(newsletterSubscribers).where(and(eq(newsletterSubscribers.tenantId, tenantId), eq(newsletterSubscribers.contactId, contactId))).for("update");
      if (subscriber?.suppressed) { outcomes[contactId] = "suppressed"; continue; }
      const [current] = subscriber ? await tx.select().from(newsletterSubscriptions).where(and(eq(newsletterSubscriptions.tenantId, tenantId), eq(newsletterSubscriptions.listId, target.id), eq(newsletterSubscriptions.subscriberId, subscriber.id))).for("update") : [];
      if (current?.state === "bounced" || current?.state === "suppressed") { outcomes[contactId] = "suppressed"; continue; }
      // A person's own list unsubscribe (the link in an email) is never reversed by an admin adding them. It leaves no consent
      // withdrawal, so it is read from the audit trail: an opt-out newer than the last time they were subscribed. An admin's own
      // removal writes a different audit action, so re-adding after that stays allowed.
      if (current?.state === "unsubscribed") {
        const optedOut = await tx.execute<{ opted_out: boolean }>(sql`select exists (select 1 from audit_logs o where o.tenant_id = ${tenantId}::uuid
          and o.action = 'newsletter.unsubscribe.list' and o.target_id = ${subscriber.id} and o.metadata->>'listId' = ${target.id}
          and not exists (select 1 from audit_logs a where a.tenant_id = o.tenant_id and a.action = 'newsletter.subscription.set' and a.target_id = o.target_id
            and a.metadata->>'listId' = ${target.id} and a.metadata->>'to' = 'subscribed' and a.created_at >= o.created_at)) as opted_out`);
        if (optedOut.rows[0]?.opted_out) { outcomes[contactId] = "opted_out"; continue; }
      }
      if (!decision.allowed) { outcomes[contactId] = "needs_consent"; continue; }
      if (current?.state === "subscribed") { outcomes[contactId] = "already"; continue; }
      if (!subscriber) {
        [subscriber] = await tx.insert(newsletterSubscribers).values({ tenantId, contactId, createdBy: user }).returning();
        await tx.insert(newsletterImportProvenance).values({ tenantId, subscriberId: subscriber.id, source: "manual", createdBy: user });
      }
      if (current) await tx.update(newsletterSubscriptions).set({ state: "subscribed", consentId: decision.consentId, version: current.version + 1, updatedAt: new Date() })
        .where(and(eq(newsletterSubscriptions.tenantId, tenantId), eq(newsletterSubscriptions.listId, target.id), eq(newsletterSubscriptions.subscriberId, subscriber.id)));
      else await tx.insert(newsletterSubscriptions).values({ tenantId, listId: target.id, subscriberId: subscriber.id, state: "subscribed", consentId: decision.consentId });
      await log(tx, tenantId, user, "newsletter.subscription.set", subscriber.id, { listId: target.id, from: current?.state ?? "none", to: "subscribed", consentId: decision.consentId });
      outcomes[contactId] = "added";
    }
    return { outcomes };
  });
}

/** Removing records an unsubscribe on that list only. Consent and the person's other lists are untouched. */
export function removePersonFromList(db: Database, user: string, workspace: string, list: string, raw: unknown) {
  const input = z.object({ subscriberId: z.uuid(), version: z.number().int().min(1) }).strict().parse(raw);
  return withNewsletter(db, user, workspace, "newsletter:manage", async (tx, tenantId) => {
    const target = await activeList(tx, tenantId, list);
    const where = and(eq(newsletterSubscriptions.tenantId, tenantId), eq(newsletterSubscriptions.listId, target.id), eq(newsletterSubscriptions.subscriberId, input.subscriberId));
    const [current] = await tx.select().from(newsletterSubscriptions).where(where).for("update");
    if (!current) throw unavailable();
    if (current.version !== input.version) throw conflict("STALE");
    if (current.state === "suppressed" || current.state === "bounced") return { state: current.state };
    const [row] = await tx.update(newsletterSubscriptions).set({ state: "unsubscribed", consentId: null, version: current.version + 1, updatedAt: new Date() }).where(where).returning();
    await log(tx, tenantId, user, "newsletter.subscription.set", input.subscriberId, { listId: target.id, from: current.state, to: "unsubscribed" });
    return { state: row.state };
  });
}

const groupInput = nameInput.extend({ state: viewState }).strict();
/**
 * A saved group is the current People filter kept as a shared CRM view, then pinned the way NL-01 segments already are.
 * Source rules are refused (segments never carry them), exactly as `createNewsletterSegment` does.
 */
export function createGroupFromFilter(db: Database, user: string, workspace: string, raw: unknown) {
  const input = groupInput.parse(raw);
  return withNewsletter(db, user, workspace, "newsletter:manage", async (tx, tenantId) => {
    await uniqueGroupName(tx, tenantId, input.name);
    const state: ViewState = fullState(input.state);
    if (state.sources.length) throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
    resolveState("person", state, await loadDefinitions(tx, tenantId, "person"));
    const [view] = await tx.insert(crmSavedViews).values({ tenantId, objectType: "person", name: input.name, ownerUserId: null, state, createdBy: user }).returning();
    const [group] = await tx.insert(newsletterSegments).values({ tenantId, audienceId: await defaultAudience(tx, tenantId, user), savedViewId: view.id, savedViewVersion: view.version, name: input.name, createdBy: user }).returning();
    await log(tx, tenantId, user, "newsletter.segment.create", group.id, { savedViewId: view.id });
    return { id: group.id, name: group.name };
  });
}

/**
 * Renames a saved group and the shared CRM view it points to. The view version moves with the name, so a pending review that pinned
 * the old version no longer matches and must be reviewed again (SELECTION_CHANGED), never sent on a stale pin.
 */
export function renameAudienceGroup(db: Database, user: string, workspace: string, group: string, raw: unknown) {
  const input = nameInput.extend(versionInput.shape).parse(raw);
  return withNewsletter(db, user, workspace, "newsletter:manage", async (tx, tenantId) => {
    const current = await activeGroup(tx, tenantId, group);
    if (current.savedViewVersion !== input.version) throw conflict("STALE");
    await uniqueGroupName(tx, tenantId, input.name, current.id);
    const [view] = await tx.update(crmSavedViews).set({ name: input.name, version: sql`${crmSavedViews.version} + 1`, updatedAt: new Date() })
      .where(and(eq(crmSavedViews.tenantId, tenantId), eq(crmSavedViews.id, current.savedViewId), eq(crmSavedViews.version, current.savedViewVersion), isNull(crmSavedViews.ownerUserId))).returning();
    if (!view) throw conflict("STALE");
    const [row] = await tx.update(newsletterSegments).set({ name: input.name, savedViewVersion: view.version }).where(and(eq(newsletterSegments.tenantId, tenantId), eq(newsletterSegments.id, current.id))).returning();
    await auditVersion(tx, tenantId, user, "newsletter.segment.rename", row.id, row.savedViewVersion);
    return { id: row.id, name: row.name, version: row.savedViewVersion };
  });
}

/** Deleting archives: hidden from the Audience, the Send step and recipient resolution. The shared CRM view and consent history stay. */
export function deleteAudienceGroup(db: Database, user: string, workspace: string, group: string, raw: unknown) {
  const input = versionInput.parse(raw);
  return withNewsletter(db, user, workspace, "newsletter:manage", async (tx, tenantId) => {
    const current = await activeGroup(tx, tenantId, group);
    if (current.savedViewVersion !== input.version) throw conflict("STALE");
    const [inUse] = await tx.select({ id: newsletterCampaigns.id }).from(newsletterCampaignSegments)
      .innerJoin(newsletterCampaigns, and(eq(newsletterCampaigns.tenantId, newsletterCampaignSegments.tenantId), eq(newsletterCampaigns.id, newsletterCampaignSegments.campaignId), eq(newsletterCampaigns.revision, newsletterCampaignSegments.revision)))
      .where(and(eq(newsletterCampaignSegments.tenantId, tenantId), eq(newsletterCampaignSegments.segmentId, current.id), inArray(newsletterCampaigns.state, ["reviewed", "scheduled", "sending"]))).limit(1);
    if (inUse) throw conflict("GROUP_IN_USE");
    const [row] = await tx.update(newsletterSegments).set({ archivedAt: new Date() }).where(and(eq(newsletterSegments.tenantId, tenantId), eq(newsletterSegments.id, current.id))).returning();
    await auditVersion(tx, tenantId, user, "newsletter.segment.delete", row.id, row.savedViewVersion);
    return { id: row.id };
  });
}
