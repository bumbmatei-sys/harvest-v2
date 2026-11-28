import { runtimeEnv } from "../lib/env";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { users, workspaceInvitations, workspaceMemberAccess, workspaceMembers } from "../db/schema";
import { accessAreas, accessLevels, type AccessGrants } from "../lib/access-areas";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant, withUser } from "./tenancy";

/** Invitations are recorded, never delivered, until delivery is approved: a constant off switch like the Connect invitations. */
export const INVITATION_DELIVERY_LIVE = false as const;
/** Outside production the link is kept in memory for tests; nothing leaves the process. */
export const invitationTestSink: { email: string; token: string }[] = [];

const grantsSchema = z.partialRecord(z.enum(accessAreas), z.enum(accessLevels)).default({});
export const accessChangeSchema = z.object({ userId: z.string().min(1).max(200), role: z.enum(["owner", "admin", "member", "viewer", "collaborator", "guest"]), grants: grantsSchema, canManageAdmins: z.boolean().default(false) }).strict();
export const invitationSchema = z.object({ email: z.email().toLowerCase(), role: z.enum(["admin", "member", "viewer", "collaborator", "guest"]), grants: grantsSchema, canManageAdmins: z.boolean().default(false) }).strict();

type Outcome = { outcome: string; [key: string]: unknown };
function fail(outcome: string): never {
  if (outcome === "forbidden") throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
  if (outcome === "not_found") throw new AccessError(404, message("Errors.workspaceUnavailable"));
  if (outcome === "conflict") throw new AccessError(409, message("Errors.workspaceMustKeepOwner"));
  if (outcome === "expired" || outcome === "closed") throw new AccessError(409, message("Errors.checkTheSuppliedDetails"));
  throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
}
async function call(tx: Transaction, query: ReturnType<typeof sql>): Promise<Outcome> {
  const result = await tx.execute(query);
  const row = (result.rows as { r: Outcome }[])[0];
  return row.r;
}

/** Changes an existing member's role and areas. Owner/admin only; only an owner touches admin/owner; audited by the database function. */
export function changeMemberAccess(db: Database, actorId: string, workspace: string, data: unknown) {
  const input = accessChangeSchema.parse(data);
  return withTenant(db, actorId, workspace, "members:write", async (tx) => {
    const out = await call(tx, sql`select public.workspace_access_change(${input.userId}, ${input.role}, ${JSON.stringify(input.grants)}::jsonb, ${input.canManageAdmins}::boolean) as r`);
    if (out.outcome !== "ok") fail(out.outcome);
    return { userId: input.userId, role: input.role, areas: out.areas as string };
  });
}

/** Creates an invitation carrying the intended role and areas. Nothing is added to the account until the invited person accepts. Returns the id (never the link). */
export function inviteMember(db: Database, actorId: string, workspace: string, data: unknown) {
  const input = invitationSchema.parse(data);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return withTenant(db, actorId, workspace, "members:write", async (tx) => {
    const out = await call(tx, sql`select public.workspace_invitation_create(${input.email}, ${input.role}, ${JSON.stringify(input.grants)}::jsonb, ${tokenHash}, ${input.canManageAdmins}::boolean) as r`);
    if (out.outcome !== "ok") fail(out.outcome);
    if (runtimeEnv().NODE_ENV !== "production") {
      invitationTestSink.push({ email: input.email, token });
      // Same test mailbox the sign-in codes use; nothing is ever sent.
      if (process.env.HARVEST_E2E_MAILBOX) appendFileSync(process.env.HARVEST_E2E_MAILBOX, `${JSON.stringify({ to: input.email, text: `invitation ${token}` })}\n`);
    }
    return { id: out.id as string, delivered: INVITATION_DELIVERY_LIVE };
  });
}
export function revokeInvitation(db: Database, actorId: string, workspace: string, id: string) {
  const invitation = z.uuid().parse(id);
  return withTenant(db, actorId, workspace, "members:write", async (tx) => {
    const out = await call(tx, sql`select public.workspace_invitation_revoke(${invitation}::uuid) as r`);
    if (out.outcome !== "ok") fail(out.outcome);
    return { id: invitation };
  });
}
export function listInvitations(db: Database, actorId: string, workspace: string) {
  return withTenant(db, actorId, workspace, "members:write", (tx) => tx.select({ id: workspaceInvitations.id, email: workspaceInvitations.email, role: workspaceInvitations.role, canManageAdmins: workspaceInvitations.canManageAdmins, grants: workspaceInvitations.grants,
    status: workspaceInvitations.status, expiresAt: workspaceInvitations.expiresAt }).from(workspaceInvitations).where(eq(workspaceInvitations.tenantId, workspace)).orderBy(desc(workspaceInvitations.createdAt)));
}
/** The signed-in account accepts an invitation made for its e-mail address. The token alone is not enough. */
export function acceptInvitation(db: Database, userId: string, token: unknown) {
  const value = z.string().min(16).max(200).parse(token);
  return withUser(db, userId, async (tx) => {
    const out = await call(tx, sql`select public.workspace_invitation_accept(${value}) as r`);
    if (out.outcome !== "ok") fail(out.outcome);
    return { tenantId: out.tenantId as string, role: out.role as string, joined: out.joined as boolean };
  });
}
/** Everyone in the account with their role and areas (owner/admin). */
export function listMemberAccess(db: Database, actorId: string, workspace: string) {
  return withTenant(db, actorId, workspace, "members:write", async (tx) => {
    const members = await tx.select({ userId: workspaceMembers.userId, role: workspaceMembers.roleId, canManageAdmins: workspaceMembers.canManageAdmins, name: users.name, email: users.email }).from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId)).where(eq(workspaceMembers.tenantId, workspace));
    const grants = await tx.select().from(workspaceMemberAccess).where(and(eq(workspaceMemberAccess.tenantId, workspace)));
    return members.map((m) => ({ ...m, grants: Object.fromEntries(grants.filter((g) => g.userId === m.userId).map((g) => [g.area, g.level])) as AccessGrants }));
  });
}

/**
 * Founder decision (25 Nov): people are added by invitation the invitee accepts. The only direct add left is a non-production test gate for browser
 * fixtures: it needs the test mailbox variable the e2e configuration sets, and is always off in production.
 */
export function directAddAllowed(): boolean { return runtimeEnv().NODE_ENV !== "production" && Boolean(process.env.HARVEST_E2E_MAILBOX); }
