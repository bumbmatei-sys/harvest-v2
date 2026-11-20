import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { contacts, socialInboxItemLabels, socialInboxItems, socialInboxLabels, socialInboxNotes,
  socialInboxReads, socialInboxScanItems, socialWebhookEvents, users, workspaceMembers } from "../../db/schema";
import { inboxKinds, socialPlatforms, type InboxKind } from "../../lib/social/platforms";
import { likePattern } from "../crm-filters";
import { AccessError } from "../permissions";
import { accountSet, accountView, digest, inboxAccounts, inboxItem, inboxModes, inboxText,
  providerAccess, readCapability, referenceInput, replyCapability, withInbox, type InboxConnection } from "./inbox-access";
import type { InboxEntry } from "./inbox-contract";
import { inboxCursor, openInboxCursor } from "./inbox-tokens";
import { SocialProviderError } from "./port";
import { publishConflict, unavailable } from "./publish-access";
import { defaultSocialDeps, type SocialDeps } from "./registry";

const folders = ["all", "unread", "assigned", "open", "done", "starred", "mentions", "comments", "dms"] as const;
type Folder = typeof folders[number];
const filterInput = z.object({
  account: z.uuid().optional(), platform: z.enum(socialPlatforms).optional(), kind: z.enum(inboxKinds).optional(),
  folder: z.enum(folders).default("all"), assignee: inboxText(200).optional(), label: z.uuid().optional(),
  status: z.enum(["open", "done"]).optional(), note: inboxText(100).optional(), snoozed: z.boolean().optional(),
}).strict();
const listInput = filterInput.extend({ search: inboxText(200).optional(), cursor: z.string().max(512_000).optional() }).strict();
type Filters = z.infer<typeof filterInput>;
const sourceProgress = z.object({ cursor: z.string().max(20_000).optional(), done: z.boolean().optional(),
  terminal: z.enum(["expired", "denied", "unavailable"]).optional(), retryAt: z.number().optional(), failures: z.number().int().min(0).max(20).optional() });
const listCursor = z.object({ version: z.literal(1), scope: z.string(), expiry: z.number(), offset: z.number().int().min(0),
  sources: z.record(z.string(), sourceProgress), scanId: z.uuid(), step: z.number().int().min(0).max(2_147_483_645) });
const detailCursor = z.object({ version: z.literal(1), scope: z.string(), expiry: z.number(), cursor: z.string().max(20_000) });

type Item = typeof socialInboxItems.$inferSelect;
type Metadata = { item: Item; readThrough: Date | null; labels: string[]; contactId: string | null };
type Source = { account: InboxConnection; kind: InboxKind; key: string };
type ServiceState = { accountId: string; kind: InboxKind; state: "delayed" | "expired" | "revoked" | "denied" | "unavailable"; retryAt?: number };
const ttl = 15 * 60_000;
const pageSize = 10;
const maxSourcesPerRequest = 12;
const concurrency = 4;

async function timeBound<T>(run: (signal: AbortSignal) => Promise<T>) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([run(abort.signal), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new SocialProviderError("UNAVAILABLE")); abort.abort(); }, 2_500);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function readState(error: unknown): ServiceState["state"] {
  if (!(error instanceof SocialProviderError)) return "delayed";
  if (error.code === "EXPIRED") return "expired";
  if (error.code === "AUTH") return "denied";
  if (error.code === "UNSUPPORTED" || error.code === "DISABLED" || error.code === "NOT_FOUND") return "unavailable";
  return "delayed";
}

function channels(accounts: InboxConnection[], states: ServiceState[], search: string | undefined) {
  return accounts.map(row => {
    const account = accountView(row);
    const results = states.filter(entry => entry.accountId === row.id);
    return { ...account, results, liveSearch: search && account.capabilities.liveSearch === "unavailable" ? "unavailable" : account.capabilities.liveSearch };
  });
}

function selection(query: Filters, accounts: InboxConnection[]) {
  if (query.account && !accounts.some(account => account.id === query.account)) throw unavailable();
  return accounts.filter(account => (!query.account || query.account === account.id) && (!query.platform || query.platform === account.platform));
}

