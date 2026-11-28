import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { Database } from "../src/db/request";
import { communities, contacts, users, workspaceMembers } from "../src/db/schema";
import { qaAcceptedUserDomains, qaSyntheticEmail } from "../src/server/qa-preview-gate";
import { createWorkspace, listWorkspaces, putMember } from "../src/server/workspaces";
import { createContact, getContact, recordConsent } from "../src/server/contacts";
import { createCommunity, getCommunity, listCategories, listCommunities, publishCommunity, updateCommunity } from "../src/server/communities";
import { enterCommunity } from "../src/server/community-joining";
import { listPosts, saveComment, savePost } from "../src/server/community-forum";
import { chatState, saveChatSettings, sendChatMessage } from "../src/server/community-chat";
import { dmStart } from "../src/server/community-dm";
import { createDraft, finishDraft, saveDraftStep } from "../src/server/campaign-wizard";
import { campaignTemplates } from "../src/lib/campaign-wizard";
import { createCampaignMilestone, createCampaignTask, getCampaignBoards } from "../src/server/campaign-boards";
import { getEvent, saveEvent, transitionEvent } from "../src/server/events";
import { listCampaignEvents, setCampaignEvent } from "../src/server/campaign-events";
import { createFundraising, recordGift, recordPledge, updateFundraising } from "../src/server/fundraising";
import {
  addNewsletterSubscriber, createNewsletterAudience, createNewsletterList, pageNewsletterConfiguration, setNewsletterSubscription,
} from "../src/server/newsletter";
import { withTenant } from "../src/server/tenancy";
import type { SocialDeps } from "../src/server/social/registry";
import { linkConnection, listConnections } from "../src/server/social/service";
import { saveDraft } from "../src/server/social/drafts";
import { preparePreviewPoints, seedChurchFeatures, type PreviewMedia } from "./qa-preview-features";
import { seedPreviewNewsletterCampaigns } from "./qa-preview-newsletter";

/**
 * QA-1 fake data for a preview or staging copy. Every write goes through the app's own service functions as the
 * acting fake user, so permissions, row-level security, audits and rate limits apply as in real use. The only direct
 * write is the account row, which the sign-in flow would otherwise create. Fixed names and derived ids make every run
 * produce the same data, and each step looks for its record before creating it, so a rerun adds nothing.
 */
