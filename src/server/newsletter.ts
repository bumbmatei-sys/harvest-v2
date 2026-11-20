import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, contacts, crmSavedViews, newsletterAudiences, newsletterImportProvenance, newsletterLists, newsletterSegments, newsletterSubscribers, newsletterSubscriptions } from "../db/schema";
import { viewState } from "../lib/crm-fields";
import { effectiveNewsletterState, newsletterPage, subscriberInput, subscriptionInput } from "../lib/newsletter";
import { message } from "../i18n/messages";
import { mayContact } from "./consent-gate";
import { loadDefinitions, resolveState } from "./crm-filters";
import { peopleQuery } from "./contacts";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
export function newsletterEnabled(env: Record<string, string | undefined> = process.env) { return env.NODE_ENV !== 'production'; }
export function requireNewsletterEnabled() { if (!newsletterEnabled())
    throw new AccessError(404, message('Errors.thisViewIsNotAvailable')); }
const missing = () => new AccessError(404, message('Errors.thisContactIsNotAvailableInThisWorkspace'));
const stale = () => new AccessError(409, message('Errors.thisRecordChangedReloadAndTryAgain'));
const nameInput = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const audit = (tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, metadata: Record<string, string | number> = {}) => tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata: Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)])) });
async function lockContact(tx: Transaction, tenantId: string, id: string) { const [c] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt))).for('update'); if (!c)
    throw missing(); }
export function createNewsletterAudience(db: Database, user: string, workspace: string, raw: unknown) { requireNewsletterEnabled(); const input = nameInput.parse(raw); return withTenant(db, user, z.uuid().parse(workspace), 'newsletter:manage', async (tx, tenantId) => { const [r] = await tx.insert(newsletterAudiences).values({ ...input, tenantId, createdBy: user }).returning(); await audit(tx, tenantId, user, 'newsletter.audience.create', r.id); return r; }); }
export function createNewsletterList(db: Database, user: string, workspace: string, audience: string, raw: unknown) { requireNewsletterEnabled(); const input = nameInput.parse(raw), audienceId = z.uuid().parse(audience); return withTenant(db, user, z.uuid().parse(workspace), 'newsletter:manage', async (tx, tenantId) => { const [a] = await tx.select().from(newsletterAudiences).where(and(eq(newsletterAudiences.tenantId, tenantId), eq(newsletterAudiences.id, audienceId))); if (!a)
    throw missing(); const [r] = await tx.insert(newsletterLists).values({ ...input, tenantId, audienceId, createdBy: user }).returning(); await audit(tx, tenantId, user, 'newsletter.list.create', r.id, { audienceId }); return r; }); }
