import { campaignInvitationLink } from "../lib/site-address";
import { createHash, randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, campaignDraftAssignments, campaignDraftInvitations, campaignDrafts, users, workspaceMembers } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { invitationInput, invitationTokenInput, type InvitationState } from "../lib/campaign-wizard";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant, withUser } from "./tenancy";

// CW-05: invitations to a department of a wizard draft (founder decision Q2). A person joins a department only by accepting. Nothing is sent from here
// unless a sender is passed in: the live sender is a constant off switch, and the synthetic sink exists only outside production for tests.
export const CAMPAIGN_INVITATION_LIVE_DELIVERY = false;
export type InvitationMail = { to: string; url: string; kind: "member" | "email" };
export type InvitationSender = (mail: InvitationMail) => Promise<void>;

/** Writes the link to a local file only when a test mailbox is configured and never in production. Nothing is sent anywhere. */
export const syntheticInvitationSink: InvitationSender = async (mail) => {
  const mailbox = process.env.HARVEST_E2E_MAILBOX;
  if (!mailbox || process.env.NODE_ENV === "production" || CAMPAIGN_INVITATION_LIVE_DELIVERY) return;
  await appendFile(`${mailbox}.campaign-invitations`, `${JSON.stringify(mail)}\n`, { mode: 0o600 });
};

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const invitationState = (row: { status: "pending" | "accepted" | "revoked"; expiresAt: Date }, now = new Date()): InvitationState =>
  row.status === "pending" && row.expiresAt <= now ? "expired" : row.status;

const columns = {
  id: campaignDraftInvitations.id, department: campaignDraftInvitations.department, role: campaignDraftInvitations.role, kind: campaignDraftInvitations.kind,
  userId: campaignDraftInvitations.userId, email: campaignDraftInvitations.email, status: campaignDraftInvitations.status, createdAt: campaignDraftInvitations.createdAt,
  expiresAt: campaignDraftInvitations.expiresAt, respondedAt: campaignDraftInvitations.respondedAt, acceptedBy: campaignDraftInvitations.acceptedBy,
};

/** The invitations of a draft, newest first, with who they are for (a member's name, or the address typed) and their state. Never the link. */
export async function invitationsOf(tx: Transaction, tenantId: string, draftId: string) {
  const rows = await tx.select({ ...columns, name: users.name, memberEmail: users.email }).from(campaignDraftInvitations)
    .leftJoin(users, eq(users.id, campaignDraftInvitations.userId))
    .where(and(eq(campaignDraftInvitations.tenantId, tenantId), eq(campaignDraftInvitations.draftId, draftId)))
    .orderBy(sql`${campaignDraftInvitations.createdAt} desc`, campaignDraftInvitations.id);
  return rows.map(({ name, memberEmail, expiresAt, createdAt, respondedAt, ...row }) => ({
    ...row, label: row.kind === "member" ? (name?.trim() || memberEmail || "") : row.email ?? "", state: invitationState({ status: row.status, expiresAt }),
    expiresAt: expiresAt.toISOString(), createdAt: createdAt.toISOString(), respondedAt: respondedAt?.toISOString() ?? null,
  }));
}

