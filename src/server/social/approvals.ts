import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { socialApprovalNotices, socialApprovals, socialApprovalSettings, socialDrafts, socialPosts, workspaceMembers } from "../../db/schema";
import { AccessError, type Permission } from "../permissions";
import { withTenant } from "../tenancy";
import { auditPublish, publishConflict, publishInvalid, recordId, unavailable, versionInput } from "./publish-access";
import { assertEnabled, type SocialDeps } from "./registry";

// Social approvals. Owners and admins submit and decide; only an owner changes the ministry setting. Everything here is metadata: ids, statuses, versions and a short
// rejection reason. The post text never enters an approval, a notice or an audit row. Proposed role defaults are recorded in docs/acceptance/social-approvals-server.md.
export type ApprovalState = "not_required" | "none" | "pending" | "approved" | "rejected" | "stale";
type Approval = typeof socialApprovals.$inferSelect;

async function withApprovals<T>(db: Database, user: string, workspace: string, deps: SocialDeps, permission: Permission,
  run: (tx: Transaction, tenant: string, role: string) => Promise<T>) {
  assertEnabled(deps);
  try { return await withTenant(db, user, recordId(workspace), permission, run); }
  catch (error) { if (error instanceof AccessError && error.status === 403) throw unavailable(); throw error; }
}
const audit = (tx: Transaction, tenant: string, actor: string, action: string, target: string) => auditPublish(tx, tenant, actor, `social.approval_${action}`, target);

export const approvalView = (a: Approval) => ({ id: a.id, draftId: a.draftId, postId: a.postId, status: a.status, requestedBy: a.requestedBy, requestedAt: a.requestedAt.toISOString(),
  decidedBy: a.decidedBy, decidedAt: a.decidedAt?.toISOString() ?? null, note: a.note, version: a.version });

export async function loadSettings(tx: Transaction, tenant: string) {
  const [row] = await tx.select().from(socialApprovalSettings).where(eq(socialApprovalSettings.tenantId, tenant));
  return row ?? { tenantId: tenant, mode: "off" as const, selfApproval: "owner_only" as const, version: 0, updatedBy: null, updatedAt: new Date(0) };
}
export const settingsView = (s: Awaited<ReturnType<typeof loadSettings>>) => ({ mode: s.mode, selfApproval: s.selfApproval, version: s.version });
export function readApprovalSettings(db: Database, user: string, workspace: string, deps: SocialDeps) {
  return withApprovals(db, user, workspace, deps, "social:approvals", async (tx, tenant) => ({ settings: settingsView(await loadSettings(tx, tenant)) }));
}
const settingsInput = z.object({ mode: z.enum(["off", "required"]), selfApproval: z.enum(["never", "owner_only", "always"]), version: z.number().int().min(0).max(2_147_483_646) }).strict();
/** Owner only. `version` is 0 while the ministry has never saved a setting. */
export async function changeApprovalSettings(db: Database, user: string, workspace: string, raw: unknown, deps: SocialDeps) {
  const input = settingsInput.safeParse(raw);
  if (!input.success) throw publishInvalid("APPROVAL_SETTINGS_INVALID");
  const data = input.data;
  return withApprovals(db, user, workspace, deps, "social:approvals_settings", async (tx, tenant) => {
    const current = await loadSettings(tx, tenant);
    if (current.version !== data.version) throw publishConflict();
    const values = { mode: data.mode, selfApproval: data.selfApproval, updatedBy: user, updatedAt: sql`now()` };
    const [row] = current.version === 0
      ? await tx.insert(socialApprovalSettings).values({ tenantId: tenant, ...values }).returning()
      : await tx.update(socialApprovalSettings).set({ ...values, version: sql`${socialApprovalSettings.version} + 1` }).where(and(eq(socialApprovalSettings.tenantId, tenant), eq(socialApprovalSettings.version, data.version))).returning();
    if (!row) throw publishConflict();
    await audit(tx, tenant, user, `settings_${data.mode}`, tenant);
    return { settings: settingsView(row) };
  });
}

