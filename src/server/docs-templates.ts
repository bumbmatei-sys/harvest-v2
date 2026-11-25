import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { docPages, docTemplates, docs, users } from "../db/schema";
import { docLimits, sanitizeDocContent, templateCategories, templateNameSchema, type DocContent, type TemplatePage } from "../lib/docs";
import { starterBySlug, starterTemplates } from "../lib/docs-templates";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import { audit, bad, id, loadDoc, needWrite, requireDocsEnabled, userLabel } from "./docs-access";
import { snapshotPage } from "./docs-history";

export type TemplateRow = { id: string; builtin: boolean; name: string; category: string; description: string; pages: number; authorName: string | null; updatedAt: string | null; canChange: boolean };
export async function listTemplates(db: Database, user: string, workspace: string, query: unknown): Promise<TemplateRow[]> {
  requireDocsEnabled();
  const q = z.object({ q: z.string().trim().max(80).default(""), category: z.enum(templateCategories).optional() }).strict().parse(query ?? {});
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const needle = q.q.toLowerCase();
    const starters = starterTemplates.filter((t) => (!q.category || t.category === q.category) && (!needle || t.name.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle)))
      .map((t): TemplateRow => ({ id: `builtin:${t.slug}`, builtin: true, name: t.name, category: t.category, description: t.description, pages: t.pages.length, authorName: null, updatedAt: null, canChange: false }));
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await tx.select({ t: docTemplates, author: userLabel, pages: sql<number>`jsonb_array_length(${docTemplates.pages})` }).from(docTemplates).innerJoin(users, eq(users.id, docTemplates.createdBy))
      .where(and(eq(docTemplates.tenantId, tenantId), q.category ? eq(docTemplates.category, q.category) : undefined, q.q ? or(ilike(docTemplates.name, like), ilike(docTemplates.description, like)) : undefined)).orderBy(desc(docTemplates.updatedAt)).limit(100);
    const mine = rows.map((r): TemplateRow => ({ id: r.t.id, builtin: false, name: r.t.name, category: r.t.category, description: r.t.description, pages: Number(r.pages), authorName: r.author, updatedAt: r.t.updatedAt.toISOString(), canChange: role === "owner" || role === "admin" || (role === "member" && r.t.createdBy === user) }));
    return [...mine, ...starters];
  });
}

