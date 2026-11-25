import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "../db/client";
import { docComments, docPages, users, workspaceMembers } from "../db/schema";
import { commentBodySchema } from "../lib/docs";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import { audit, id, loadDoc, needComment, needManage, requireDocsEnabled, userLabel } from "./docs-access";
import { notify } from "./docs-notify";
import { ministryPeople, type Person } from "./docs-sharing";

export type CommentRow = { id: string; parentId: string | null; authorId: string; authorName: string; body: string; quote: string | null; status: "open" | "resolved"; assigneeId: string | null; assigneeName: string | null;
  resolvedByName: string | null; resolvedAt: string | null; createdAt: string; mentions: string[] };
export type Thread = CommentRow & { replies: CommentRow[] };

async function ensurePage(tx: Parameters<Parameters<typeof withTenant>[4]>[0], docId: string, pageId: string) {
  const [page] = await tx.select({ id: docPages.id }).from(docPages).where(and(eq(docPages.docId, docId), eq(docPages.id, pageId)));
  if (!page) throw new AccessError(404, message("Errors.pageNotFound"));
}
async function onlyMembers(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, ids: readonly string[]) {
  if (!ids.length) return [];
  const rows = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.tenantId, tenantId), inArray(workspaceMembers.userId, [...ids])));
  return rows.map((r) => r.id);
}

export async function listThreads(db: Database, user: string, workspace: string, docId: string, pageId: string): Promise<{ threads: Thread[]; canComment: boolean; people: Person[] }> {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role);
    const assignee = alias(users, "assignee"), resolver = alias(users, "resolver");
    const rows = await tx.select({ c: docComments, author: userLabel, assigneeName: sql<string | null>`coalesce(nullif(btrim(${assignee.name}),''), left(split_part(${assignee.email},'@',1), 24))`,
      resolverName: sql<string | null>`coalesce(nullif(btrim(${resolver.name}),''), left(split_part(${resolver.email},'@',1), 24))` })
      .from(docComments).innerJoin(users, eq(users.id, docComments.authorId)).leftJoin(assignee, eq(assignee.id, docComments.assigneeId)).leftJoin(resolver, eq(resolver.id, docComments.resolvedBy))
      .where(and(eq(docComments.docId, row.id), eq(docComments.pageId, id(pageId)))).orderBy(asc(docComments.createdAt)).limit(500);
    const mapped: CommentRow[] = rows.map((r) => ({ id: r.c.id, parentId: r.c.parentId, authorId: r.c.authorId, authorName: r.author, body: r.c.body, quote: r.c.quote, status: r.c.status, assigneeId: r.c.assigneeId, assigneeName: r.assigneeName,
      resolvedByName: r.resolverName, resolvedAt: r.c.resolvedAt ? r.c.resolvedAt.toISOString() : null, createdAt: r.c.createdAt.toISOString(), mentions: r.c.mentions }));
    const threads = mapped.filter((c) => !c.parentId).map((c) => ({ ...c, replies: mapped.filter((r) => r.parentId === c.id) }));
    const people = rights.comment ? (await ministryPeople(tx, tenantId)).map(({ userId, name }) => ({ userId, name })) : [];
    return { threads, canComment: rights.comment, people };
  });
}

const createInput = z.object({ body: commentBodySchema, quote: z.string().trim().max(300).optional(), parentId: z.uuid().optional(), assigneeId: z.string().min(1).max(64).nullable().optional(), mentions: z.array(z.string().min(1).max(64)).max(20).default([]) }).strict();
/** A thread (no parent: on the page, or on a quoted piece of its text) or a reply. Mentions and assignment create in-app notifications only. */
export async function createComment(db: Database, user: string, workspace: string, docId: string, pageId: string, raw: unknown) {
  requireDocsEnabled();
  const input = createInput.parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role);
    needComment(rights);
    await ensurePage(tx, row.id, id(pageId));
    let root: { id: string; authorId: string; assigneeId: string | null } | null = null;
    if (input.parentId) {
      const [parent] = await tx.select().from(docComments).where(and(eq(docComments.docId, row.id), eq(docComments.pageId, pageId), eq(docComments.id, input.parentId)));
      if (!parent || parent.parentId) throw new AccessError(404, message("Errors.commentNotFound"));
      root = parent;
    }
    const mentions = await onlyMembers(tx, tenantId, input.mentions);
    const assignees = !root && input.assigneeId ? await onlyMembers(tx, tenantId, [input.assigneeId]) : [];
    const [made] = await tx.insert(docComments).values({ tenantId, docId: row.id, pageId, parentId: input.parentId ?? null, authorId: user, body: input.body, quote: root ? null : input.quote || null, mentions, assigneeId: assignees[0] ?? null }).returning({ id: docComments.id });
    await notify(tx, tenantId, user, mentions, "mention", row.id, pageId, made.id);
    if (assignees[0]) await notify(tx, tenantId, user, assignees, "assigned", row.id, pageId, made.id);
    if (root) await notify(tx, tenantId, user, [root.authorId, ...(root.assigneeId ? [root.assigneeId] : [])].filter((r) => !mentions.includes(r)), "reply", row.id, pageId, made.id);
    await audit(tx, tenantId, user, root ? "docs.comment.reply" : "docs.comment.create", made.id, { docId: row.id });
    return { id: made.id };
  });
}
export async function updateThread(db: Database, user: string, workspace: string, docId: string, commentId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ status: z.enum(["open", "resolved"]).optional(), assigneeId: z.string().min(1).max(64).nullable().optional(), body: commentBodySchema.optional() }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role);
    needComment(rights);
    const [c] = await tx.select().from(docComments).where(and(eq(docComments.docId, row.id), eq(docComments.id, id(commentId))));
    if (!c) throw new AccessError(404, message("Errors.commentNotFound"));
    if ((input.status !== undefined || input.assigneeId !== undefined) && c.parentId) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
    if (input.body !== undefined && c.authorId !== user) throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
    const assignees = input.assigneeId ? await onlyMembers(tx, tenantId, [input.assigneeId]) : [];
    if (input.assigneeId && !assignees.length) throw new AccessError(400, message("Errors.shareNotMember"));
    await tx.update(docComments).set({
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.status !== undefined ? { status: input.status, resolvedBy: input.status === "resolved" ? user : null, resolvedAt: input.status === "resolved" ? new Date() : null } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}), updatedAt: new Date() }).where(eq(docComments.id, c.id));
    if (assignees[0] && assignees[0] !== c.assigneeId) await notify(tx, tenantId, user, assignees, "assigned", row.id, c.pageId, c.id);
    await audit(tx, tenantId, user, input.status ? `docs.comment.${input.status === "resolved" ? "resolve" : "reopen"}` : "docs.comment.update", c.id, { docId: row.id });
    return { ok: true };
  });
}
export async function deleteComment(db: Database, user: string, workspace: string, docId: string, commentId: string) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role);
    needComment(rights);
    const [c] = await tx.select().from(docComments).where(and(eq(docComments.docId, row.id), eq(docComments.id, id(commentId))));
    if (!c) throw new AccessError(404, message("Errors.commentNotFound"));
    if (c.authorId !== user) needManage(rights);
    await tx.delete(docComments).where(eq(docComments.id, c.id));
    await audit(tx, tenantId, user, "docs.comment.delete", c.id, { docId: row.id });
    return { ok: true };
  });
}
