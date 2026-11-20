import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { files, socialAutoDmJobs, socialAutoDmRules, socialConnections, socialPosts, workspaceMembers } from "../../db/schema";
import { autoDmCapabilities, autoDmRuleInput, matchAutoDm, renderAutoDm, type AutoDmRule } from "../../lib/social/auto-dm";
import { socialPlatforms } from "../../lib/social/platforms";
import { auditInbox, digest, inboxAccounts, withInbox } from "./inbox-access";
import { inboxCursor, openInboxCursor } from "./inbox-tokens";
import { publishConflict, publishInvalid, recordId, unavailable, versionInput } from "./publish-access";
import { defaultSocialDeps, type SocialDeps } from "./registry";

type RuleRow = typeof socialAutoDmRules.$inferSelect;
const view = (r: RuleRow) => ({ id: r.id, connectionId: r.connectionId, version: r.version, enabled: r.enabled,
  updatedAt: r.updatedAt, ...r.rule });
const key = (tenant: string, id: string) => and(eq(socialAutoDmRules.tenantId, tenant), eq(socialAutoDmRules.id, recordId(id)));

async function inspectRule(tx: Transaction, tenant: string, id: string, rule: AutoDmRule, activation = false) {
  const [account] = await tx.select().from(socialConnections)
    .where(and(eq(socialConnections.tenantId, tenant), eq(socialConnections.id, id))).for("share");
  if (!account) throw unavailable();
  if (autoDmCapabilities(account.platform)[rule.trigger] === "unavailable") throw publishInvalid("AUTO_DM_TRIGGER_UNAVAILABLE");
  if (activation && (account.status !== "active" || account.health === "failing")) throw publishConflict("AUTO_DM_ACCOUNT_UNAVAILABLE");
  if (rule.postId) {
    const [post] = await tx.select().from(socialPosts).where(and(eq(socialPosts.tenantId, tenant), eq(socialPosts.connectionId, id),
      eq(socialPosts.id, rule.postId))).for("share");
    if (!post) throw unavailable();
    if (activation && (post.status !== "published" || !post.providerPostRef)) throw publishConflict("AUTO_DM_POST_NOT_LIVE");
  }
  if (rule.handoffUserId) {
    const [member] = await tx.select().from(workspaceMembers)
      .where(and(eq(workspaceMembers.tenantId, tenant), eq(workspaceMembers.userId, rule.handoffUserId)));
    if (!member || !["owner", "admin"].includes(member.roleId)) throw unavailable();
  }
  if (rule.response.fileId) {
    const [file] = await tx.select().from(files).where(and(eq(files.tenantId, tenant), eq(files.id, rule.response.fileId)));
    if (!file || !file.socialUpload || file.status !== "ready" || file.socialRetiredAt) throw unavailable();
    if (!["image/jpeg", "image/png", "video/mp4"].includes(file.mime) || file.size > (file.mime === "video/mp4" ? 16_000_000 : 8_000_000))
      throw publishInvalid("AUTO_DM_MEDIA_UNAVAILABLE");
  }
  return account.version;
}

export function listAutoDmRules(db: Database, user: string, workspace: string, deps: SocialDeps = defaultSocialDeps()) {
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    const rows = await tx.select().from(socialAutoDmRules).where(eq(socialAutoDmRules.tenantId, tenant))
      .orderBy(asc(socialAutoDmRules.id)).limit(250);
    const accounts = await inboxAccounts(tx, tenant);
    return { rules: rows.map(view), accounts: accounts.map(row => ({
      id: row.id, platform: row.platform, name: row.displayName, status: row.status, health: row.health, triggers: autoDmCapabilities(row.platform),
    })) };
  }, "social:auto_dm");
}