async function metadata(tx: Transaction, tenant: string, user: string, items: Item[]): Promise<Metadata[]> {
  if (!items.length) return [];
  const ids = items.map(item => item.id);
  const reads = await tx.select().from(socialInboxReads).where(and(eq(socialInboxReads.tenantId, tenant),
    eq(socialInboxReads.readerId, user), inArray(socialInboxReads.itemId, ids)));
  const links = await tx.select({ itemId: socialInboxItemLabels.itemId, labelId: socialInboxItemLabels.labelId }).from(socialInboxItemLabels)
    .innerJoin(socialInboxLabels, and(eq(socialInboxLabels.tenantId, socialInboxItemLabels.tenantId),
      eq(socialInboxLabels.id, socialInboxItemLabels.labelId), eq(socialInboxLabels.archived, false)))
    .where(and(eq(socialInboxItemLabels.tenantId, tenant), inArray(socialInboxItemLabels.itemId, ids)));
  const contactIds = [...new Set(items.flatMap(item => item.contactId ? [item.contactId] : []))];
  const linkedContacts = contactIds.length ? await tx.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.tenantId, tenant), inArray(contacts.id, contactIds), isNull(contacts.erasedAt))) : [];
  const activeContacts = new Set(linkedContacts.map(row => row.id));
  const readMap = new Map(reads.map(read => [read.itemId, read.readThrough]));
  const labelMap = new Map<string, string[]>();
  for (const { itemId, labelId } of links) {
    const values = labelMap.get(itemId) ?? [];
    values.push(labelId);
    labelMap.set(itemId, values);
  }
  return items.map(item => ({ item, readThrough: readMap.get(item.id) ?? null, labels: labelMap.get(item.id) ?? [],
    contactId: item.contactId && activeContacts.has(item.contactId) ? item.contactId : null }));
}

function publicItem(row: Metadata) {
  const { id, connectionId, kind, activityAt, status, assigneeId, starred, snoozedUntil, version } = row.item;
  return { id, connectionId, kind, activityAt, status, assigneeId, starred, snoozedUntil, version,
    contactId: row.contactId, labelIds: row.labels, readInHarvest: !!row.readThrough && (!activityAt || row.readThrough >= activityAt) };
}

function matchesFolder(folder: Folder, row: ReturnType<typeof publicItem>, user: string) {
  switch (folder) {
    case "unread": return !row.readInHarvest;
    case "assigned": return row.assigneeId === user;
    case "open": return row.status === "open";
    case "done": return row.status === "done";
    case "starred": return row.starred;
    case "mentions": return row.kind === "mention";
    case "comments": return row.kind === "comment";
    case "dms": return row.kind === "dm" || row.kind === "story";
    default: return true;
  }
}
function matchesLocal(query: Filters, row: ReturnType<typeof publicItem>, user: string, now: number) {
  return matchesFolder(query.folder, row, user)
    && (!query.assignee || row.assigneeId === query.assignee)
    && (!query.status || row.status === query.status)
    && (!query.label || row.labelIds.includes(query.label))
    && (query.snoozed === undefined || query.snoozed === (!!row.snoozedUntil && row.snoozedUntil.getTime() > now));
}

async function observe(tx: Transaction, tenantId: string, pages: { account: InboxConnection; item: InboxEntry }[]) {
  if (!pages.length) return;
  const tuples = pages.map(({ account, item }) => sql`(${tenantId}::uuid, ${account.id}::uuid, ${item.ref}, ${item.kind}, ${item.activityAt?.toISOString() ?? null}::timestamptz)`);
  await tx.execute(sql`insert into public.social_inbox_items (tenant_id, connection_id, provider_ref, kind, activity_at)
    values ${sql.join(tuples, sql`, `)}
    on conflict (tenant_id, connection_id, kind, provider_ref) do update set activity_at = excluded.activity_at,
      version = social_inbox_items.version + 1
    where excluded.activity_at is not null and (social_inbox_items.activity_at is null or excluded.activity_at > social_inbox_items.activity_at)`);
}
const itemKey = (connection: string, kind: InboxKind, ref: string) => JSON.stringify([connection, kind, ref]);