const fingerprint = async (tx: Transaction, draftId: string | null, postId: string | null) => {
  const { rows } = await tx.execute<{ fp: string | null }>(sql`select public.social_approval_fingerprint(${draftId}::uuid, ${postId}::uuid) as fp`);
  return rows[0]?.fp ?? null;
};
async function notify(tx: Transaction, tenant: string, approval: Approval, kind: "requested" | "approved" | "rejected", recipients: string[]) {
  const unique = [...new Set(recipients)];
  if (unique.length) await tx.insert(socialApprovalNotices).values(unique.map(recipientUserId => ({ tenantId: tenant, recipientUserId, approvalId: approval.id, kind })));
}
async function approvers(tx: Transaction, tenant: string, except: string) {
  const rows = await tx.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.tenantId, tenant), inArray(workspaceMembers.roleId, ["owner", "admin"])));
  return rows.map(r => r.userId).filter(id => id !== except);
}

/** State of a draft's approval for the queue and the publish gate. */
export async function approvalStates(tx: Transaction, tenant: string, draftIds: string[]): Promise<{ required: boolean; states: Map<string, { state: ApprovalState; approvalId: string | null }> }> {
  const settings = await loadSettings(tx, tenant);
  const states = new Map<string, { state: ApprovalState; approvalId: string | null }>();
  if (settings.mode !== "required" || !draftIds.length) { for (const id of draftIds) states.set(id, { state: "not_required", approvalId: null }); return { required: settings.mode === "required", states }; }
  const { rows } = await tx.execute<{ id: string; fp: string }>(sql`select id, encode(sha256(convert_to(document::text, 'UTF8')), 'hex') as fp from social_drafts where tenant_id = ${tenant} and id in (${sql.join(draftIds.map(i => sql`${i}::uuid`), sql`, `)})`);
  const current = new Map(rows.map(r => [r.id, r.fp]));
  const approvals = await tx.select().from(socialApprovals).where(and(eq(socialApprovals.tenantId, tenant), inArray(socialApprovals.draftId, draftIds), inArray(socialApprovals.status, ["pending", "approved", "rejected", "superseded"]))).orderBy(desc(socialApprovals.requestedAt));
  for (const id of draftIds) {
    const mine = approvals.filter(a => a.draftId === id);
    const valid = mine.find(a => a.status === "approved" && a.fingerprint === current.get(id));
    const latest = mine[0];
    states.set(id, valid ? { state: "approved", approvalId: valid.id }
      : latest?.status === "pending" && latest.fingerprint === current.get(id) ? { state: "pending", approvalId: latest.id }
      : latest?.status === "rejected" && latest.fingerprint === current.get(id) ? { state: "rejected", approvalId: latest.id }
      : latest ? { state: "stale", approvalId: latest.id } : { state: "none", approvalId: null });
  }
  return { required: true, states };
}

/** Publish now needs a valid approval when the ministry requires one. Scheduling does not: the post waits, and the worker refuses it until it is approved. */
export async function requireApprovalForPublishNow(tx: Transaction, tenant: string, draftId: string) {
  const { required, states } = await approvalStates(tx, tenant, [draftId]);
  if (required && states.get(draftId)?.state !== "approved") throw publishConflict("APPROVAL_REQUIRED");
}
/** An edit after approval invalidates it: every open or granted request for the draft is superseded. */
export async function supersedeApprovals(tx: Transaction, tenant: string, draftId: string, actor: string) {
  const rows = await tx.update(socialApprovals).set({ status: "superseded", version: sql`${socialApprovals.version} + 1` })
    .where(and(eq(socialApprovals.tenantId, tenant), eq(socialApprovals.draftId, draftId), inArray(socialApprovals.status, ["pending", "approved"]))).returning({ id: socialApprovals.id });
  for (const row of rows) await audit(tx, tenant, actor, "superseded", row.id);
}