export function createAutoDmRule(db: Database, user: string, workspace: string, raw: unknown, deps: SocialDeps = defaultSocialDeps()) {
  const input = z.object({ connectionId: z.uuid(), rule: autoDmRuleInput }).strict().parse(raw);
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    await inspectRule(tx, tenant, input.connectionId, input.rule);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenant}::text, 715))`);
    const [count] = await tx.select({ count: sql<number>`count(*)::int` }).from(socialAutoDmRules).where(eq(socialAutoDmRules.tenantId, tenant));
    if (count.count >= 250) throw publishConflict("AUTO_DM_RULE_LIMIT");
    const [row] = await tx.insert(socialAutoDmRules).values({ tenantId: tenant, connectionId: input.connectionId, postId: input.rule.postId, rule: input.rule }).returning();
    await auditInbox(tx, tenant, user, "auto_dm_create", row.id, row.version);
    return { rule: view(row) };
  }, "social:auto_dm");
}

const reviewToken = z.object({ kind: z.literal("auto_dm_enable"), id: z.uuid(), tenant: z.uuid(), user: z.string(),
  version: versionInput, connection: z.number().int(), digest: z.string(), expires: z.number() }).strict();
const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), version: versionInput, rule: autoDmRuleInput }).strict(),
  z.object({ action: z.literal("review"), version: versionInput }).strict(),
  z.object({ action: z.literal("enable"), version: versionInput, reviewToken: z.string().max(4_000) }).strict(),
  z.object({ action: z.literal("disable"), version: versionInput }).strict(),
]);

export function changeAutoDmRule(db: Database, user: string, workspace: string, id: string, raw: unknown, deps: SocialDeps = defaultSocialDeps()) {
  const action = actionInput.parse(raw);
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    const [initial] = await tx.select().from(socialAutoDmRules).where(key(tenant, id));
    if (!initial) throw unavailable();
    const enabling = action.action === "review" || action.action === "enable";
    // Connection locks precede rule locks, the same order as dispatch and disconnect.
    const connection = action.action === "disable" ? null
      : await inspectRule(tx, tenant, initial.connectionId, action.action === "edit" ? action.rule : initial.rule, enabling);
    const [row] = await tx.select().from(socialAutoDmRules).where(key(tenant, id)).for("update");
    if (!row || row.version !== action.version || row.version !== initial.version) throw publishConflict();
    if (enabling && row.enabled) throw publishConflict("AUTO_DM_ALREADY_ENABLED");

    const spec = { kind: "auto_dm_enable" as const, id, tenant, user, version: row.version, connection, digest: digest(row.rule) };
    const now = deps.now();
    if (action.action === "review") return { rule: view(row), review: { expiresAt: new Date(now.getTime() + 600_000),
      token: inboxCursor({ ...spec, expires: now.getTime() + 600_000 }) } };
    if (action.action === "enable") {
      const { expires, ...actual } = openInboxCursor(action.reviewToken, reviewToken);
      if (expires <= now.getTime() || digest(actual) !== digest(spec)) throw publishConflict("AUTO_DM_REVIEW_REQUIRED");
    }
    const enabled = action.action === "enable";
    const [updated] = await tx.update(socialAutoDmRules).set({
      ...(action.action === "edit" ? { rule: action.rule, postId: action.rule.postId } : {}),
      enabled, enabledAt: enabled ? now : null, enabledBy: enabled ? user : null, updatedAt: now, version: row.version + 1,
    }).where(key(tenant, id)).returning();
    await auditInbox(tx, tenant, user, `auto_dm_${action.action}`, id, updated.version);
    return { rule: view(updated) };
  }, "social:auto_dm");
}

export function autoDmActivity(db: Database, user: string, workspace: string, id: string, before?: string | null, deps: SocialDeps = defaultSocialDeps()) {
  const cursor = before ? z.iso.datetime({ offset: true }).parse(before) : null;
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    const [rule] = await tx.select().from(socialAutoDmRules).where(key(tenant, id));
    if (!rule) throw unavailable();
    const j = socialAutoDmJobs;
    const scope = and(eq(j.tenantId, tenant), eq(j.ruleId, id));
    const activity = await tx.select({ id: j.id, eventId: j.eventId, version: j.ruleVersion, state: j.state, reason: j.reason, step: j.step,
      createdAt: j.createdAt, completedAt: j.completedAt }).from(j)
      .where(and(scope, cursor ? lt(j.createdAt, new Date(cursor)) : undefined)).orderBy(desc(j.createdAt), desc(j.id)).limit(50);
    const counts = await tx.select({ state: j.state, reason: j.reason, count: sql<number>`count(*)::int` }).from(j)
      .where(and(scope, eq(j.step, "primary"))).groupBy(j.state, j.reason);
    return { rule: view(rule), triggered: counts.reduce((sum, entry) => sum + entry.count, 0), counts, activity };
  }, "social:auto_dm");
}

export function previewAutoDmRule(db: Database, user: string, workspace: string, raw: unknown, deps: SocialDeps = defaultSocialDeps()) {
  const input = z.object({ platform: z.enum(socialPlatforms), rule: autoDmRuleInput, sample: z.string().max(2_000).nullable() }).strict().parse(raw);
  return withInbox(db, user, workspace, deps, async () => {
    if (autoDmCapabilities(input.platform)[input.rule.trigger] === "unavailable") throw publishInvalid("AUTO_DM_TRIGGER_UNAVAILABLE");
    return { result: matchAutoDm(input.rule.match, input.sample), response: renderAutoDm(input.rule.response.text, "Example") };
  }, "social:auto_dm");
}
