import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { docPageShares, docPages, users, workspaceMembers } from "../db/schema";
import { shareRoles } from "../lib/docs";
import { audit, bad, denied, id, loadDoc, needManage, requireDocsEnabled, userLabel } from "./docs-access";
import { notify } from "./docs-notify";
import { ministryPeople } from "./docs-sharing";
import { withTenant } from "./tenancy";

// "Share this page": one person gets view, comment or edit on one page and nothing else of the doc. Managing a page share needs manage on the doc (its owner, owners and admins).
export type PageShareView = { shares: { userId: string; name: string; role: "view" | "comment" | "edit" }[]; people: { userId: string; name: string }[]; canManage: boolean };
export async function getPageShares(db: Database, user: string, workspace: string, docId: string, pageId: string): Promise<PageShareView> {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role);
    const [page] = await tx.select({ id: docPages.id }).from(docPages).where(and(eq(docPages.docId, row.id), eq(docPages.id, id(pageId))));
    if (!page) throw bad("Errors.pageNotFound");
    const shares = await tx.select({ userId: docPageShares.userId, name: userLabel, role: docPageShares.role }).from(docPageShares).innerJoin(users, eq(users.id, docPageShares.userId)).where(and(eq(docPageShares.docId, row.id), eq(docPageShares.pageId, page.id)));
    const people = rights.manage ? (await ministryPeople(tx, tenantId)).filter((p) => p.userId !== row.ownerId && !shares.some((s) => s.userId === p.userId)).map(({ userId, name }) => ({ userId, name })) : [];
    return { shares: rights.manage ? shares : shares.filter((s) => s.userId === user), people, canManage: rights.manage };
  });
}
export async function setPageShare(db: Database, user: string, workspace: string, docId: string, pageId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ userId: z.string().min(1).max(64), role: z.enum(shareRoles as [string, ...string[]]) }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needManage(rights);
    if (input.userId === row.ownerId) throw bad("Errors.shareOwner");
    const [page] = await tx.select({ id: docPages.id }).from(docPages).where(and(eq(docPages.docId, row.id), eq(docPages.id, id(pageId))));
    if (!page) throw bad("Errors.pageNotFound");
    const [member] = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.tenantId, tenantId), eq(workspaceMembers.userId, input.userId)));
    if (!member) throw bad("Errors.shareNotMember");
    const [before] = await tx.select({ role: docPageShares.role }).from(docPageShares).where(and(eq(docPageShares.pageId, page.id), eq(docPageShares.userId, input.userId)));
    await tx.insert(docPageShares).values({ tenantId, docId: row.id, pageId: page.id, ownerId: row.ownerId, userId: input.userId, role: input.role as "view", createdBy: user })
      .onConflictDoUpdate({ target: [docPageShares.pageId, docPageShares.userId], set: { role: input.role as "view" } });
    if (!before) await notify(tx, tenantId, user, [input.userId], "shared", row.id, page.id, null);
    await audit(tx, tenantId, user, "docs.page_share.set", row.id, { userId: input.userId, role: input.role, pageId: page.id });
    return { ok: true };
  });
}
export async function removePageShare(db: Database, user: string, workspace: string, docId: string, pageId: string, userId: string) {
  requireDocsEnabled();
  const target = z.string().min(1).max(64).parse(userId);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true, false, id(pageId));
    // A person may always give up their own page access; removing anyone else's needs manage.
    if (target !== user && !rights.manage) throw denied();
    await tx.delete(docPageShares).where(and(eq(docPageShares.docId, row.id), eq(docPageShares.pageId, id(pageId)), inArray(docPageShares.userId, [target])));
    await audit(tx, tenantId, user, "docs.page_share.remove", row.id, { userId: target, pageId });
    return { ok: true };
  });
}