const NAMESPACE = "harvest-qa-preview-v1";
export const qaUuid = (name: string) => {
  const hex = createHash("sha256").update(`${NAMESPACE}:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const given = ["Avery", "Blake", "Casey", "Dana", "Emery", "Finley", "Harper", "Jordan", "Kendall", "Logan", "Morgan", "Parker"];
export const qaPeople = given.map((first, index) => {
  const number = String(index + 1).padStart(2, "0");
  const id = qaUuid(`person-${number}`);
  return { id, name: `${first} Sample ${number}`, email: `${id}@example.invalid` };
});
export const QA_PREFIX = "QA Preview ";
const ministries = [
  { key: "church", name: "QA Preview Church", audience: "church", community: { slug: "qa-preview-church-circle", name: "QA Preview Prayer Circle" },
    campaign: { type: "conference", name: "QA Preview Family Conference", country: "Kenya", city: "Nairobi", zone: "Africa/Nairobi" } },
  { key: "nonprofit", name: "QA Preview Nonprofit", audience: "ministry_nonprofit", community: { slug: "qa-preview-volunteers", name: "QA Preview Volunteers" } },
  { key: "evangelist", name: "QA Preview Evangelist", audience: "evangelist_missionary",
    campaign: { type: "mission_trip", name: "QA Preview Coastal Mission", country: "Romania", city: "Constanta", zone: "Europe/Bucharest" } },
] as const;
const roles = ["owner", "admin", "member", "viewer"] as const;
const staffOf = (index: number) => Object.fromEntries(roles.map((role, offset) => [role, qaPeople[index * 4 + offset]])) as Record<typeof roles[number], typeof qaPeople[number]>;

export type QaSeedSummary = { ministries: number; people: number; contacts: number; communities: number; members: number; posts: number; comments: number;
  chatMessages: number; campaigns: number; tasks: number; milestones: number; events: number; fundraisers: number; pledges: number;
  gifts: number; newsletterLists: number; subscribers: number; socialConnections: number; socialDrafts: number; social: "seeded" | "skipped" };

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const status = (error: unknown) => (error as { status?: number }).status;
async function tolerate<T>(codes: number[], run: () => Promise<T>): Promise<T | undefined> {
  try { return await run(); } catch (error) { if (codes.includes(status(error) ?? 0)) return undefined; throw error; }
}
function ok<T extends { outcome?: unknown }>(result: T, step: string): T {
  if (result.outcome !== "ok") throw new Error(`QA_SEED_STEP_FAILED:${step}:${String(result.outcome)}`);
  return result;
}

/** Refuses a database that holds any account outside the synthetic domains, or a connection that is not the RLS-bound app role. */
export async function assertQaSeedDatabase(db: Database) {
  const [role] = (await db.execute<{ name: string; bypass: boolean; superuser: boolean }>(sql`
    select current_user as name, r.rolbypassrls as bypass, r.rolsuper as superuser from pg_roles r where r.rolname = current_user`)).rows;
  if (role?.name !== "harvest_app" || role.bypass || role.superuser) throw new Error("QA_SEED_ROLE_REFUSED");
  const domains = qaAcceptedUserDomains.map((domain) => `@${domain}`);
  const [found] = (await db.execute<{ n: number }>(sql`
    select count(*)::int as n from public.users where not (lower(email) like any (${sql.param(domains.map((domain) => `%${domain}`))}::text[]))`)).rows;
  if (found?.n !== 0) throw new Error("QA_SEED_NON_SYNTHETIC_USERS");
}

export async function seedQaPreview(db: Database, options: { social?: SocialDeps; media?: PreviewMedia; newsletterWorker?: Pool } = {}): Promise<QaSeedSummary> {
  if ([process.env.NODE_ENV, process.env.HARVEST_ENV, process.env.VERCEL_ENV, process.env.VERCEL_TARGET_ENV].includes("production")) {
    throw new Error("QA_SEED_ENV_REFUSED");
  }
  await assertQaSeedDatabase(db);
  if (!qaPeople.every((person) => qaSyntheticEmail(person.email))) throw new Error("QA_SEED_IDENTITY_INVALID");
  // Accounts: the one direct write. Better Auth creates this row at first sign-in; nothing else about the account is set.
  await db.insert(users).values(qaPeople.map((person) => ({ ...person, emailVerified: true }))).onConflictDoNothing({ target: users.id });
  const stored = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, qaPeople.map((person) => person.id)));
  if (stored.length !== qaPeople.length || stored.some((row) => qaPeople.find((person) => person.id === row.id)?.email !== row.email)) {
    throw new Error("QA_SEED_IDENTITY_COLLISION");
  }

  const tenants: string[] = [];
  for (const [index, ministry] of ministries.entries()) {
    const staff = staffOf(index);
    const existing = (await listWorkspaces(db, staff.owner.id)).filter((row) => row.name === ministry.name && row.createdBy === staff.owner.id);
    if (existing.length > 1) throw new Error("QA_SEED_MINISTRY_COLLISION");
    const tenant = existing[0]?.tenantId ?? (await createWorkspace(db, staff.owner.id, ministry.name, ministry.audience, "UTC")).tenantId;
    tenants.push(tenant);
    const members = await withTenant(db, staff.owner.id, tenant, "workspace:read", (tx, tenantId) =>
      tx.select({ userId: workspaceMembers.userId, roleId: workspaceMembers.roleId }).from(workspaceMembers).where(eq(workspaceMembers.tenantId, tenantId)));
    for (const role of ["admin", "member", "viewer"] as const) {
      if (!members.some((row) => row.userId === staff[role].id && row.roleId === role)) await putMember(db, staff.owner.id, tenant, staff[role].email, role);
    }
    await seedContacts(db, staff.owner.id, tenant, ministry.key);
    if ("campaign" in ministry) await seedCampaign(db, index, tenant, ministry.key, ministry.campaign);
    const community = "community" in ministry ? await seedCommunity(db, index, tenant, ministry.community) : null;
    const listId = await seedNewsletter(db, staff.owner.id, tenant, ministry.key);
    if (ministry.key === "church" && community) {
      await seedChurchFeatures(db, community, { media: options.media, socialCredential: options.social && QA_SOCIAL_CREDENTIAL });
      await seedPreviewNewsletterCampaigns(db, staff.owner.id, tenant, listId, options.newsletterWorker);
    }
  }
  const social = options.social ? await seedSocial(db, tenants[0], options.social) : null;
  return summarize(db, tenants, social);
}

async function seedContacts(db: Database, owner: string, tenant: string, key: string) {
  for (let n = 1; n <= 6; n++) {
    const name = `QA Contact ${key} ${String(n).padStart(2, "0")}`;
    const found = await withTenant(db, owner, tenant, "contacts:read", (tx, tenantId) =>
      tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.name, name))));
    const contact = found[0] ?? await createContact(db, owner, tenant,
      { name, email: `${qaUuid(`contact-${key}-${n}`)}@example.invalid`, notes: "Fake record for testing." });
    // The church needs a visible newsletter cohort. The two other ministries show a mix of consent states.
    if ((key === "church" || n <= 4) &&
        (!found.length || !(await getContact(db, owner, tenant, contact.id)).consents.some((event) => event.purpose === "newsletter"))) {
      await recordConsent(db, owner, tenant, contact.id, { noticeVersion: "notice-v1", purpose: "newsletter", channel: "email", status: "granted",
        source: "QA fake data", evidence: "Synthetic consent for testing only.", occurredAt: "2026-10-01T09:00:00Z" });
    }
  }
}

async function seedCommunity(db: Database, index: number, tenant: string, spec: { slug: string; name: string }) {
  const staff = staffOf(index);
  const owner = staff.owner.id;
  let community = (await listCommunities(db, owner, tenant)).find((row) => row.slug === spec.slug);
  if (!community) community = await createCommunity(db, owner, tenant, { name: spec.name, slug: spec.slug, tagline: "Fake community for testing." });
  let current = await getCommunity(db, owner, tenant, community.id);
  if (current.status !== "published") {
    // Unlisted: reachable by link for testing, never offered in Discover.
    current = await updateCommunity(db, owner, tenant, community.id, { version: current.version, visibility: "unlisted", allowOpen: true,
      description: "A fake community used to test Harvest. Every person and message here is invented." });
    await publishCommunity(db, owner, tenant, community.id, { version: current.version, published: true });
  }
  // Members: the ministry's member and viewer, plus two people from the other ministries.
  const joiners = [staff.member, staff.viewer, qaPeople[(index * 4 + 5) % 12], qaPeople[(index * 4 + 10) % 12]];
  const { rulesVersion } = await getCommunity(db, owner, tenant, community.id);
  for (const person of joiners) await enterCommunity(db, person.id, spec.slug, { rulesVersion, adult: true });

  const church = { owner, tenant, community: community.id, slug: spec.slug, admin: staff.admin.id, member: staff.member.id, viewer: staff.viewer.id };
  if (index === 0) await preparePreviewPoints(db, church);
  const category = (await listCategories(db, owner, tenant, community.id))[0].id;
  const titles = (await listPosts(db, owner, spec.slug)).posts.map((post) => post.title);
  const authors = [owner, ...joiners.map((person) => person.id)];
  for (let n = 1; n <= 4; n++) {
    const title = `Fake discussion ${n}`;
    if (titles.includes(title)) continue;
    const post = await savePost(db, authors[n % authors.length], spec.slug, { categoryId: category, title, body: doc(`Invented text for discussion ${n}.`) }) as { id?: string; postId?: string };
    const postId = post.id ?? post.postId;
    if (!postId) throw new Error("QA_SEED_STEP_FAILED:post");
    for (let c = 1; c <= 2; c++) await saveComment(db, authors[(n + c) % authors.length], spec.slug, postId, { body: `Fake reply ${c} to discussion ${n}.` });
  }

  const [chat] = await withTenant(db, owner, tenant, "communities:manage", (tx, tenantId) => tx.select({ enabled: communities.chatEnabled, dm: communities.dmPolicy })
    .from(communities).where(and(eq(communities.tenantId, tenantId), eq(communities.id, community.id))));
  if (!chat?.enabled || chat.dm !== "members") await saveChatSettings(db, owner, spec.slug, { chatEnabled: true, dmPolicy: "members" });
  const state = await chatState(db, owner, spec.slug) as { channels?: { id: string; name: string }[] };
  const general = state.channels?.find((channel) => channel.name === "General")?.id;
  if (!general) throw new Error("QA_SEED_STEP_FAILED:chat");
  // Chat send dedupes by (author, client id): a rerun returns the stored message.
  for (let n = 1; n <= 6; n++) {
    const author = authors[n % authors.length];
    ok(await sendChatMessage(db, author, spec.slug, general, { client_id: qaUuid(`chat-${spec.slug}-${n}`), body: `Fake chat message ${n}.` }) as { outcome?: unknown }, "chat");
  }
  ok(await dmStart(db, joiners[0].id, spec.slug, { targetUserId: joiners[1].id, body: "Fake private message for testing.", client_id: qaUuid(`dm-${spec.slug}`) }) as { outcome?: unknown }, "dm");
  return church;
}

async function seedCampaign(db: Database, index: number, tenant: string, key: string,
  spec: { type: "conference" | "mission_trip"; name: string; country: string; city: string; zone: string }) {
  const { owner, admin, member } = staffOf(index);
  const { draft } = await createDraft(db, owner.id, tenant, { type: spec.type }, `qa-preview-${key}-campaign`);
  let campaignId = draft.campaignId;
  if (!campaignId) {
    let version = draft.version;
    const step = async (name: string, data: unknown) => { version = (await saveDraftStep(db, owner.id, tenant, draft.id, { version, step: name, data })).version; };
    await step("basics", { name: spec.name, description: "Fake campaign for testing.", mission: "Invented mission statement." });
    await step("place", { country: spec.country, cityRegion: spec.city, startDate: "2027-05-01", endDate: "2027-05-03", timeZone: spec.zone, structure: "single" });
    await step("tools", { modules: [...new Set([...campaignTemplates[spec.type].modules, "fundraising_donations"])] });
    await step("budget", { currency: "USD", estimatedBudgetMinor: 1_250_000, fundraisingEnabled: true, fundraisingGoalMinor: 2_000_000, onlineDonations: false });
    campaignId = (await finishDraft(db, owner.id, tenant, draft.id, { version })).campaignId;
  }

  const boards = await getCampaignBoards(db, owner.id, tenant, campaignId);
  const titles = new Set(boards.boards.flatMap((board) => board.tasks.map((task) => task.title)));
  const second = boards.boards.find((board) => board.key !== "general")?.key ?? "general";
  const tasks = [
    { board: "general", title: "Fake task: confirm venue", status: "done", assigneeId: admin.id },
    { board: "general", title: "Fake task: draft schedule", status: "in_progress", assigneeId: member.id },
    { board: second, title: "Fake task: recruit helpers", status: "todo", assigneeId: member.id, dueDate: "2027-04-01" },
    { board: second, title: "Fake task: order supplies", status: "todo", dueDate: "2027-04-15" },
  ];
  for (const task of tasks) if (!titles.has(task.title)) await createCampaignTask(db, owner.id, tenant, campaignId, task);
  if (!boards.milestones.some((milestone) => milestone.title === "Fake milestone: registration open")) {
    await createCampaignMilestone(db, owner.id, tenant, campaignId, { title: "Fake milestone: registration open", dueDate: "2027-03-01" });
  }

  const eventId = qaUuid(`event-${key}`);
  let event = await tolerate([404], () => getEvent(db, owner.id, tenant, eventId));
  if (!event) {
    const saved = await saveEvent(db, owner.id, tenant, eventId, { version: 0, title: `${spec.name} opening night`, description: "Fake event for testing.",
      timeZone: spec.zone, startsAt: "2027-05-01T17:00:00Z", endsAt: "2027-05-01T20:00:00Z", capacity: 200, location: `${spec.city} (fake venue)` });
    if (saved.outcome !== "ok") throw new Error("QA_SEED_STEP_FAILED:event");
    event = saved.event;
  }
  if (event.status !== "published") await transitionEvent(db, owner.id, tenant, eventId, { action: "publish", version: event.version });
  const linked = await listCampaignEvents(db, owner.id, tenant, campaignId);
  if (!linked?.events.some((row) => row.id === eventId)) await setCampaignEvent(db, owner.id, tenant, campaignId, { eventId, linked: true });

  let fund = await createFundraising(db, owner.id, tenant, { title: `${spec.name} fund`, summary: "Fake fundraiser for testing.", campaignId }, `qa-preview-${key}-fund`);
  if (fund.status === "draft") fund = await updateFundraising(db, owner.id, tenant, fund.id, { version: fund.version, action: "open" });
  const pledges = [["01", "25000"], ["02", "50000"], ["03", "10000"]] as const;
  for (const [n, amount] of pledges) {
    await recordPledge(db, owner.id, tenant, fund.id, { amountCents: amount, supporterName: `Fake Supporter ${n}`, expectedOn: "2027-03-01" }, `qa-preview-${key}-pledge-${n}`);
  }
  for (const [n, amount] of [["01", "15000"], ["02", "40000"]] as const) {
    await recordGift(db, owner.id, tenant, fund.id, { amountCents: amount, giftDate: "2026-10-15", supporterName: `Fake Supporter ${n}`, methodLabel: "Cash (fake)", confirmed: true },
      `qa-preview-${key}-gift-${n}`);
  }
}

async function seedNewsletter(db: Database, owner: string, tenant: string, key: string) {
  const audiences = (await pageNewsletterConfiguration(db, owner, tenant, "audiences")).items;
  const audience = audiences.find((row) => row.name === "QA Preview supporters") ?? await createNewsletterAudience(db, owner, tenant, { name: "QA Preview supporters" });
  const lists = (await pageNewsletterConfiguration(db, owner, tenant, "lists")).items;
  const list = lists.find((row) => row.name === "QA Preview monthly update") ?? await createNewsletterList(db, owner, tenant, audience.id, { name: "QA Preview monthly update" });
  for (let n = 1; n <= (key === "church" ? 6 : 4); n++) {
    const name = `QA Contact ${key} ${String(n).padStart(2, "0")}`;
    const [contact] = await withTenant(db, owner, tenant, "contacts:read", (tx, tenantId) =>
      tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.name, name))));
    const subscriber = await addNewsletterSubscriber(db, owner, tenant, { contactId: contact.id });
    // A rerun finds the subscription already at version 1: the stale-version refusal means it is already there.
    await tolerate([409], () => setNewsletterSubscription(db, owner, tenant, list.id, subscriber.id, { state: "subscribed", version: 0 }));
  }
  return list.id;
}

async function seedSocial(db: Database, tenant: string, deps: SocialDeps) {
  const owner = staffOf(0).owner.id;
  const connections = (await listConnections(db, owner, tenant, deps)) as unknown as { connections?: { id: string; platform: string; status?: string }[] };
  let connection = connections.connections?.find((row) => row.platform === "instagram" && row.status !== "revoked")?.id;
  if (!connection) {
    connection = ((await linkConnection(db, owner, tenant, { provider: "fake", credential: QA_SOCIAL_CREDENTIAL, accountRef: "test-instagram" }, deps)) as { connection: { id: string } }).connection.id;
  }
  const [{ n }] = (await withTenant(db, owner, tenant, "social:schedule", (tx, tenantId) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from public.social_drafts where tenant_id = ${tenantId}::uuid`))).rows;
  for (let index = n; index < 2; index++) {
    await saveDraft(db, owner, tenant, { type: "post", content: `Fake post ${index + 1} for testing.`, connectionIds: [connection] }, deps);
  }
  return true;
}
/** The fixed public test credential the in-memory provider accepts (see social-publish-gate.ts); not a secret. */
export const QA_SOCIAL_CREDENTIAL = "harvest-test-credential";

