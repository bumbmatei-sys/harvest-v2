import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { docPages, docs, files, docAttachments, users } from "../db/schema";
import { docLimits, DocContentError, sanitizeDocContent, buildPageTree, flattenTree, subtreeIds, type DocContent } from "../lib/docs";
import { docToHtml, docToMarkdown, htmlToBlocks, markdownToBlocks, splitBlocks } from "../lib/docs-convert";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import { audit, bad, id, loadDoc, needWrite, requireDocsEnabled, userLabel } from "./docs-access";
import { snapshotPage } from "./docs-history";

const safeName = (title: string) => (title.trim() || "doc").replace(/[^\p{L}\p{N}._ -]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "doc";
const scopeInput = z.object({ scope: z.enum(["page", "doc"]), pageId: z.uuid().optional(), format: z.enum(["markdown", "html"]).optional() }).strict();

async function pagesFor(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, docId: string, scope: "page" | "doc", pageId: string | undefined) {
  const all = (await tx.select().from(docPages).where(and(eq(docPages.tenantId, tenantId), eq(docPages.docId, docId), isNull(docPages.archivedAt))).orderBy(asc(docPages.position))).filter((p) => !p.archivedAt);
  if (scope === "page") {
    const page = all.find((p) => p.id === pageId);
    if (!page) throw new AccessError(404, message("Errors.pageNotFound"));
    const ids = new Set(subtreeIds(all, page.id));
    return all.filter((p) => ids.has(p.id));
  }
  // Document order: the tree, top to bottom.
  const order = flattenTree(buildPageTree(all.map((p) => ({ id: p.id, parentId: p.parentId, position: p.position, title: p.title, icon: p.icon, archivedAt: null, protected: p.protected })))).map((n) => n.id);
  return order.map((pid) => all.find((p) => p.id === pid)!);
}
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The text of a page or of the whole doc as Markdown or HTML. Anyone who can read the doc can export it. */
export async function exportDoc(db: Database, user: string, workspace: string, docId: string, query: unknown) {
  requireDocsEnabled();
  const q = scopeInput.parse(query);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row } = await loadDoc(tx, tenantId, id(docId), user, role);
    const pages = await pagesFor(tx, tenantId, row.id, q.scope, q.pageId);
    const title = q.scope === "page" ? pages[0]?.title || row.title : row.title;
    await audit(tx, tenantId, user, "docs.export", row.id, { scope: q.scope, format: q.format ?? "markdown" });
    if (q.format === "html") {
      const body = pages.map((p) => `<section>\n${p.title ? `<h1>${esc(p.title)}</h1>\n` : ""}${docToHtml(p.content)}\n</section>`).join("\n");
      return { filename: `${safeName(title)}.html`, mime: "text/html; charset=utf-8", body: `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>\n${body}\n</body></html>\n` };
    }
    const body = pages.map((p) => `${p.title ? `# ${p.title.replace(/\n/g, " ")}\n\n` : ""}${docToMarkdown(p.content)}`).join("\n");
    return { filename: `${safeName(title)}.md`, mime: "text/markdown; charset=utf-8", body };
  });
}
/** What the print view shows: the pages with their text already turned into safe HTML. */
export async function printableDoc(db: Database, user: string, workspace: string, docId: string, query: unknown) {
  requireDocsEnabled();
  const q = scopeInput.omit({ format: true }).parse(query);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row } = await loadDoc(tx, tenantId, id(docId), user, role);
    const pages = await pagesFor(tx, tenantId, row.id, q.scope, q.pageId);
    return { title: q.scope === "page" ? pages[0]?.title || row.title : row.title, pages: pages.map((p) => ({ id: p.id, title: p.title, html: docToHtml(p.content) })) };
  });
}