const requestInput = z.object({ draftId: z.uuid().optional(), postId: z.uuid().optional() }).strict().refine(v => (v.draftId === undefined) !== (v.postId === undefined));
export async function requestApproval(db: Database, user: string, workspace: string, raw: unknown, deps: SocialDeps) {
  const parsed = requestInput.safeParse(raw);
  if (!parsed.success) throw publishInvalid("APPROVAL_REQUEST_INVALID");
  const { draftId = null, postId = null } = parsed.data;
  return withApprovals(db, user, workspace, deps, "social:approvals", async (tx, tenant) => {
    if (draftId) {
      const [draft] = await tx.select({ status: socialDrafts.status }).from(socialDrafts).where(and(eq(socialDrafts.tenantId, tenant), eq(socialDrafts.id, draftId))).for("update");
      if (!draft) throw unavailable();
      if (draft.status === "cancelled") throw publishConflict("DRAFT_CANCELLED");
    } else {
      const [post] = await tx.select({ status: socialPosts.status, draftId: socialPosts.draftId }).from(socialPosts).where(and(eq(socialPosts.tenantId, tenant), eq(socialPosts.id, postId!))).for("update");
      if (!post) throw unavailable();
      // Posts that belong to a draft are approved through the draft.
      if (post.draftId || post.status !== "scheduled" && post.status !== "draft") throw publishConflict("POST_NOT_APPROVABLE");
    }
    const fp = await fingerprint(tx, draftId, postId);
    if (!fp) throw unavailable();
    await tx.update(socialApprovals).set({ status: "superseded", version: sql`${socialApprovals.version} + 1` }).where(and(eq(socialApprovals.tenantId, tenant), eq(socialApprovals.status, "pending"),
      draftId ? eq(socialApprovals.draftId, draftId) : eq(socialApprovals.postId, postId!)));
    const [row] = await tx.insert(socialApprovals).values({ tenantId: tenant, draftId, postId, fingerprint: fp, requestedBy: user }).returning();
    await notify(tx, tenant, row, "requested", await approvers(tx, tenant, user));
    await audit(tx, tenant, user, "request", row.id);
    return { approval: approvalView(row) };
  });
}

const decisionInput = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), version: versionInput }).strict(),
  z.object({ decision: z.literal("reject"), version: versionInput, note: z.string().trim().min(1).max(500).refine(v => v.isWellFormed() && !v.includes("\u0000")) }).strict(),
  z.object({ decision: z.literal("withdraw"), version: versionInput }).strict(),
]);
async function decideInner(db: Database, user: string, workspace: string, id: string, raw: unknown, deps: SocialDeps) {
  const parsed = decisionInput.safeParse(raw);
  if (!parsed.success) throw publishInvalid("APPROVAL_DECISION_INVALID");
  const input = parsed.data;
  return withApprovals(db, user, workspace, deps, "social:approvals", async (tx, tenant, role) => {
    const [current] = await tx.select().from(socialApprovals).where(and(eq(socialApprovals.tenantId, tenant), eq(socialApprovals.id, recordId(id)))).for("update");
    if (!current) throw unavailable();
    if (current.version !== input.version) throw publishConflict();
    if (current.status !== "pending") throw publishConflict("APPROVAL_NOT_PENDING");
    if (input.decision === "withdraw") {
      if (current.requestedBy !== user && role !== "owner") throw publishConflict("NOT_YOUR_REQUEST");
      const [row] = await tx.update(socialApprovals).set({ status: "withdrawn", version: sql`${socialApprovals.version} + 1` }).where(and(eq(socialApprovals.tenantId, tenant), eq(socialApprovals.id, current.id))).returning();
      await audit(tx, tenant, user, "withdraw", row.id);
      return { approval: approvalView(row) };
    }
    if (input.decision === "approve") {
      if (current.requestedBy === user) {
        const mode = (await loadSettings(tx, tenant)).selfApproval;
        if (mode === "never" || mode === "owner_only" && role !== "owner") throw publishConflict("SELF_APPROVAL_NOT_ALLOWED");
      }
      const fp = await fingerprint(tx, current.draftId, current.postId);
      if (fp !== current.fingerprint) {
        await tx.update(socialApprovals).set({ status: "superseded", version: sql`${socialApprovals.version} + 1` }).where(and(eq(socialApprovals.tenantId, tenant), eq(socialApprovals.id, current.id)));
        await audit(tx, tenant, user, "superseded", current.id);
        // The superseding is committed; the caller turns this marker into a conflict after the transaction.
        return { approval: { ...approvalView({ ...current, status: "superseded" }) }, contentChanged: true as const };
      }
    }
    const [row] = await tx.update(socialApprovals).set({ status: input.decision === "approve" ? "approved" : "rejected", decidedBy: user, decidedAt: sql`now()`,
      note: input.decision === "reject" ? input.note : null, version: sql`${socialApprovals.version} + 1` }).where(and(eq(socialApprovals.tenantId, tenant), eq(socialApprovals.id, current.id))).returning();
    await notify(tx, tenant, row, input.decision === "approve" ? "approved" : "rejected", [row.requestedBy]);
    await audit(tx, tenant, user, input.decision, row.id);
    return { approval: approvalView(row) };
  });
}