export async function listInbox(db: Database, user: string, workspace: string, data: unknown, deps = defaultSocialDeps()) {
  const query = listInput.parse(data);
  const { cursor, ...filter } = query;
  const accounts = await withInbox(db, user, workspace, deps, (tx, tenant) => inboxAccounts(tx, tenant));
  const selected = selection(filter, accounts);
  const sourceKinds = query.search ? ["dm" as const] : query.kind ? [query.kind]
    : query.folder === "mentions" ? ["mention" as const] : query.folder === "comments" ? ["comment" as const]
      : query.folder === "dms" ? ["dm" as const, "story" as const] : inboxKinds;
  const sources: Source[] = selected.flatMap(account => {
    const view = accountView(account);
    if (view.state !== "available" || (query.search && view.capabilities.liveSearch === "unavailable")) return [];
    return sourceKinds.filter(kind => view.capabilities[readCapability[kind]] !== "unavailable")
      .map(kind => ({ account, kind, key: `${account.id}/${kind}` }));
  });
  const now = deps.now().getTime();
  const set = accountSet(accounts);
  const scope = digest(["list", workspace, user, filter, set]);
  const progress = cursor ? openInboxCursor(cursor, listCursor) : { version: 1 as const, scope, expiry: now + ttl, offset: 0,
    sources: {} as z.infer<typeof listCursor>["sources"], scanId: randomUUID(), step: 0 };
  if (progress.scope !== scope || progress.expiry <= now) throw publishConflict("INBOX_CURSOR_STALE");
  const entries = new Map<string, { account: InboxConnection; item: InboxEntry }>();
  const states: ServiceState[] = [];
  const work: Source[] = [];
  for (let offset = 0; offset < sources.length && work.length < maxSourcesPerRequest; offset++) {
    const index = (progress.offset + offset) % sources.length;
    const source = sources[index];
    const previous = progress.sources[source.key];
    if (!previous?.done && (previous?.retryAt ?? 0) <= now) work.push(source);
  }
  if (work.length) progress.offset = (sources.indexOf(work[work.length - 1]) + 1) % sources.length;

  for (let offset = 0; offset < work.length; offset += concurrency) {
    await Promise.all(work.slice(offset, offset + concurrency).map(async source => {
      const { account, kind, key } = source;
      const previous = progress.sources[key] ?? {};
      try {
        const { provider, credential } = providerAccess(account, deps);
        const page = await timeBound(signal => provider.listInbox(credential, { accountRef: account.externalAccountRef, platform: account.platform,
          kind, cursor: previous.cursor, limit: pageSize, search: query.search, signal }));
        if (page.items.length > pageSize || (page.nextCursor && (page.nextCursor.length > 20_000 || page.nextCursor === previous.cursor))) {
          throw new SocialProviderError("UNAVAILABLE");
        }
        for (const item of page.items) {
          if (item.accountRef !== account.externalAccountRef || item.kind !== kind || !referenceInput.safeParse(item.ref).success) continue;
          const identity = itemKey(account.id, kind, item.ref);
          const previous = entries.get(identity);
          if (!previous || (item.activityAt?.getTime() ?? 0) > (previous.item.activityAt?.getTime() ?? 0)) entries.set(identity, { account, item });
        }
        progress.sources[key] = { cursor: page.nextCursor ?? undefined, done: page.nextCursor === null };
      } catch (error) {
        const state = readState(error);
        const retryAfter = error instanceof SocialProviderError ? error.retryAfterMs : null;
        const failures = Math.min((previous.failures ?? 0) + 1, 20);
        const delay = Math.max(Math.min(60_000, 1_000 * 2 ** Math.min(failures - 1, 6)), retryAfter ?? 0);
        const retryAt = now + delay;
        states.push({ accountId: account.id, kind, state, ...(state === "delayed" ? { retryAt } : {}) });
        progress.sources[key] = state === "delayed" ? { ...previous, retryAt, failures } : { done: true, terminal: state === "revoked" ? "expired" : state };
      }
    }));
  }
  const handled = new Set(work.map(source => source.key));
  for (const source of sources) {
    if (handled.has(source.key)) continue;
    const previous = progress.sources[source.key];
    const retryAt = previous?.retryAt;
    if (previous?.terminal) states.push({ accountId: source.account.id, kind: source.kind, state: previous.terminal });
    if (retryAt && retryAt > now) states.push({ accountId: source.account.id, kind: source.kind, state: "delayed", retryAt });
  }
  const remaining = sources.filter(source => !progress.sources[source.key]?.done);
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    const current = await inboxAccounts(tx, tenant);
    if (set !== accountSet(current)) throw publishConflict("INBOX_CURSOR_STALE");
    const observed = [...entries.values()].sort((a, b) => itemKey(a.account.id, a.item.kind, a.item.ref).localeCompare(itemKey(b.account.id, b.item.kind, b.item.ref)));
    await observe(tx, tenant, observed);
    const rows = observed.length ? await tx.select().from(socialInboxItems).where(and(eq(socialInboxItems.tenantId, tenant),
      or(...observed.map(({ account, item }) => and(eq(socialInboxItems.connectionId, account.id),
        eq(socialInboxItems.kind, item.kind), eq(socialInboxItems.providerRef, item.ref)))))) : [];
    const scan = socialInboxScanItems;
    if (!cursor) await tx.delete(scan).where(and(eq(scan.tenantId, tenant), eq(scan.readerId, user), lte(scan.expiresAt, deps.now())));
    // Within a scan, earlier pages suppress duplicates. A retry of the same signed page can still return its own items.
    const prior = rows.length ? await tx.select({ id: scan.itemId }).from(scan).where(and(eq(scan.tenantId, tenant),
      eq(scan.readerId, user), eq(scan.scanId, progress.scanId), inArray(scan.itemId, rows.map(row => row.id)), sql`${scan.firstPage} < ${progress.step}`)) : [];
    const priorIds = new Set(prior.map(row => row.id));
    const fresh = rows.filter(row => !priorIds.has(row.id));
    if (fresh.length && remaining.length) await tx.insert(scan).values(fresh.map(row => ({
      tenantId: tenant, readerId: user, scanId: progress.scanId, firstPage: progress.step, itemId: row.id, expiresAt: new Date(progress.expiry),
    }))).onConflictDoNothing();
    const rowMetadata = await metadata(tx, tenant, user, fresh);
    const noteIds = query.note && rows.length ? new Set((await tx.select({ itemId: socialInboxNotes.itemId }).from(socialInboxNotes)
      .where(and(eq(socialInboxNotes.tenantId, tenant), inArray(socialInboxNotes.itemId, rows.map(row => row.id)),
        ilike(socialInboxNotes.note, likePattern(query.note))))).map(row => row.itemId)) : null;
    const items = rowMetadata.map(row => {
      const entry = entries.get(itemKey(row.item.connectionId, row.item.kind, row.item.providerRef))!;
      return { ...publicItem(row), account: accountView(entry.account), title: entry.item.title, preview: entry.item.preview };
    }).filter(row => matchesLocal(filter, row, user, now) && (!noteIds || noteIds.has(row.id)))
      .sort((a, b) => (b.activityAt?.getTime() ?? 0) - (a.activityAt?.getTime() ?? 0) || a.id.localeCompare(b.id));
    const active = remaining.filter(source => (progress.sources[source.key]?.retryAt ?? 0) <= now);
    const retryAt = active.length ? null : Math.min(Infinity, ...remaining.map(source => progress.sources[source.key]?.retryAt ?? Infinity));
    return { items, channels: channels(current, states, query.search), partial: states,
      pendingAccountIds: [...new Set(remaining.filter(source => !handled.has(source.key)).map(source => source.account.id))],
      nextCursor: remaining.length ? inboxCursor({ ...progress, step: progress.step + 1 }) : null,
      retryAfter: retryAt && Number.isFinite(retryAt) ? Math.max(1, Math.ceil((retryAt - now) / 1000)) : null };
  });
}

