import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { docPageVersions, docPages, docs, users } from "../db/schema";
import { contentStats, type DocContent } from "../lib/docs";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import { audit, id, loadDoc, needWrite, requireDocsEnabled, stale } from "./docs-access";

/** At most one automatic snapshot per page every ten minutes; the newest 50 are kept per page. Restores, template applications and imports always keep the text they replace. */
const AUTOSAVE_GAP_MS = 10 * 60 * 1000, KEEP = 50;
export async function snapshotPage(tx: Transaction, tenantId: string, docId: string, page: { id: string; version: number; title: string; content: DocContent }, user: string, reason: "autosave" | "restore" | "template" | "import") {
  if (reason === "autosave") {
    const [last] = await tx.select({ at: docPageVersions.createdAt }).from(docPageVersions).where(eq(docPageVersions.pageId, page.id)).orderBy(desc(docPageVersions.createdAt)).limit(1);
    if (last && Date.now() - last.at.getTime() < AUTOSAVE_GAP_MS) return;
  }
  await tx.insert(docPageVersions).values({ tenantId, docId, pageId: page.id, number: page.version, title: page.title, content: page.content, reason, createdBy: user });
  const all = await tx.select({ id: docPageVersions.id }).from(docPageVersions).where(eq(docPageVersions.pageId, page.id)).orderBy(desc(docPageVersions.createdAt));
  if (all.length > KEEP) await tx.delete(docPageVersions).where(and(eq(docPageVersions.pageId, page.id), inArray(docPageVersions.id, all.slice(KEEP).map((v) => v.id))));
}

export type VersionRow = { id: string; number: number; title: string; reason: string; createdAt: string; authorName: string; words: number };
export async function listVersions(db: Database, user: string, workspace: string, docId: string, pageId: string): Promise<VersionRow[]> {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role);
    needWrite(rights);
    const rows = await tx.select({ v: docPageVersions, author: sql<string>`coalesce(nullif(btrim(${users.name}),''), left(split_part(${users.email},'@',1), 24))` }).from(docPageVersions).innerJoin(users, eq(users.id, docPageVersions.createdBy))
      .where(and(eq(docPageVersions.docId, row.id), eq(docPageVersions.pageId, id(pageId)))).orderBy(desc(docPageVersions.createdAt)).limit(KEEP);
    return rows.map((r) => ({ id: r.v.id, number: r.v.number, title: r.v.title, reason: r.v.reason, createdAt: r.v.createdAt.toISOString(), authorName: r.author, words: contentStats(r.v.content).words }));
  });
}
export async function getVersion(db: Database, user: string, workspace: string, docId: string, pageId: string, versionId: string) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role);
    needWrite(rights);
    const [v] = await tx.select().from(docPageVersions).where(and(eq(docPageVersions.docId, row.id), eq(docPageVersions.pageId, id(pageId)), eq(docPageVersions.id, id(versionId))));
    if (!v) throw new AccessError(404, message("Errors.versionNotFound"));
    return { id: v.id, number: v.number, title: v.title, content: v.content, createdAt: v.createdAt.toISOString() };
  });
}
/** Puts an older version back as the page's text. The text it replaces is kept as a version first, so a restore can be undone by restoring again. */
export async function restoreVersion(db: Database, user: string, workspace: string, docId: string, pageId: string, versionId: string, raw: unknown) {
  requireDocsEnabled();
  const { version } = z.object({ version: z.number().int().positive() }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    const [page] = await tx.select().from(docPages).where(and(eq(docPages.tenantId, tenantId), eq(docPages.docId, row.id), eq(docPages.id, id(pageId)))).for("update");
    if (!page) throw new AccessError(404, message("Errors.pageNotFound"));
    if (page.version !== version) throw stale();
    if (page.protected) throw new AccessError(409, message("Errors.pageProtected"), { reason: "protected" });
    const [v] = await tx.select().from(docPageVersions).where(and(eq(docPageVersions.docId, row.id), eq(docPageVersions.pageId, page.id), eq(docPageVersions.id, id(versionId))));
    if (!v) throw new AccessError(404, message("Errors.versionNotFound"));
    await snapshotPage(tx, tenantId, row.id, page, user, "restore");
    const [saved] = await tx.update(docPages).set({ content: v.content, title: v.title, version: page.version + 1, updatedBy: user, updatedAt: new Date() }).where(eq(docPages.id, page.id)).returning({ version: docPages.version });
    await tx.update(docs).set({ updatedAt: new Date(), version: sql`${docs.version}+1` }).where(and(eq(docs.tenantId, tenantId), eq(docs.id, row.id)));
    await audit(tx, tenantId, user, "docs.page.restore_version", page.id, { docId: row.id, from: v.number });
    return { version: saved.version };
  });
}