const importInput = z.object({ format: z.enum(["html", "markdown"]), text: z.string().max(1_000_000), split: z.boolean().default(false), title: z.string().trim().max(200).default(""), mode: z.enum(["new_pages", "replace_page"]).default("new_pages"), pageId: z.uuid().optional(), version: z.number().int().positive().optional() }).strict();
function parseImport(input: z.infer<typeof importInput>) {
  let blocks;
  try { blocks = input.format === "html" ? htmlToBlocks(input.text) : markdownToBlocks(input.text); } catch { throw bad("Errors.importTooLarge"); }
  const pages = splitBlocks(blocks, input.split, input.title || message("Docs.imported"));
  try { return pages.map((p) => ({ title: p.title.slice(0, docLimits.title), content: sanitizeDocContent(p.content) as DocContent })); }
  catch (error) { if (error instanceof DocContentError) throw bad(error.reason === "SIZE" ? "Errors.importTooLarge" : "Errors.docContentInvalid"); throw error; }
}
/** Adds the imported text to a doc as new pages (one, or one per top-level heading), or puts it into the page that is open (the old text is kept as a version). */
export async function importIntoDoc(db: Database, user: string, workspace: string, docId: string, raw: unknown) {
  requireDocsEnabled();
  const input = importInput.parse(raw);
  const pages = parseImport(input);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    if (input.mode === "replace_page") {
      if (!input.pageId) throw bad("Errors.pageNotFound");
      const [page] = await tx.select().from(docPages).where(and(eq(docPages.tenantId, tenantId), eq(docPages.docId, row.id), eq(docPages.id, input.pageId))).for("update");
      if (!page) throw new AccessError(404, message("Errors.pageNotFound"));
      if (input.version !== undefined && page.version !== input.version) throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
      if (page.protected) throw new AccessError(409, message("Errors.pageProtected"), { reason: "protected" });
      await snapshotPage(tx, tenantId, row.id, page, user, "import");
      await tx.update(docPages).set({ content: pages[0].content, version: page.version + 1, updatedBy: user, updatedAt: new Date() }).where(eq(docPages.id, page.id));
      await audit(tx, tenantId, user, "docs.import", page.id, { docId: row.id, mode: input.mode, format: input.format });
      return { pageId: page.id, pages: 1 };
    }
    const existing = await tx.select({ id: docPages.id }).from(docPages).where(eq(docPages.docId, row.id));
    if (existing.length + pages.length > docLimits.pagesPerDoc) throw bad("Errors.pageLimitReached");
    const top = (await tx.select({ id: docPages.id }).from(docPages).where(and(eq(docPages.docId, row.id), isNull(docPages.parentId)))).length;
    const made: string[] = [];
    for (const [i, pg] of pages.entries()) { const [m] = await tx.insert(docPages).values({ tenantId, docId: row.id, parentId: null, position: top + i, title: pg.title, content: pg.content, createdBy: user, updatedBy: user }).returning({ id: docPages.id }); made.push(m.id); }
    await tx.update(docs).set({ updatedAt: new Date(), version: sql`${docs.version}+1` }).where(and(eq(docs.tenantId, tenantId), eq(docs.id, row.id)));
    await audit(tx, tenantId, user, "docs.import", made[0], { docId: row.id, mode: input.mode, format: input.format, pages: made.length });
    return { pageId: made[0], pages: made.length };
  });
}
/** Import from the Docs list: a new doc (private to its creator) holding the imported pages. */
export async function importAsNewDoc(db: Database, user: string, workspace: string, raw: unknown) {
  requireDocsEnabled();
  const input = importInput.omit({ mode: true, pageId: true, version: true }).extend({ folderId: z.uuid().nullable().optional() }).strict().parse(raw);
  const pages = parseImport({ ...input, mode: "new_pages" });
  return withTenant(db, user, id(workspace), "docs:write", async (tx, tenantId) => {
    const [count] = await tx.select({ n: sql<number>`count(*)` }).from(docs).where(eq(docs.tenantId, tenantId));
    if (Number(count.n) >= docLimits.docsPerMinistry) throw bad("Errors.docsLimitReached");
    const [doc] = await tx.insert(docs).values({ tenantId, kind: "document", folderId: input.folderId ?? null, title: input.title || pages[0].title, ownerId: user }).returning({ id: docs.id });
    for (const [i, pg] of pages.entries()) await tx.insert(docPages).values({ tenantId, docId: doc.id, parentId: null, position: i, title: pg.title, content: pg.content, createdBy: user, updatedBy: user });
    await audit(tx, tenantId, user, "docs.import", doc.id, { docId: doc.id, mode: "new_doc", format: input.format, pages: pages.length });
    return { id: doc.id, pageId: null };
  });
}

// Attachments: files already uploaded to the ministry's Harvest Storage. Nothing is copied; the doc only points at the file.
export type AttachmentRow = { fileId: string; name: string; size: number; mime: string; attachedByName: string; createdAt: string };
export async function listAttachments(db: Database, user: string, workspace: string, docId: string): Promise<AttachmentRow[]> {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row } = await loadDoc(tx, tenantId, id(docId), user, role);
    const rows = await tx.select({ a: docAttachments, f: files, who: userLabel }).from(docAttachments).innerJoin(files, eq(files.id, docAttachments.fileId)).innerJoin(users, eq(users.id, docAttachments.attachedBy))
      .where(and(eq(docAttachments.docId, row.id), eq(files.status, "ready"))).orderBy(asc(docAttachments.createdAt)).limit(100);
    return rows.map((r) => ({ fileId: r.f.id, name: r.f.name, size: r.f.size, mime: r.f.mime, attachedByName: r.who, createdAt: r.a.createdAt.toISOString() }));
  });
}
export async function attachFile(db: Database, user: string, workspace: string, docId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ fileId: z.uuid() }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    const [file] = await tx.select({ id: files.id }).from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, input.fileId), eq(files.status, "ready"), eq(files.socialUpload, false)));
    if (!file) throw new AccessError(404, message("Errors.fileNotAvailable"));
    const [count] = await tx.select({ n: sql<number>`count(*)` }).from(docAttachments).where(eq(docAttachments.docId, row.id));
    if (Number(count.n) >= 50) throw bad("Errors.attachmentLimit");
    await tx.insert(docAttachments).values({ tenantId, docId: row.id, fileId: file.id, attachedBy: user }).onConflictDoNothing();
    await audit(tx, tenantId, user, "docs.attachment.add", file.id, { docId: row.id });
    return { ok: true };
  });
}
export async function detachFile(db: Database, user: string, workspace: string, docId: string, fileId: string) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    await tx.delete(docAttachments).where(and(eq(docAttachments.docId, row.id), eq(docAttachments.fileId, id(fileId))));
    await audit(tx, tenantId, user, "docs.attachment.remove", fileId, { docId: row.id });
    return { ok: true };
  });
}