export async function readInboxConversation(db: Database, user: string, workspace: string, id: string, data: unknown, deps = defaultSocialDeps()) {
  const { cursor } = z.object({ cursor: z.string().max(512_000).optional() }).strict().parse(data);
  const loaded = await withInbox(db, user, workspace, deps, (tx, tenant) => inboxItem(tx, tenant, id));
  const { account, item } = loaded;
  const view = accountView(account);
  const scope = digest(["detail", workspace, user, item.id, account.version]);
  const position = cursor ? openInboxCursor(cursor, detailCursor) : null;
  const expiry = position?.expiry ?? deps.now().getTime() + ttl;
  if (position && (position.scope !== scope || expiry <= deps.now().getTime())) throw publishConflict("INBOX_CURSOR_STALE");
  const local = () => withInbox(db, user, workspace, deps, async (tx, tenant) => {
    const current = await inboxItem(tx, tenant, id);
    if (accountSet([current.account]) !== accountSet([account])) throw publishConflict("INBOX_CURSOR_STALE");
    const [meta] = await metadata(tx, tenant, user, [current.item]);
    return { item: publicItem(meta), account: view };
  });
  if (view.state !== "available" || view.capabilities[readCapability[item.kind]] === "unavailable") {
    return { ...await local(), state: view.state === "available" ? "unavailable" : view.state, retryAfter: null };
  }
  try {
    const { provider, credential } = providerAccess(account, deps);
    const object = { accountRef: account.externalAccountRef, platform: account.platform, kind: item.kind, ref: item.providerRef };
    const page = await timeBound(signal => provider.readInbox(credential, { ...object, cursor: position?.cursor, limit: 25, signal }));
    if (page.nextCursor && (page.nextCursor.length > 20_000 || page.nextCursor === position?.cursor)) throw new SocialProviderError("UNAVAILABLE");
    const eligible = await Promise.all(inboxModes[item.kind].map(async mode => {
      if (view.capabilities[replyCapability[mode]] === "unavailable") return [mode, { allowed: false, reason: "unavailable" }] as const;
      if (mode !== "message") return [mode, { allowed: false, reason: "select_target" }] as const;
      try {
        const selection = await timeBound(signal => provider.inboxReplyEligibility(credential, { ...object, mode, targetRef: null, signal }));
        return [mode, selection.allowed && selection.expiresAt && selection.expiresAt <= deps.now() ? { allowed: false, reason: "expired_window" } : selection] as const;
      } catch { return [mode, { allowed: false, reason: "unavailable" }] as const; }
    }));
    const eligibility = Object.fromEntries(eligible);
    const messages = [...new Map(page.items.map(entry => [entry.ref, entry])).values()].map(entry => ({
      ...entry, capabilities: { quote: view.capabilities.quoteReply !== "unavailable" && eligibility.message?.allowed === true && !entry.deleted,
        commentReply: item.kind === "comment" && entry.canReply === true && view.capabilities.commentReply !== "unavailable",
        privateReply: item.kind === "comment" && entry.canPrivateReply === true && view.capabilities.privateReply !== "unavailable"
          && !!entry.at && entry.at.getTime() + 7 * 86_400_000 > deps.now().getTime(),
        mentionReply: item.kind === "mention" && entry.canReply === true && view.capabilities.mentionReply !== "unavailable" },
    }));
    return { ...await local(), state: "available", title: page.title ?? null, messages, eligibility,
      nextCursor: page.nextCursor ? inboxCursor({ version: 1, scope, expiry, cursor: page.nextCursor }) : null, retryAfter: null };
  } catch (error) {
    if (error instanceof AccessError) throw error;
    if (error instanceof SocialProviderError && error.code === "NOT_FOUND") throw unavailable();
    const state = readState(error);
    const retryAfter = error instanceof SocialProviderError ? error.retryAfterMs : null;
    return { ...await local(), state, retryAfter: state === "delayed" ? Math.max(1, Math.ceil((retryAfter ?? 2_000) / 1000)) : null };
  }
}