export async function decideApproval(db: Database, user: string, workspace: string, id: string, raw: unknown, deps: SocialDeps) {
  const result = await decideInner(db, user, workspace, id, raw, deps);
  if ("contentChanged" in result) throw publishConflict("CONTENT_CHANGED");
  return result;
}

export async function listApprovals(db: Database, user: string, workspace: string, query: { status?: string }, deps: SocialDeps) {
  const status = query.status === undefined ? undefined : z.enum(["pending", "approved", "rejected", "withdrawn", "superseded"]).safeParse(query.status);
  if (status && !status.success) throw publishInvalid("APPROVAL_FILTER_INVALID");
  return withApprovals(db, user, workspace, deps, "social:approvals", async (tx, tenant) => ({
    approvals: (await tx.select().from(socialApprovals).where(and(eq(socialApprovals.tenantId, tenant), status ? eq(socialApprovals.status, status.data) : undefined))
      .orderBy(desc(socialApprovals.requestedAt), asc(socialApprovals.id)).limit(100)).map(approvalView) }));
}

export function listApprovalNotices(db: Database, user: string, workspace: string, deps: SocialDeps) {
  return withApprovals(db, user, workspace, deps, "social:approvals", async (tx, tenant) => {
    const rows = await tx.select({ id: socialApprovalNotices.id, kind: socialApprovalNotices.kind, approvalId: socialApprovalNotices.approvalId, readAt: socialApprovalNotices.readAt, createdAt: socialApprovalNotices.createdAt })
      .from(socialApprovalNotices).where(and(eq(socialApprovalNotices.tenantId, tenant), eq(socialApprovalNotices.recipientUserId, user))).orderBy(desc(socialApprovalNotices.createdAt)).limit(50);
    return { notices: rows.map(r => ({ id: r.id, kind: r.kind, approvalId: r.approvalId, read: r.readAt !== null, createdAt: r.createdAt.toISOString() })), unread: rows.filter(r => !r.readAt).length };
  });
}
export function markApprovalNoticeRead(db: Database, user: string, workspace: string, id: string, deps: SocialDeps) {
  return withApprovals(db, user, workspace, deps, "social:approvals", async (tx, tenant) => {
    const [row] = await tx.update(socialApprovalNotices).set({ readAt: sql`now()` })
      .where(and(eq(socialApprovalNotices.tenantId, tenant), eq(socialApprovalNotices.id, recordId(id)), eq(socialApprovalNotices.recipientUserId, user))).returning({ id: socialApprovalNotices.id });
    if (!row) throw unavailable();
    return { read: true };
  });
}
