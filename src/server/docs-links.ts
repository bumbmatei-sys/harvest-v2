import { and, asc, desc, eq, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { contacts, crmTasks, docLinks, docPages, docs } from "../db/schema";
import { message } from "../i18n/messages";
import { AccessError, can } from "./permissions";
import { withTenant } from "./tenancy";
import { audit, id, loadDoc, needWrite, requireDocsEnabled } from "./docs-access";

export type LinkKind = "contact" | "task" | "doc";
export type LinkRow = { id: string; kind: LinkKind; targetId: string; label: string | null; detail: string | null; pageId: string | null; pageTitle: string | null; createdAt: string };
export type Backlink = { docId: string; docTitle: string; pageId: string | null; pageTitle: string | null };
export type Target = { kind: LinkKind; id: string; label: string; detail: string | null };
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * What each id points to, read with the viewer's own rights: a person or task the viewer cannot read, an erased or merged person and a doc the viewer cannot open all come back
 * without a label ("unavailable"). Nothing here changes a CRM record.
 */
async function resolve(tx: Transaction, tenantId: string, role: string, links: { kind: LinkKind; targetId: string }[]) {
  const out = new Map<string, { label: string; detail: string | null }>();
  const ids = (kind: LinkKind) => [...new Set(links.filter((l) => l.kind === kind).map((l) => l.targetId))];
  const people = ids("contact");
  if (people.length && can(role, "contacts:read")) for (const c of await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, people), isNull(contacts.erasedAt)))) out.set(`contact:${c.id}`, { label: c.name, detail: null });
  const tasks = ids("task");
  if (tasks.length && can(role, "tasks:read")) for (const t of await tx.select({ id: crmTasks.id, title: crmTasks.title, status: crmTasks.status }).from(crmTasks).where(and(eq(crmTasks.tenantId, tenantId), inArray(crmTasks.id, tasks)))) out.set(`task:${t.id}`, { label: t.title, detail: t.status });
  const ds = ids("doc");
  if (ds.length) for (const d of await tx.select({ id: docs.id, title: docs.title }).from(docs).where(and(eq(docs.tenantId, tenantId), inArray(docs.id, ds), isNull(docs.deletedAt)))) out.set(`doc:${d.id}`, { label: d.title, detail: null });
  return out;
}

export async function listLinks(db: Database, user: string, workspace: string, docId: string, query: unknown): Promise<{ links: LinkRow[]; backlinks: Backlink[] }> {
  requireDocsEnabled();
  const q = z.object({ scope: z.enum(["page", "doc"]).default("page"), pageId: z.uuid().optional() }).strict().parse(query ?? {});
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row } = await loadDoc(tx, tenantId, id(docId), user, role);
    const where = [eq(docLinks.docId, row.id), ...(q.scope === "page" ? [q.pageId ? eq(docLinks.pageId, q.pageId) : isNull(docLinks.pageId)] : [])];
    const rows = await tx.select({ l: docLinks, pageTitle: docPages.title }).from(docLinks).leftJoin(docPages, and(eq(docPages.docId, docLinks.docId), eq(docPages.id, docLinks.pageId))).where(and(...where)).orderBy(desc(docLinks.createdAt)).limit(200);
    const found = await resolve(tx, tenantId, role, rows.map((r) => ({ kind: r.l.targetKind, targetId: r.l.targetId })));
    const links = rows.map((r) => { const f = found.get(`${r.l.targetKind}:${r.l.targetId}`); return { id: r.l.id, kind: r.l.targetKind, targetId: r.l.targetId, label: f?.label ?? null, detail: f?.detail ?? null, pageId: r.l.pageId, pageTitle: r.pageTitle, createdAt: r.l.createdAt.toISOString() }; });
    // Backlinks: other docs that link to this one. The database shows only the docs this person may open.
    const back = await tx.select({ docId: docLinks.docId, docTitle: docs.title, pageId: docLinks.pageId, pageTitle: docPages.title }).from(docLinks).innerJoin(docs, eq(docs.id, docLinks.docId))
      .leftJoin(docPages, and(eq(docPages.docId, docLinks.docId), eq(docPages.id, docLinks.pageId))).where(and(eq(docLinks.tenantId, tenantId), eq(docLinks.targetKind, "doc"), eq(docLinks.targetId, row.id), isNull(docs.deletedAt))).limit(100);
    return { links, backlinks: back };
  });
}
export async function searchTargets(db: Database, user: string, workspace: string, docId: string, query: unknown): Promise<Target[]> {
  requireDocsEnabled();
  const q = z.object({ kind: z.enum(["contact", "task", "doc"]), q: z.string().trim().max(80).default("") }).strict().parse(query ?? {});
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row } = await loadDoc(tx, tenantId, id(docId), user, role);
    if (q.kind === "contact") return !can(role, "contacts:read") ? [] : (await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.tenantId, tenantId), isNull(contacts.erasedAt), ilike(contacts.name, like(q.q)))).orderBy(asc(contacts.name)).limit(8)).map((c) => ({ kind: "contact" as const, id: c.id, label: c.name, detail: null }));
    if (q.kind === "task") return !can(role, "tasks:read") ? [] : (await tx.select({ id: crmTasks.id, title: crmTasks.title, status: crmTasks.status }).from(crmTasks).where(and(eq(crmTasks.tenantId, tenantId), ilike(crmTasks.title, like(q.q)))).orderBy(asc(crmTasks.title)).limit(8)).map((t) => ({ kind: "task" as const, id: t.id, label: t.title, detail: t.status }));
    return (await tx.select({ id: docs.id, title: docs.title }).from(docs).where(and(eq(docs.tenantId, tenantId), isNull(docs.deletedAt), ne(docs.id, row.id), ilike(docs.title, like(q.q)))).orderBy(asc(docs.title)).limit(8)).map((d) => ({ kind: "doc" as const, id: d.id, label: d.title || message("Docs.untitled"), detail: null }));
  });
}
export async function addLink(db: Database, user: string, workspace: string, docId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ kind: z.enum(["contact", "task", "doc"]), targetId: z.uuid(), pageId: z.uuid().nullable().optional() }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    if (input.kind === "doc" && input.targetId === row.id) throw new AccessError(400, message("Errors.linkSelf"));
    if (input.pageId) { const [p] = await tx.select({ id: docPages.id }).from(docPages).where(and(eq(docPages.docId, row.id), eq(docPages.id, input.pageId))); if (!p) throw new AccessError(404, message("Errors.pageNotFound")); }
    // The target must be one the caller may read: a link cannot be used to reach for something the caller could not open.
    if (!(await resolve(tx, tenantId, role, [{ kind: input.kind, targetId: input.targetId }])).has(`${input.kind}:${input.targetId}`)) throw new AccessError(404, message("Errors.linkTargetNotFound"));
    const [made] = await tx.insert(docLinks).values({ tenantId, docId: row.id, pageId: input.pageId ?? null, targetKind: input.kind, targetId: input.targetId, createdBy: user }).onConflictDoNothing().returning({ id: docLinks.id });
    if (made) await audit(tx, tenantId, user, "docs.link.add", made.id, { docId: row.id, kind: input.kind });
    return { id: made?.id ?? null };
  });
}
export async function removeLink(db: Database, user: string, workspace: string, docId: string, linkId: string) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    await tx.delete(docLinks).where(and(eq(docLinks.docId, row.id), eq(docLinks.id, id(linkId))));
    await audit(tx, tenantId, user, "docs.link.remove", linkId, { docId: row.id });
    return { ok: true };
  });
}