export async function inboxSidebar(db: Database, user: string, workspace: string, deps = defaultSocialDeps()) {
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    const accounts = await inboxAccounts(tx, tenant);
    const rows = await tx.execute<{ connection_id: string } & Record<Folder, number>>(sql`
      select i.connection_id, count(*)::int as "all",
        (count(*) filter (where r.reader_id is null or i.activity_at > r.read_through))::int as unread,
        (count(*) filter (where i.assignee_id = ${user}))::int as assigned,
        (count(*) filter (where i.status = 'open'))::int as open,
        (count(*) filter (where i.status = 'done'))::int as done,
        (count(*) filter (where i.starred))::int as starred,
        (count(*) filter (where i.kind = 'mention'))::int as mentions,
        (count(*) filter (where i.kind = 'comment'))::int as comments,
        (count(*) filter (where i.kind in ('dm','story')))::int as dms
      from public.social_inbox_items i left join public.social_inbox_reads r
        on (r.tenant_id,r.item_id,r.reader_id) = (i.tenant_id,i.id,${user})
      where i.tenant_id = ${tenant} group by i.connection_id`);
    const blank = () => Object.fromEntries(folders.map(folder => [folder, 0])) as Record<Folder, number>;
    const counts = blank(), platforms = new Map<string, { platform: string; counts: Record<Folder, number>; accounts: unknown[] }>();
    for (const row of accounts) {
      const account = accountView(row);
      const values = rows.rows.find(item => item.connection_id === account.id);
      const local = blank();
      const platform = platforms.get(account.platform) ?? { platform: account.platform, counts: blank(), accounts: [] };
      for (const folder of folders) {
        local[folder] = values?.[folder] ?? 0;
        counts[folder] += local[folder];
        platform.counts[folder] += local[folder];
      }
      platform.accounts.push({ ...account, counts: local });
      platforms.set(account.platform, platform);
    }
    const labels = await tx.select().from(socialInboxLabels).where(and(eq(socialInboxLabels.tenantId, tenant), eq(socialInboxLabels.archived, false)))
      .orderBy(asc(socialInboxLabels.name), asc(socialInboxLabels.id));
    const assignees = await tx.select({ id: workspaceMembers.userId, name: users.name }).from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id)).where(and(eq(workspaceMembers.tenantId, tenant),
        inArray(workspaceMembers.roleId, ["owner", "admin"]))).orderBy(asc(users.name), asc(users.id));
    const [signal] = await tx.select({ latest: sql<string | null>`max(${socialWebhookEvents.receivedAt})::text`, total: sql<string>`count(*)::text` })
      .from(socialWebhookEvents).where(and(eq(socialWebhookEvents.tenantId, tenant), sql`${socialWebhookEvents.processedAt} is not null`,
        inArray(socialWebhookEvents.eventType, ["message.received", "message.sent", "message.failed", "comment.received", "mention.received"])));
    const result = { coverage: "discovered" as const, folders: counts, platforms: [...platforms.values()], labels, assignees,
      activityRevision: digest([signal, accountSet(accounts)]) };
    return { ...result, etag: `"${digest(result)}"` };
  });
}