/** Import provenance points to existing applied CRM rows; no CSV person/consent duplication. Replays preserve first provenance. */
export function addNewsletterSubscriber(db: Database, user: string, workspace: string, raw: unknown) {
    requireNewsletterEnabled();
    const input = subscriberInput.parse(raw);
    return withTenant(db, user, z.uuid().parse(workspace), 'newsletter:manage', async (tx, tenantId) => {
        await lockContact(tx, tenantId, input.contactId);
        const [old] = await tx.select().from(newsletterSubscribers).where(and(eq(newsletterSubscribers.tenantId, tenantId), eq(newsletterSubscribers.contactId, input.contactId)));
        if (old)
            return { id: old.id, contactId: old.contactId, suppressed: old.suppressed, version: old.version, replayed: true };
        const [r] = await tx.insert(newsletterSubscribers).values({ contactId: input.contactId, tags: input.tags, tenantId, createdBy: user }).returning();
        await tx.insert(newsletterImportProvenance).values({ tenantId, subscriberId: r.id, source: input.source, importId: input.importId, rowNumber: input.rowNumber, importedAt: input.source === 'csv_import' ? new Date() : null, createdBy: user });
        await audit(tx, tenantId, user, 'newsletter.subscriber.create', r.id, { contactId: r.contactId, source: input.source, ...(input.importId ? { importId: input.importId, rowNumber: input.rowNumber! } : {}) });
        return { id: r.id, contactId: r.contactId, suppressed: r.suppressed, version: r.version, replayed: false };
    });
}
export function updateNewsletterSubscriber(db: Database, user: string, workspace: string, subscriber: string, raw: unknown) {
    requireNewsletterEnabled();
    const id = z.uuid().parse(subscriber), input = z.object({ version: z.number().int().positive(), tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)).max(50).optional(), suppressed: z.literal(true).optional() }).strict().parse(raw);
    return withTenant(db, user, z.uuid().parse(workspace), 'newsletter:manage', async (tx, tenantId) => {
        const [current] = await tx.select().from(newsletterSubscribers).where(and(eq(newsletterSubscribers.tenantId, tenantId), eq(newsletterSubscribers.id, id)));
        if (!current)
            throw missing();
        await lockContact(tx, tenantId, current.contactId);
        const [r] = await tx.update(newsletterSubscribers).set({ ...(input.tags ? { tags: [...new Set(input.tags)].sort() } : {}), ...(input.suppressed ? { suppressed: true } : {}), version: sql `${newsletterSubscribers.version}+1`, updatedAt: new Date() }).where(and(eq(newsletterSubscribers.tenantId, tenantId), eq(newsletterSubscribers.id, id), eq(newsletterSubscribers.version, input.version))).returning();
        if (!r)
            throw stale();
        await audit(tx, tenantId, user, 'newsletter.subscriber.update', id, { version: r.version, suppressed: String(r.suppressed) });
        return { id: r.id, version: r.version, suppressed: r.suppressed, tags: r.tags };
    });
}
export function setNewsletterSubscription(db: Database, user: string, workspace: string, list: string, subscriber: string, raw: unknown) {
    requireNewsletterEnabled();
    const input = subscriptionInput.parse(raw), listId = z.uuid().parse(list), subscriberId = z.uuid().parse(subscriber);
    return withTenant(db, user, z.uuid().parse(workspace), 'newsletter:manage', async (tx, tenantId) => {
        const [s] = await tx.select().from(newsletterSubscribers).where(and(eq(newsletterSubscribers.tenantId, tenantId), eq(newsletterSubscribers.id, subscriberId)));
        if (!s)
            throw missing();
        await lockContact(tx, tenantId, s.contactId);
        const [locked] = await tx.select().from(newsletterSubscribers).where(and(eq(newsletterSubscribers.tenantId, tenantId), eq(newsletterSubscribers.id, subscriberId))).for('update');
        const [l] = await tx.select().from(newsletterLists).where(and(eq(newsletterLists.tenantId, tenantId), eq(newsletterLists.id, listId)));
        if (!l)
            throw missing();
        const where = and(eq(newsletterSubscriptions.tenantId, tenantId), eq(newsletterSubscriptions.listId, listId), eq(newsletterSubscriptions.subscriberId, subscriberId));
        const [current] = await tx.select().from(newsletterSubscriptions).where(where).for('update');
        if (input.version !== (current?.version ?? 0))
            throw stale();
        if ((locked.suppressed || current?.state === 'suppressed') && input.state !== 'suppressed')
            throw new AccessError(409, message('Errors.thisRecordChangedReloadAndTryAgain'), { reason: 'suppressed' });
        const decision = await mayContact(tx, tenantId, s.contactId, 'newsletter', 'email');
        if (input.state === 'subscribed' && !decision.allowed)
            throw new AccessError(403, message('Errors.youDoNotHavePermissionToDoThat'), { reason: decision.reason });
        const values = { state: input.state, consentId: input.state === 'subscribed' && decision.allowed ? decision.consentId : null, updatedAt: new Date() };
        const [r] = current ? await tx.update(newsletterSubscriptions).set({ ...values, version: current.version + 1 }).where(where).returning() : await tx.insert(newsletterSubscriptions).values({ ...values, tenantId, listId, subscriberId }).returning();
        await audit(tx, tenantId, user, 'newsletter.subscription.set', subscriberId, { listId, from: current?.state ?? 'none', to: r.state, version: r.version, ...(r.consentId ? { consentId: r.consentId } : {}) });
        return { listId, subscriberId, state: r.state, version: r.version };
    });
}
export async function segmentState(tx: Transaction, tenantId: string, id: string) {
    const [s] = await tx.select({ view: crmSavedViews }).from(newsletterSegments).innerJoin(crmSavedViews, and(eq(crmSavedViews.tenantId, newsletterSegments.tenantId), eq(crmSavedViews.id, newsletterSegments.savedViewId))).where(and(eq(newsletterSegments.tenantId, tenantId), eq(newsletterSegments.id, id), eq(crmSavedViews.objectType, 'person'), eq(crmSavedViews.version,newsletterSegments.savedViewVersion), isNull(crmSavedViews.ownerUserId)));
    if (!s)
        throw missing();
    const state = viewState.parse(s.view.state);
    if (state.sources.length)
        throw new AccessError(403, message('Errors.youDoNotHavePermissionToDoThat'));
    return resolveState('person', state, await loadDefinitions(tx, tenantId, 'person'));
}
export function createNewsletterSegment(db: Database, user: string, workspace: string, audience: string, raw: unknown) {
    requireNewsletterEnabled();
    const input = nameInput.extend({ savedViewId: z.uuid() }).parse(raw), audienceId = z.uuid().parse(audience);
    return withTenant(db, user, z.uuid().parse(workspace), 'newsletter:manage', async (tx, tenantId) => {
        const [v] = await tx.select().from(crmSavedViews).where(and(eq(crmSavedViews.tenantId, tenantId), eq(crmSavedViews.id, input.savedViewId), eq(crmSavedViews.objectType, 'person'), isNull(crmSavedViews.ownerUserId)));
        if (!v)
            throw missing();
        const state = viewState.parse(v.state);
        if (state.sources.length)
            throw new AccessError(403, message('Errors.youDoNotHavePermissionToDoThat'));
        resolveState('person', state, await loadDefinitions(tx, tenantId, 'person'));
        const [r] = await tx.insert(newsletterSegments).values({ ...input, tenantId, audienceId, savedViewVersion:v.version, createdBy: user }).returning();
        await audit(tx, tenantId, user, 'newsletter.segment.create', r.id, { audienceId, savedViewId: input.savedViewId });
        return r;
    });
}
/** Keyset is immutable UUID ascending, deliberately independent of editable names/timestamps. */
export function listNewsletterSubscribers(db: Database, user: string, workspace: string, list: string, raw: unknown = {}) {
    requireNewsletterEnabled();
    const page = newsletterPage.parse(raw), listId = z.uuid().parse(list);
    return withTenant(db, user, z.uuid().parse(workspace), 'newsletter:read', async (tx, tenantId) => {
        const [l] = await tx.select().from(newsletterLists).where(and(eq(newsletterLists.tenantId, tenantId), eq(newsletterLists.id, listId)));
        if (!l)
            throw missing();
        let segmentWhere;
        if (page.segmentId) {
            const [sg] = await tx.select().from(newsletterSegments).where(and(eq(newsletterSegments.tenantId, tenantId), eq(newsletterSegments.id, page.segmentId), eq(newsletterSegments.audienceId, l.audienceId)));
            if (!sg)
                throw missing();
            const state = await segmentState(tx, tenantId, page.segmentId);
            segmentWhere = peopleQuery(tx, tenantId, state, await loadDefinitions(tx, tenantId, 'person'), false).where;
        }
        const rows = await tx.select({ id: newsletterSubscribers.id, contactId: newsletterSubscribers.contactId, suppressed: newsletterSubscribers.suppressed, tags: newsletterSubscribers.tags, state: newsletterSubscriptions.state, version: newsletterSubscriptions.version })
            .from(newsletterSubscriptions).innerJoin(newsletterSubscribers, and(eq(newsletterSubscribers.tenantId, newsletterSubscriptions.tenantId), eq(newsletterSubscribers.id, newsletterSubscriptions.subscriberId)))
            .innerJoin(contacts, and(eq(contacts.tenantId, newsletterSubscribers.tenantId), eq(contacts.id, newsletterSubscribers.contactId)))
            .where(and(eq(newsletterSubscriptions.tenantId, tenantId), eq(newsletterSubscriptions.listId, listId), isNull(contacts.erasedAt), page.after ? gt(newsletterSubscribers.id, page.after) : undefined, page.tag ? sql `${page.tag}=any(${newsletterSubscribers.tags})` : undefined, segmentWhere)).orderBy(asc(newsletterSubscribers.id)).limit(page.limit + 1);
        const more = rows.length > page.limit;
        const selected = rows.slice(0, page.limit);
        const result = [];
        for (const row of selected) {
            const gate = await mayContact(tx, tenantId, row.contactId, 'newsletter', 'email');
            result.push({ id: row.id, contactId: row.contactId, tags: row.tags, state: effectiveNewsletterState(row.state, row.suppressed, gate.allowed), version: row.version });
        }
        return { subscribers: result, nextCursor: more ? selected.at(-1)!.id : null };
    });
}
/** Each collection has its own bounded UUID keyset; never present a truncated page as a total. */
export function pageNewsletterConfiguration(db: Database, user: string, workspace: string, kind: 'audiences' | 'lists' | 'segments', raw: unknown = {}) {
    requireNewsletterEnabled();
    const page = newsletterPage.pick({ limit: true, after: true }).parse(raw);
    const table = { audiences: newsletterAudiences, lists: newsletterLists, segments: newsletterSegments }[kind];
    return withTenant(db, user, z.uuid().parse(workspace), 'newsletter:read', async (tx, tenantId) => {
        const audienceColumn = kind === 'lists' ? newsletterLists.audienceId : kind === 'segments' ? newsletterSegments.audienceId : undefined;
        const rows = await tx.select({ id: table.id, name: table.name, ...(audienceColumn ? { audienceId: audienceColumn } : {}) }).from(table).where(and(eq(table.tenantId, tenantId), page.after ? gt(table.id, page.after) : undefined)).orderBy(asc(table.id)).limit(page.limit + 1);
        return { items: rows.slice(0, page.limit), nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null };
    });
}
