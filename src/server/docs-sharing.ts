import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { docShares, docs, users, workspaceMembers } from "../db/schema";
import { shareRoles } from "../lib/docs";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import { audit, bad, docsPublicLinksEnabled, id, loadDoc, needManage, requireDocsEnabled, userLabel } from "./docs-access";
import { notify } from "./docs-notify";

export type Person = { userId: string; name: string };
/** The ministry's members by display name, for the invite and @mention pickers. */
export async function ministryPeople(tx: Transaction, tenantId: string): Promise<(Person & { role: string })[]> {
  const rows = await tx.select({ userId: workspaceMembers.userId, role: workspaceMembers.roleId, name: userLabel }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.tenantId, tenantId)).orderBy(asc(userLabel)).limit(500);
  return rows;
}
export type Sharing = {
  visibility: "private" | "ministry"; ministryAccess: "view" | "comment" | "edit"; ownerId: string; publicLink: { available: boolean; enabled: boolean };
  shares: { userId: string; name: string; role: "view" | "comment" | "edit" }[]; people: Person[]; canManage: boolean;
};
export async function getSharing(db: Database, user: string, workspace: string, docId: string): Promise<Sharing> {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role);
    const shares = await tx.select({ userId: docShares.userId, role: docShares.role, name: userLabel }).from(docShares).innerJoin(users, eq(users.id, docShares.userId)).where(eq(docShares.docId, row.id)).orderBy(asc(userLabel));
    const people = rights.manage ? (await ministryPeople(tx, tenantId)).filter((p) => p.userId !== row.ownerId && !shares.some((s) => s.userId === p.userId)).map(({ userId, name }) => ({ userId, name })) : [];
    return { visibility: row.visibility, ministryAccess: row.ministryAccess, ownerId: row.ownerId, publicLink: { available: docsPublicLinksEnabled(), enabled: row.publicEnabled }, shares: rights.manage ? shares : shares.filter((s) => s.userId === user), people, canManage: rights.manage };
  });
}
export async function setShare(db: Database, user: string, workspace: string, docId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ userId: z.string().min(1).max(64), role: z.enum(shareRoles as [string, ...string[]]) }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needManage(rights);
    if (input.userId === row.ownerId) throw bad("Errors.shareOwner");
    const [member] = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.tenantId, tenantId), eq(workspaceMembers.userId, input.userId)));
    if (!member) throw bad("Errors.shareNotMember");
    const [before] = await tx.select({ role: docShares.role }).from(docShares).where(and(eq(docShares.docId, row.id), eq(docShares.userId, input.userId)));
    await tx.insert(docShares).values({ tenantId, docId: row.id, userId: input.userId, role: input.role as "view", createdBy: user }).onConflictDoUpdate({ target: [docShares.docId, docShares.userId], set: { role: input.role as "view" } });
    if (!before) await notify(tx, tenantId, user, [input.userId], "shared", row.id, null, null);
    await audit(tx, tenantId, user, "docs.share.set", row.id, { userId: input.userId, role: input.role });
    return { ok: true };
  });
}
export async function removeShare(db: Database, user: string, workspace: string, docId: string, userId: string) {
  requireDocsEnabled();
  const target = z.string().min(1).max(64).parse(userId);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    // A person may always remove their own access; removing anyone else's needs manage.
    if (target !== user) needManage(rights);
    await tx.delete(docShares).where(and(eq(docShares.docId, row.id), eq(docShares.userId, target)));
    await audit(tx, tenantId, user, "docs.share.remove", row.id, { userId: target });
    return { ok: true };
  });
}
export async function setAccess(db: Database, user: string, workspace: string, docId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ visibility: z.enum(["private", "ministry"]), ministryAccess: z.enum(["view", "comment", "edit"]).optional() }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needManage(rights);
    await tx.update(docs).set({ visibility: input.visibility, ...(input.ministryAccess ? { ministryAccess: input.ministryAccess } : {}), updatedAt: new Date() }).where(and(eq(docs.tenantId, tenantId), eq(docs.id, row.id)));
    await audit(tx, tenantId, user, "docs.access.set", row.id, { visibility: input.visibility, ministryAccess: input.ministryAccess ?? row.ministryAccess });
    return { ok: true };
  });
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
/** Turning the public link on is an explicit approval step, available only where the gate allows it (never in production). The token is shown once; only its hash is stored. */
export async function setPublicLink(db: Database, user: string, workspace: string, docId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ enabled: z.boolean(), approved: z.boolean().optional() }).strict().parse(raw);
  if (input.enabled && (!docsPublicLinksEnabled() || input.approved !== true)) throw new AccessError(403, message("Errors.publicLinkOff"));
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needManage(rights);
    const token = input.enabled ? randomBytes(32).toString("base64url") : null;
    await tx.update(docs).set({ publicEnabled: input.enabled, publicTokenHash: token ? hashToken(token) : null, updatedAt: new Date() }).where(and(eq(docs.tenantId, tenantId), eq(docs.id, row.id)));
    await audit(tx, tenantId, user, input.enabled ? "docs.public.enable" : "docs.public.disable", row.id);
    return { enabled: input.enabled, token };
  });
}
/** Reads a publicly shared doc by its token: read-only, no session. The database policy admits exactly the one row whose stored hash matches. */
export async function readPublicDoc(db: Database, token: string) {
  if (!docsPublicLinksEnabled() || !/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new AccessError(404, message("Errors.docNotFound"));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.docs_public_hash', ${hashToken(token)}, true)`);
    const { docPages } = await import("../db/schema");
    const [doc] = await tx.select({ id: docs.id, title: docs.title }).from(docs).where(eq(docs.publicEnabled, true));
    if (!doc) throw new AccessError(404, message("Errors.docNotFound"));
    const pages = await tx.select({ id: docPages.id, parentId: docPages.parentId, position: docPages.position, title: docPages.title, content: docPages.content, archivedAt: docPages.archivedAt }).from(docPages).where(eq(docPages.docId, doc.id)).orderBy(asc(docPages.position));
    return { title: doc.title, pages: pages.filter((p) => !p.archivedAt) };
  });
}