/** Events are read only through their definer function, as the app reads them. */
async function eventCount(db: Database, tenants: string[]) {
  let total = 0;
  for (const [index, ministry] of ministries.entries()) {
    if ("campaign" in ministry && await tolerate([404], () => getEvent(db, staffOf(index).owner.id, tenants[index], qaUuid(`event-${ministry.key}`)))) total++;
  }
  return total;
}

async function summarize(db: Database, tenants: string[], social: boolean | null): Promise<QaSeedSummary> {
  const ids = qaPeople.map((person) => person.id);
  const count = async (query: ReturnType<typeof sql>) => {
    let total = 0;
    for (const [index, tenant] of tenants.entries()) {
      const rows = await withTenant(db, staffOf(index).owner.id, tenant, "workspace:read", (tx) => tx.execute<{ n: number }>(query));
      total += rows.rows[0]?.n ?? 0;
    }
    return total;
  };
  const scoped = (table: string) => sql`select count(*)::int as n from ${sql.raw(`public.${table}`)} where tenant_id = current_setting('app.tenant_id')::uuid`;
  return {
    ministries: tenants.length, people: ids.length,
    contacts: await count(scoped("contacts")), communities: await count(scoped("communities")),
    members: await count(sql`select count(*)::int as n from public.community_memberships where tenant_id = current_setting('app.tenant_id')::uuid and status = 'active'`),
    posts: await count(scoped("community_posts")), comments: await count(scoped("community_comments")),
    chatMessages: await count(scoped("community_messages")),
    campaigns: await count(scoped("campaigns")), tasks: await count(scoped("campaign_tasks")), milestones: await count(scoped("campaign_milestones")),
    events: await eventCount(db, tenants), fundraisers: await count(scoped("fundraising_campaigns")), pledges: await count(scoped("fundraising_pledges")),
    gifts: await count(scoped("giving_ledger_entries")), newsletterLists: await count(scoped("newsletter_lists")),
    subscribers: await count(sql`select count(*)::int as n from public.newsletter_subscriptions where tenant_id = current_setting('app.tenant_id')::uuid and state = 'subscribed'`),
    socialConnections: social ? await count(sql`select count(*)::int as n from public.social_connections where tenant_id = current_setting('app.tenant_id')::uuid and status <> 'revoked'`) : 0,
    socialDrafts: social ? await count(scoped("social_drafts")) : 0, social: social ? "seeded" : "skipped",
  };
}