export async function searchInboxMetadata(db: Database, user: string, workspace: string, data: unknown, deps: SocialDeps = defaultSocialDeps()) {
  const { after, ...filters } = filterInput.extend({ after: z.uuid().optional() }).strict().parse(data);
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    const accounts = selection(filters, await inboxAccounts(tx, tenant));
    if (!accounts.length) return { items: [], after: null };
    const row = socialInboxItems, read = socialInboxReads, label = socialInboxItemLabels, note = socialInboxNotes;
    const kind = filters.kind ? eq(row.kind, filters.kind)
      : filters.folder === "mentions" ? eq(row.kind, "mention") : filters.folder === "comments" ? eq(row.kind, "comment")
        : filters.folder === "dms" ? inArray(row.kind, ["dm", "story"]) : undefined;
    const status = filters.status ? eq(row.status, filters.status)
      : filters.folder === "open" || filters.folder === "done" ? eq(row.status, filters.folder) : undefined;
    const now = deps.now();
    const rows = await tx.select({ item: row }).from(row).leftJoin(read,
      and(eq(row.tenantId, read.tenantId), eq(row.id, read.itemId), eq(read.readerId, user))).where(and(
      eq(row.tenantId, tenant), inArray(row.connectionId, accounts.map(account => account.id)), kind, status,
      after ? gt(row.id, after) : undefined, filters.assignee ? eq(row.assigneeId, filters.assignee) : undefined,
      filters.folder === "assigned" ? eq(row.assigneeId, user) : undefined,
      filters.folder === "starred" ? eq(row.starred, true) : undefined,
      filters.folder === "unread" ? or(isNull(read.readerId), gt(row.activityAt, read.readThrough)) : undefined,
      filters.snoozed === true ? gt(row.snoozedUntil, now) : filters.snoozed === false ? or(isNull(row.snoozedUntil), lte(row.snoozedUntil, now)) : undefined,
      filters.label ? inArray(row.id, tx.select({ id: label.itemId }).from(label).innerJoin(socialInboxLabels,
        and(eq(label.tenantId, socialInboxLabels.tenantId), eq(label.labelId, socialInboxLabels.id), eq(socialInboxLabels.archived, false)))
        .where(and(eq(label.tenantId, tenant), eq(label.labelId, filters.label)))) : undefined,
      filters.note ? inArray(row.id, tx.select({ id: note.itemId }).from(note).where(and(eq(note.tenantId, tenant), ilike(note.note, likePattern(filters.note))))) : undefined,
    )).orderBy(asc(row.id)).limit(51);
    const visible = await metadata(tx, tenant, user, rows.slice(0, 50).map(result => result.item));
    const byId = new Map(accounts.map(account => [account.id, accountView(account)]));
    return { items: visible.map(entry => ({ ...publicItem(entry), account: byId.get(entry.item.connectionId)! })),
      after: rows.length > 50 ? visible.at(-1)!.item.id : null };
  });
}

export function listInboxNotes(db: Database, user: string, workspace: string, item: string, deps = defaultSocialDeps()) {
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    await inboxItem(tx, tenant, item);
    const notes = await tx.select().from(socialInboxNotes).where(and(eq(socialInboxNotes.tenantId, tenant), eq(socialInboxNotes.itemId, item)))
      .orderBy(desc(socialInboxNotes.createdAt), desc(socialInboxNotes.id)).limit(100);
    return { notes };
  });
}