const meta = z.object({ name: templateNameSchema, category: z.enum(templateCategories).default("other"), description: z.string().trim().max(200).default("") });
const source = z.object({ docId: z.uuid(), scope: z.enum(["doc", "page"]), pageId: z.uuid().optional() });
/** The pages a template keeps: the whole doc's visible pages in tree order, or one page with its subpages. Parent is the position of the parent in the list. */
async function collect(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, docId: string, scope: "doc" | "page", pageId: string | undefined): Promise<TemplatePage[]> {
  const all = (await tx.select().from(docPages).where(and(eq(docPages.tenantId, tenantId), eq(docPages.docId, docId), isNull(docPages.archivedAt))).orderBy(asc(docPages.position))).filter((p) => !p.archivedAt);
  let rootIds: string[];
  if (scope === "page") { if (!pageId || !all.some((p) => p.id === pageId)) throw new AccessError(404, message("Errors.pageNotFound")); rootIds = [pageId]; } else rootIds = all.filter((p) => p.parentId === null).map((p) => p.id);
  const order: string[] = [];
  const walk = (pid: string) => { order.push(pid); for (const c of all.filter((p) => p.parentId === pid)) walk(c.id); };
  rootIds.forEach(walk);
  const out: TemplatePage[] = order.map((pid) => { const pg = all.find((p) => p.id === pid)!; return { title: pg.title, content: pg.content, parent: null }; });
  order.forEach((pid, i) => { const parent = all.find((p) => p.id === pid)!.parentId; out[i].parent = parent && order.includes(parent) ? order.indexOf(parent) : null; });
  if (out.length > 20) throw bad("Errors.templateTooLarge");
  return out;
}
export async function saveTemplate(db: Database, user: string, workspace: string, raw: unknown) {
  requireDocsEnabled();
  const input = meta.extend({ from: source }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:write", async (tx, tenantId, role) => {
    const { row } = await loadDoc(tx, tenantId, input.from.docId, user, role);
    const pages = await collect(tx, tenantId, row.id, input.from.scope, input.from.pageId);
    const [made] = await tx.insert(docTemplates).values({ tenantId, name: input.name, category: input.category, description: input.description, pages, createdBy: user }).returning({ id: docTemplates.id });
    await audit(tx, tenantId, user, "docs.template.create", made.id);
    return { id: made.id };
  });
}
export async function updateTemplate(db: Database, user: string, workspace: string, templateId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ name: templateNameSchema.optional(), category: z.enum(templateCategories).optional(), description: z.string().trim().max(200).optional(), from: source.optional() }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:write", async (tx, tenantId, role) => {
    const [t] = await tx.select().from(docTemplates).where(and(eq(docTemplates.tenantId, tenantId), eq(docTemplates.id, id(templateId))));
    if (!t) throw new AccessError(404, message("Errors.templateNotFound"));
    if (!(role === "owner" || role === "admin" || t.createdBy === user)) throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
    let pages: TemplatePage[] | undefined;
    if (input.from) { const { row } = await loadDoc(tx, tenantId, input.from.docId, user, role); pages = await collect(tx, tenantId, row.id, input.from.scope, input.from.pageId); }
    await tx.update(docTemplates).set({ ...(input.name ? { name: input.name } : {}), ...(input.category ? { category: input.category } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(pages ? { pages } : {}),
      version: t.version + 1, updatedBy: user, updatedAt: new Date() }).where(eq(docTemplates.id, t.id));
    await audit(tx, tenantId, user, "docs.template.update", t.id);
    return { ok: true };
  });
}
export async function deleteTemplate(db: Database, user: string, workspace: string, templateId: string) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:write", async (tx, tenantId, role) => {
    const [t] = await tx.select().from(docTemplates).where(and(eq(docTemplates.tenantId, tenantId), eq(docTemplates.id, id(templateId))));
    if (!t) throw new AccessError(404, message("Errors.templateNotFound"));
    if (!(role === "owner" || role === "admin" || t.createdBy === user)) throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
    await tx.delete(docTemplates).where(eq(docTemplates.id, t.id));
    await audit(tx, tenantId, user, "docs.template.delete", t.id);
    return { ok: true };
  });
}
/** `replace_page` puts the template's first page into this page (the old text is kept as a version); `new_pages` adds all of the template's pages to the doc. */
export async function applyTemplate(db: Database, user: string, workspace: string, docId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ template: z.string().min(1).max(80), mode: z.enum(["replace_page", "new_pages"]), pageId: z.uuid().optional(), version: z.number().int().positive().optional() }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    let pages: TemplatePage[];
    if (input.template.startsWith("builtin:")) { const t = starterBySlug(input.template.slice(8)); if (!t) throw new AccessError(404, message("Errors.templateNotFound")); pages = t.pages as TemplatePage[]; }
    else { const [t] = await tx.select().from(docTemplates).where(and(eq(docTemplates.tenantId, tenantId), eq(docTemplates.id, id(input.template)))); if (!t) throw new AccessError(404, message("Errors.templateNotFound")); pages = t.pages; }
    const clean = pages.map((pg) => ({ ...pg, title: pg.title.slice(0, docLimits.title), content: sanitizeDocContent(pg.content) as DocContent }));
    if (!clean.length) throw bad("Errors.templateTooLarge");
    if (input.mode === "replace_page") {
      if (!input.pageId) throw bad("Errors.pageNotFound");
      const [page] = await tx.select().from(docPages).where(and(eq(docPages.tenantId, tenantId), eq(docPages.docId, row.id), eq(docPages.id, input.pageId))).for("update");
      if (!page) throw new AccessError(404, message("Errors.pageNotFound"));
      if (input.version !== undefined && page.version !== input.version) throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
      if (page.protected) throw new AccessError(409, message("Errors.pageProtected"), { reason: "protected" });
      await snapshotPage(tx, tenantId, row.id, page, user, "template");
      await tx.update(docPages).set({ content: clean[0].content, title: page.title || clean[0].title, version: page.version + 1, updatedBy: user, updatedAt: new Date() }).where(eq(docPages.id, page.id));
      await audit(tx, tenantId, user, "docs.template.apply", page.id, { docId: row.id, mode: input.mode });
      return { pageId: page.id };
    }
    const existing = await tx.select({ id: docPages.id }).from(docPages).where(eq(docPages.docId, row.id));
    if (existing.length + clean.length > docLimits.pagesPerDoc) throw bad("Errors.pageLimitReached");
    const siblings = (await tx.select({ id: docPages.id }).from(docPages).where(and(eq(docPages.docId, row.id), isNull(docPages.parentId)))).length;
    const ids: string[] = []; let top = 0;
    for (const [i, pg] of clean.entries()) {
      const parentIndex = pg.parent;
      const [made] = await tx.insert(docPages).values({ tenantId, docId: row.id, parentId: parentIndex === null ? null : ids[parentIndex], position: parentIndex === null ? siblings + top++ : i, title: pg.title, content: pg.content, createdBy: user, updatedBy: user }).returning({ id: docPages.id });
      ids.push(made.id);
    }
    await tx.update(docs).set({ updatedAt: new Date(), version: sql`${docs.version}+1` }).where(and(eq(docs.tenantId, tenantId), eq(docs.id, row.id)));
    await audit(tx, tenantId, user, "docs.template.apply", ids[0], { docId: row.id, mode: input.mode, pages: ids.length });
    return { pageId: ids[0] };
  });
}