/** Creates an invitation for an open draft. A member's email invites that member; any other address gets an invitation that joins them on acceptance. */
export async function inviteToDraft(db: Database, userId: string, workspace: string, draft: string, raw: unknown, send: InvitationSender = syntheticInvitationSink) {
  const input = invitationInput.parse(raw), draftId = uuidInput.parse(draft), token = randomBytes(32).toString("base64url");
  const created = await withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const [current] = await tx.select({ status: campaignDrafts.status, departments: campaignDrafts.departments }).from(campaignDrafts)
      .where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.id, draftId)));
    if (!current) throw new AccessError(404, message("Campaigns.draftNotFound"));
    if (current.status !== "draft") throw new AccessError(409, message("Campaigns.draftClosed"));
    if (!current.departments.includes(input.department)) throw new AccessError(400, message("Campaigns.inviteDepartment"));
    // Who it is for: an existing member who can edit campaigns, or an address.
    let target: { kind: "member"; userId: string; to: string } | { kind: "email"; email: string };
    const byEmail = input.email ? (await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)))[0] : undefined;
    const memberId = input.userId ?? byEmail?.id;
    if (memberId) {
      const [member] = await tx.select({ role: workspaceMembers.roleId, email: users.email }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(and(eq(workspaceMembers.tenantId, tenantId), eq(workspaceMembers.userId, memberId)));
      if (member && !["owner", "admin", "member"].includes(member.role)) throw new AccessError(400, message("Campaigns.assigneeInvalid"));
      if (member) target = { kind: "member", userId: memberId, to: member.email };
      else if (input.userId) throw new AccessError(400, message("Campaigns.assigneeInvalid"));
      else target = { kind: "email", email: input.email as string };
    } else target = { kind: "email", email: input.email as string };
    if (target.kind === "member") {
      const [placed] = await tx.select({ id: campaignDraftAssignments.id }).from(campaignDraftAssignments).where(and(eq(campaignDraftAssignments.tenantId, tenantId),
        eq(campaignDraftAssignments.draftId, draftId), eq(campaignDraftAssignments.department, input.department), eq(campaignDraftAssignments.userId, target.userId)));
      if (placed) throw new AccessError(409, message("Campaigns.invitationExists"));
    }
    const [row] = await tx.insert(campaignDraftInvitations).values({ tenantId, draftId, department: input.department, role: input.role, tokenHash: hash(token), createdBy: userId,
      kind: target.kind, userId: target.kind === "member" ? target.userId : null, email: target.kind === "email" ? target.email : null })
      .onConflictDoNothing().returning({ id: campaignDraftInvitations.id });
    if (!row) throw new AccessError(409, message("Campaigns.invitationExists"));
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "campaign.invitation.create", targetId: draftId, metadata: { department: input.department, role: input.role, kind: target.kind } });
    return { id: row.id, to: target.kind === "member" ? target.to : target.email, kind: target.kind, invitations: await invitationsOf(tx, tenantId, draftId) };
  });
  // After the commit, so a failed delivery never undoes the invitation. The live sender is off; a test sink may record the link.
  await Promise.resolve().then(() => send({ to: created.to, url: campaignInvitationLink(token), kind: created.kind })).catch(() => undefined);
  return { id: created.id, invitations: created.invitations };
}

/** Withdraws a pending invitation. */
export async function revokeInvitation(db: Database, userId: string, workspace: string, draft: string, invitation: string) {
  const draftId = uuidInput.parse(draft), id = uuidInput.parse(invitation);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const [row] = await tx.update(campaignDraftInvitations).set({ status: "revoked", respondedAt: new Date() }).where(and(eq(campaignDraftInvitations.tenantId, tenantId),
      eq(campaignDraftInvitations.draftId, draftId), eq(campaignDraftInvitations.id, id), eq(campaignDraftInvitations.status, "pending"))).returning({ id: campaignDraftInvitations.id });
    if (!row) throw new AccessError(404, message("Campaigns.invitationNotFound"));
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "campaign.invitation.revoke", targetId: draftId });
    return { invitations: await invitationsOf(tx, tenantId, draftId) };
  });
}

/** Withdraws every pending invitation to a department that is no longer on the draft. */
export async function revokeOutside(tx: Transaction, tenantId: string, draftId: string, departments: readonly string[]) {
  const open = await tx.select({ id: campaignDraftInvitations.id, department: campaignDraftInvitations.department }).from(campaignDraftInvitations)
    .where(and(eq(campaignDraftInvitations.tenantId, tenantId), eq(campaignDraftInvitations.draftId, draftId), eq(campaignDraftInvitations.status, "pending")));
  const stale = open.filter((row) => !departments.includes(row.department)).map((row) => row.id);
  if (stale.length) await tx.update(campaignDraftInvitations).set({ status: "revoked", respondedAt: new Date() })
    .where(and(eq(campaignDraftInvitations.tenantId, tenantId), inArray(campaignDraftInvitations.id, stale)));
}

/** The signed-in person accepts with the link's token. The database function checks it is their invitation, not expired and not closed. */
export async function acceptInvitation(db: Database, userId: string, raw: unknown) {
  const { token } = invitationTokenInput.parse(raw);
  const { outcome, data } = await withUser(db, userId, async (tx) => (await tx.execute<{ result: { outcome: string; data?: { tenantId: string; draftId: string; department: string; role: string; joined: boolean } } }>(
    sql`select public.campaign_invitation_accept(${hash(token)}) as result`)).rows[0].result);
  if (outcome === "ok" && data) return data;
  if (outcome === "expired") throw new AccessError(409, message("Campaigns.invitationExpired"), { reason: "expired" });
  if (outcome === "closed") throw new AccessError(409, message("Campaigns.invitationClosed"));
  throw new AccessError(404, message("Campaigns.invitationNotFound"));
}
