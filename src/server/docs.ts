import { and, asc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, docFavorites, docFolders, docPages, docs, users } from "../db/schema";
import { docLimits, docRights, DocContentError, docTitleSchema, emptyContent, folderNameKey, folderNameSchema, pageStyleSchema, pageTitleSchema, reorder, sanitizeDocContent, subtreeIds, type DocContent, type DocRights, type PageStyle } from "../lib/docs";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

/** Docs are a development-only module until activated: never in production (same gate as the newsletter and the Office screens). */
export function docsEnabled(env: Record<string, string | undefined> = process.env) { return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production"; }
export function requireDocsEnabled() { if (!docsEnabled()) throw new AccessError(404, message("Errors.thisViewIsNotAvailable")); }

const gone = () => new AccessError(404, message("Errors.docNotFound"));
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
const denied = () => new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
const bad = (key: Parameters<typeof message>[0]) => new AccessError(400, message(key));
const id = (value: string) => z.uuid().parse(value);
const audit = (tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, metadata: Record<string, string | number> = {}) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata: Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)])) });
/** People who signed in with a code may have no name yet: the start of the email before the @ stands in (never a long id). */
const ownerName = sql<string>`coalesce(nullif(btrim(${users.name}),''), left(split_part(${users.email},'@',1), 24))`;
const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export type DocKind = "document" | "spreadsheet";
export type DocRow = { id: string; kind: DocKind; title: string; ownerId: string; ownerName: string; folderId: string | null; updatedAt: string; archivedAt: string | null; deletedAt: string | null; favorite: boolean; rights: DocRights };
/** `docCount` is what the card shows (active docs); `docTotal` also counts archived and trashed docs, which still block deleting the folder. */
export type FolderRow = { id: string; parentId: string | null; name: string; ownerId: string; docCount: number; docTotal: number };
export type PageRow = { id: string; parentId: string | null; position: number; title: string; icon: string | null; archivedAt: string | null; protected: boolean };

const iso = (value: Date | null) => value ? value.toISOString() : null;

/** The role-and-owner rule for changing a doc (the database policy enforces the same rule). */
async function loadDoc(tx: Transaction, tenantId: string, docId: string, user: string, role: string, lock = false, trashed = false) {
  const [row] = await tx.select().from(docs).where(and(eq(docs.tenantId, tenantId), eq(docs.id, docId), trashed ? isNotNull(docs.deletedAt) : isNull(docs.deletedAt)));
  if (!row) throw gone();
  const rights = docRights(role, row.ownerId, user);
  // Serialise changes to one doc. The lock is taken only by someone who may change it: a row the update policy hides cannot be locked, and reading it needs no lock.
  if (lock && rights.write) await tx.select({ id: docs.id }).from(docs).where(and(eq(docs.tenantId, tenantId), eq(docs.id, docId))).for("update");
  return { row, rights };
}
const needWrite = (rights: DocRights) => { if (!rights.write) throw denied(); };

// ---- Folders -------------------------------------------------------------------------------------------------------------------------------------------------
async function folderDepth(tx: Transaction, tenantId: string, folderId: string | null) {
  let depth = 0, cur = folderId;
  while (cur && depth <= docLimits.folderDepth + 1) { const [f] = await tx.select({ parentId: docFolders.parentId }).from(docFolders).where(and(eq(docFolders.tenantId, tenantId), eq(docFolders.id, cur), isNull(docFolders.archivedAt))); if (!f) throw bad("Errors.folderNotFound"); depth++; cur = f.parentId; }
  return depth;
}
async function subtreeHeight(tx: Transaction, tenantId: string, folderId: string) {
  const all = await tx.select({ id: docFolders.id, parentId: docFolders.parentId }).from(docFolders).where(and(eq(docFolders.tenantId, tenantId), isNull(docFolders.archivedAt)));
  const height = (f: string): number => 1 + Math.max(0, ...all.filter((x) => x.parentId === f).map((x) => height(x.id)));
  return height(folderId);
}
/** The folder must exist; `child` also requires room for one more level below it. */
async function ensureFolder(tx: Transaction, tenantId: string, folderId: string | null, child = false) { if (folderId && await folderDepth(tx, tenantId, folderId) >= (child ? docLimits.folderDepth : 1)) { if (child) throw bad("Errors.folderTooDeep"); } }
async function nextFolderPosition(tx: Transaction, tenantId: string, parentId: string | null) {
  const [r] = await tx.select({ max: sql<number>`coalesce(max(${docFolders.position}),-1)` }).from(docFolders).where(and(eq(docFolders.tenantId, tenantId), parentId ? eq(docFolders.parentId, parentId) : isNull(docFolders.parentId)));
  return Number(r.max) + 1;
}
const taken = (error: unknown) => typeof error === "object" && error !== null && ((error as { code?: string }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505");
const cyclic = (error: unknown) => typeof error === "object" && error !== null && ((error as { code?: string }).code === "23514" || (error as { cause?: { code?: string } }).cause?.code === "23514");

export async function createFolder(db: Database, user: string, workspace: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ name: folderNameSchema, parentId: z.uuid().nullable().optional() }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:write", async (tx, tenantId) => {
    await ensureFolder(tx, tenantId, input.parentId ?? null, true);
    const [count] = await tx.select({ n: sql<number>`count(*)` }).from(docFolders).where(and(eq(docFolders.tenantId, tenantId), isNull(docFolders.archivedAt)));
    if (Number(count.n) >= docLimits.foldersPerMinistry) throw bad("Errors.docsLimitReached");
    const position = await nextFolderPosition(tx, tenantId, input.parentId ?? null);
    try {
      await tx.execute(sql`savepoint folder_create`);
      const [row] = await tx.insert(docFolders).values({ tenantId, parentId: input.parentId ?? null, name: input.name, position, ownerId: user }).returning();
      await audit(tx, tenantId, user, "docs.folder.create", row.id);
      return { id: row.id, parentId: row.parentId, name: row.name };
    } catch (error) { if (taken(error)) { await tx.execute(sql`rollback to savepoint folder_create`); throw new AccessError(409, message("Errors.folderNameTaken")); } throw error; }
  });
}
export async function updateFolder(db: Database, user: string, workspace: string, folder: string, raw: unknown) {
  requireDocsEnabled();
  const folderId = id(folder), input = z.object({ name: folderNameSchema.optional(), parentId: z.uuid().nullable().optional() }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:write", async (tx, tenantId, role) => {
    const [current] = await tx.select().from(docFolders).where(and(eq(docFolders.tenantId, tenantId), eq(docFolders.id, folderId), isNull(docFolders.archivedAt)));
    if (!current) throw new AccessError(404, message("Errors.folderNotFound"));
    if (!(role === "owner" || role === "admin" || current.ownerId === user)) throw denied();
    await tx.select({ id: docFolders.id }).from(docFolders).where(and(eq(docFolders.tenantId, tenantId), eq(docFolders.id, folderId))).for("update");
    const parentId = input.parentId === undefined ? current.parentId : input.parentId;
    const move = parentId !== current.parentId;
    if (move) {
      // Moving into itself or its own subtree is refused here (clear message) and again by the database trigger (race-proof).
      if (parentId === folderId) throw new AccessError(409, message("Errors.folderCycle"));
      if (parentId) {
        let cur: string | null = parentId, steps = 0;
        while (cur && steps++ < 70) { if (cur === folderId) throw new AccessError(409, message("Errors.folderCycle")); const [p] = await tx.select({ parentId: docFolders.parentId }).from(docFolders).where(and(eq(docFolders.tenantId, tenantId), eq(docFolders.id, cur))); if (!p) throw new AccessError(404, message("Errors.folderNotFound")); cur = p.parentId; }
        const depth = await folderDepth(tx, tenantId, parentId);
        if (depth + await subtreeHeight(tx, tenantId, folderId) > docLimits.folderDepth) throw bad("Errors.folderTooDeep");
      }
    }
    try {
      await tx.execute(sql`savepoint folder_update`);
      const [row] = await tx.update(docFolders).set({ ...(input.name ? { name: input.name } : {}), ...(move ? { parentId, position: await nextFolderPosition(tx, tenantId, parentId) } : {}), updatedAt: new Date() })
        .where(and(eq(docFolders.tenantId, tenantId), eq(docFolders.id, folderId))).returning();
      await audit(tx, tenantId, user, move ? "docs.folder.move" : "docs.folder.rename", folderId);
      return { id: row.id, parentId: row.parentId, name: row.name };
    } catch (error) {
      await tx.execute(sql`rollback to savepoint folder_update`);
      if (taken(error)) throw new AccessError(409, message("Errors.folderNameTaken"));
      if (cyclic(error)) throw new AccessError(409, message("Errors.folderCycle"));
      throw error;
    }
  });
}
/** A non-empty folder is never deleted silently: `refuse` answers 409 with the counts, `move_to_parent` moves its docs and subfolders up one level first. */
export async function deleteFolder(db: Database, user: string, workspace: string, folder: string, raw: unknown) {
  requireDocsEnabled();
  const folderId = id(folder), input = z.object({ mode: z.enum(["refuse", "move_to_parent"]).default("refuse") }).strict().parse(raw ?? {});
  return withTenant(db, user, id(workspace), "docs:write", async (tx, tenantId, role) => {
    const [current] = await tx.select().from(docFolders).where(and(eq(docFolders.tenantId, tenantId), eq(docFolders.id, folderId), isNull(docFolders.archivedAt)));
    if (!current) throw new AccessError(404, message("Errors.folderNotFound"));
    if (!(role === "owner" || role === "admin" || current.ownerId === user)) throw denied();
    await tx.select({ id: docFolders.id }).from(docFolders).where(and(eq(docFolders.tenantId, tenantId), eq(docFolders.id, folderId))).for("update");
    const kids = await tx.select({ id: docFolders.id, name: docFolders.name, ownerId: docFolders.ownerId }).from(docFolders).where(and(eq(docFolders.tenantId, tenantId), eq(docFolders.parentId, folderId), isNull(docFolders.archivedAt)));
    const inside = await tx.select({ id: docs.id, ownerId: docs.ownerId }).from(docs).where(and(eq(docs.tenantId, tenantId), eq(docs.folderId, folderId)));
    if ((kids.length || inside.length) && input.mode === "refuse") throw new AccessError(409, message("Errors.folderNotEmpty"), { folders: kids.length, docs: inside.length });
    if (kids.length || inside.length) {
      // Subfolder names must stay unique in the parent; a clash is reported instead of renaming anything silently.
      const siblings = await tx.select({ name: docFolders.name }).from(docFolders).where(and(eq(docFolders.tenantId, tenantId), current.parentId ? eq(docFolders.parentId, current.parentId) : isNull(docFolders.parentId), isNull(docFolders.archivedAt), ne(docFolders.id, folderId)));
      const names = new Set(siblings.map((s) => folderNameKey(s.name)));
      if (kids.some((k) => names.has(folderNameKey(k.name)))) throw new AccessError(409, message("Errors.folderNameTaken"));
      // Another person's docs may be inside: moving them is a change to the doc, so it needs the right to change each one.
      // The same holds for subfolders: row-level security skips another member's folder, so the move would silently leave it behind and the delete would fail.
      if (!(role === "owner" || role === "admin") && (inside.some((d) => d.ownerId !== user) || kids.some((k) => k.ownerId !== user))) throw denied();
      if (inside.length) await tx.update(docs).set({ folderId: current.parentId, updatedAt: new Date() }).where(and(eq(docs.tenantId, tenantId), eq(docs.folderId, folderId)));
      if (kids.length) {
        const base = await nextFolderPosition(tx, tenantId, current.parentId);
        let i = 0; for (const k of kids) await tx.update(docFolders).set({ parentId: current.parentId, position: base + i++, updatedAt: new Date() }).where(and(eq(docFolders.tenantId, tenantId), eq(docFolders.id, k.id)));
      }
    }
    try {
      await tx.execute(sql`savepoint folder_delete`);
      await tx.delete(docFolders).where(and(eq(docFolders.tenantId, tenantId), eq(docFolders.id, folderId)));
    } catch (error) { await tx.execute(sql`rollback to savepoint folder_delete`); if (taken(error)) throw new AccessError(409, message("Errors.folderNameTaken")); throw error; }
    await audit(tx, tenantId, user, "docs.folder.delete", folderId, { docs: inside.length, folders: kids.length });
    return { deleted: true, movedDocs: inside.length, movedFolders: kids.length };
  });
}

// ---- Docs ----------------------------------------------------------------------------------------------------------------------------------------------------
const listQuery = z.object({
  folderId: z.uuid().optional(), q: z.string().trim().max(100).optional(), status: z.enum(["active", "archived", "trash"]).default("active"),
  sort: z.enum(["updated", "title"]).default("updated"), favorites: z.enum(["1"]).optional(),
}).strict();
export type DocsList = { folders: FolderRow[]; docs: DocRow[]; role: string; userId: string };
export async function listDocs(db: Database, user: string, workspace: string, raw: unknown): Promise<DocsList> {
  requireDocsEnabled();
  const query = listQuery.parse(raw ?? {});
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const status = query.status;
    const where = [eq(docs.tenantId, tenantId),
      status === "trash" ? isNotNull(docs.deletedAt) : isNull(docs.deletedAt),
      ...(status === "archived" ? [isNotNull(docs.archivedAt)] : status === "active" ? [isNull(docs.archivedAt)] : [])];
    if (query.q) {
      const like = `%${likeEscape(query.q)}%`;
      where.push(or(ilike(docs.title, like), sql`exists(select 1 from ${docPages} p where p.doc_id=${docs.id} and p.tenant_id=${docs.tenantId} and p.title ilike ${like})`)!);
    } else if (status === "active" && !query.favorites) where.push(query.folderId ? eq(docs.folderId, query.folderId) : isNull(docs.folderId));
    if (query.favorites) where.push(sql`exists(select 1 from ${docFavorites} f where f.doc_id=${docs.id} and f.user_id=${user})`);
    const rows = await tx.select({ doc: docs, ownerName: ownerName, favorite: sql<boolean>`exists(select 1 from ${docFavorites} f where f.doc_id=${docs.id} and f.user_id=${user})` })
      .from(docs).innerJoin(users, eq(users.id, docs.ownerId)).where(and(...where))
      .orderBy(query.sort === "title" ? sql`lower(${docs.title})` : sql`${docs.updatedAt} desc`, asc(docs.id)).limit(500);
    const folders = await tx.select({ id: docFolders.id, parentId: docFolders.parentId, name: docFolders.name, ownerId: docFolders.ownerId,
      docCount: sql<number>`(select count(*) from ${docs} d where d.folder_id=doc_folders.id and d.tenant_id=doc_folders.tenant_id and d.deleted_at is null and d.archived_at is null)`,
      docTotal: sql<number>`(select count(*) from ${docs} d where d.folder_id=doc_folders.id and d.tenant_id=doc_folders.tenant_id)` })
      .from(docFolders).where(and(eq(docFolders.tenantId, tenantId), isNull(docFolders.archivedAt))).orderBy(sql`lower(${docFolders.name})`).limit(docLimits.foldersPerMinistry);
    return { role, userId: user, folders: folders.map((f) => ({ ...f, docCount: Number(f.docCount), docTotal: Number(f.docTotal) })),
      docs: rows.map((r) => ({ id: r.doc.id, kind: r.doc.kind, title: r.doc.title, ownerId: r.doc.ownerId, ownerName: r.ownerName, folderId: r.doc.folderId, updatedAt: r.doc.updatedAt.toISOString(), archivedAt: iso(r.doc.archivedAt), deletedAt: iso(r.doc.deletedAt), favorite: r.favorite, rights: docRights(role, r.doc.ownerId, user) })) };
  });
}

const pageRows = (tx: Transaction, tenantId: string, docId: string): Promise<PageRow[]> =>
  tx.select({ id: docPages.id, parentId: docPages.parentId, position: docPages.position, title: docPages.title, icon: docPages.icon, archivedAt: sql<string | null>`to_char(${docPages.archivedAt} at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')`, protected: docPages.protected })
    .from(docPages).where(and(eq(docPages.tenantId, tenantId), eq(docPages.docId, docId))).orderBy(asc(docPages.position), asc(docPages.id)).limit(docLimits.pagesPerDoc + 50);

async function insertPage(tx: Transaction, tenantId: string, docId: string, user: string, input: { parentId: string | null; title: string; content: DocContent; style?: PageStyle; icon?: string | null; position?: number }) {
  const siblings = await tx.select({ id: docPages.id }).from(docPages).where(and(eq(docPages.docId, docId), input.parentId ? eq(docPages.parentId, input.parentId) : isNull(docPages.parentId))).orderBy(asc(docPages.position));
  const [row] = await tx.insert(docPages).values({ tenantId, docId, parentId: input.parentId, position: input.position ?? siblings.length, title: input.title, icon: input.icon ?? null, content: input.content, style: input.style ?? {}, createdBy: user, updatedBy: user }).returning();
  return row;
}
async function pageDepth(tx: Transaction, docId: string, pageId: string | null) {
  let depth = 0, cur = pageId;
  while (cur && depth <= docLimits.pageDepth + 1) { const [p] = await tx.select({ parentId: docPages.parentId }).from(docPages).where(and(eq(docPages.docId, docId), eq(docPages.id, cur))); if (!p) throw new AccessError(404, message("Errors.pageNotFound")); depth++; cur = p.parentId; }
  return depth;
}
const touch = (tx: Transaction, tenantId: string, docId: string) => tx.update(docs).set({ updatedAt: new Date(), version: sql`${docs.version}+1` }).where(and(eq(docs.tenantId, tenantId), eq(docs.id, docId)));

export async function createDoc(db: Database, user: string, workspace: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ title: docTitleSchema.default(""), folderId: z.uuid().nullable().optional() }).strict().parse(raw ?? {});
  return withTenant(db, user, id(workspace), "docs:write", async (tx, tenantId) => {
    if (input.folderId) await ensureFolder(tx, tenantId, input.folderId);
    const [count] = await tx.select({ n: sql<number>`count(*)` }).from(docs).where(eq(docs.tenantId, tenantId));
    if (Number(count.n) >= docLimits.docsPerMinistry) throw bad("Errors.docsLimitReached");
    const [row] = await tx.insert(docs).values({ tenantId, kind: "document", folderId: input.folderId ?? null, title: input.title, ownerId: user }).returning();
    const page = await insertPage(tx, tenantId, row.id, user, { parentId: null, title: input.title, content: emptyContent() });
    await audit(tx, tenantId, user, "docs.doc.create", row.id);
    return { id: row.id, pageId: page.id };
  });
}

export type DocDetail = { doc: { id: string; title: string; ownerId: string; ownerName: string; folderId: string | null; updatedAt: string; archivedAt: string | null; favorite: boolean }; rights: DocRights; pages: PageRow[]; folders: { id: string; parentId: string | null; name: string }[]; role: string; userId: string };
export async function getDoc(db: Database, user: string, workspace: string, docId: string): Promise<DocDetail> {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role);
    const [owner] = await tx.select({ name: ownerName }).from(users).where(eq(users.id, row.ownerId));
    const [fav] = await tx.select({ n: sql<number>`count(*)` }).from(docFavorites).where(and(eq(docFavorites.docId, row.id), eq(docFavorites.userId, user)));
    const folders = await tx.select({ id: docFolders.id, parentId: docFolders.parentId, name: docFolders.name }).from(docFolders).where(and(eq(docFolders.tenantId, tenantId), isNull(docFolders.archivedAt))).limit(docLimits.foldersPerMinistry);
    return { role, userId: user, rights, folders, pages: await pageRows(tx, tenantId, row.id),
      doc: { id: row.id, title: row.title, ownerId: row.ownerId, ownerName: owner?.name ?? "", folderId: row.folderId, updatedAt: row.updatedAt.toISOString(), archivedAt: iso(row.archivedAt), favorite: Number(fav.n) > 0 } };
  });
}

export async function updateDoc(db: Database, user: string, workspace: string, docId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ title: docTitleSchema.optional(), folderId: z.uuid().nullable().optional(), archived: z.boolean().optional(), trashed: z.boolean().optional() }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    // Restoring from Trash addresses a trashed doc; every other change addresses a live one.
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true, input.trashed === false);
    needWrite(rights);
    if (input.folderId !== undefined && input.folderId !== row.folderId) await ensureFolder(tx, tenantId, input.folderId);
    const now = new Date();
    const [updated] = await tx.update(docs).set({
      ...(input.title !== undefined ? { title: input.title } : {}), ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? now : null } : {}), ...(input.trashed !== undefined ? { deletedAt: input.trashed ? now : null } : {}),
      updatedAt: now, version: sql`${docs.version}+1` }).where(and(eq(docs.tenantId, tenantId), eq(docs.id, row.id))).returning();
    await audit(tx, tenantId, user, input.trashed !== undefined ? (input.trashed ? "docs.doc.trash" : "docs.doc.restore") : input.archived !== undefined ? (input.archived ? "docs.doc.archive" : "docs.doc.unarchive") : input.folderId !== undefined ? "docs.doc.move" : "docs.doc.rename", row.id);
    return { id: updated.id, title: updated.title, folderId: updated.folderId, archivedAt: iso(updated.archivedAt), deletedAt: iso(updated.deletedAt) };
  });
}

export async function duplicateDoc(db: Database, user: string, workspace: string, docId: string) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:write", async (tx, tenantId, role) => {
    const { row } = await loadDoc(tx, tenantId, id(docId), user, role);
    const [count] = await tx.select({ n: sql<number>`count(*)` }).from(docs).where(eq(docs.tenantId, tenantId));
    if (Number(count.n) >= docLimits.docsPerMinistry) throw bad("Errors.docsLimitReached");
    const title = `${row.title || message("Docs.untitled")} ${message("Docs.copySuffix")}`.slice(0, docLimits.title);
    const [copy] = await tx.insert(docs).values({ tenantId, kind: row.kind, folderId: row.folderId, title, ownerId: user }).returning();
    const pages = await tx.select().from(docPages).where(and(eq(docPages.docId, row.id), isNull(docPages.archivedAt)));
    const map = new Map<string, string>();
    // Parents first so the new parent ids exist.
    const ordered = [...pages].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
    const pending = [...ordered];
    for (let guard = 0; pending.length && guard < docLimits.pagesPerDoc + 5; guard++) {
      const next = pending.shift()!;
      if (next.parentId && !map.has(next.parentId)) { pending.push(next); continue; }
      const [made] = await tx.insert(docPages).values({ tenantId, docId: copy.id, parentId: next.parentId ? map.get(next.parentId)! : null, position: next.position, engine: next.engine, schemaVersion: next.schemaVersion, title: next.title, icon: next.icon, content: next.content, style: next.style, protected: next.protected, createdBy: user, updatedBy: user }).returning({ id: docPages.id });
      map.set(next.id, made.id);
    }
    await audit(tx, tenantId, user, "docs.doc.duplicate", copy.id, { source: row.id });
    return { id: copy.id };
  });
}

export async function setDocFavorite(db: Database, user: string, workspace: string, docId: string, on: boolean) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row } = await loadDoc(tx, tenantId, id(docId), user, role);
    if (on) await tx.insert(docFavorites).values({ tenantId, docId: row.id, userId: user }).onConflictDoNothing();
    else await tx.delete(docFavorites).where(and(eq(docFavorites.docId, row.id), eq(docFavorites.userId, user)));
    return { favorite: on };
  });
}

// ---- Pages ---------------------------------------------------------------------------------------------------------------------------------------------------
export async function createPage(db: Database, user: string, workspace: string, docId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ parentId: z.uuid().nullable().optional(), title: pageTitleSchema.default("") }).strict().parse(raw ?? {});
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    const pages = await pageRows(tx, tenantId, row.id);
    if (pages.length >= docLimits.pagesPerDoc) throw bad("Errors.pageLimitReached");
    if (input.parentId && await pageDepth(tx, row.id, input.parentId) >= docLimits.pageDepth) throw bad("Errors.pageTooDeep");
    const page = await insertPage(tx, tenantId, row.id, user, { parentId: input.parentId ?? null, title: input.title, content: emptyContent() });
    await touch(tx, tenantId, row.id);
    await audit(tx, tenantId, user, "docs.page.create", page.id, { docId: row.id });
    return { id: page.id };
  });
}

export async function getPage(db: Database, user: string, workspace: string, docId: string, pageId: string) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row } = await loadDoc(tx, tenantId, id(docId), user, role);
    const [page] = await tx.select().from(docPages).where(and(eq(docPages.tenantId, tenantId), eq(docPages.docId, row.id), eq(docPages.id, id(pageId))));
    if (!page) throw new AccessError(404, message("Errors.pageNotFound"));
    return { id: page.id, parentId: page.parentId, engine: page.engine, schemaVersion: page.schemaVersion, title: page.title, icon: page.icon, content: page.content, style: page.style, protected: page.protected, version: page.version, updatedAt: page.updatedAt.toISOString(), archivedAt: iso(page.archivedAt) };
  });
}

const pagePatch = z.object({ version: z.number().int().positive(), title: pageTitleSchema.optional(), content: z.unknown().optional(), style: pageStyleSchema.optional(), icon: z.string().max(16).nullable().optional(), protected: z.boolean().optional() }).strict();
/**
 * Autosave and settings. `version` is the page version the editor loaded: a stale one is refused with 409 and nothing changes. A protected page is read-only for everyone
 * until the doc's owner or an owner/admin unprotects it (that is the only change accepted while protected).
 */
export async function updatePage(db: Database, user: string, workspace: string, docId: string, pageId: string, raw: unknown) {
  requireDocsEnabled();
  const input = pagePatch.parse(raw);
  let content: DocContent | undefined;
  if (input.content !== undefined) { try { content = sanitizeDocContent(input.content); } catch (error) { if (error instanceof DocContentError) throw bad(error.reason === "SIZE" ? "Errors.docContentTooLarge" : "Errors.docContentInvalid"); throw error; } }
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    const [page] = await tx.select().from(docPages).where(and(eq(docPages.tenantId, tenantId), eq(docPages.docId, row.id), eq(docPages.id, id(pageId)))).for("update");
    if (!page) throw new AccessError(404, message("Errors.pageNotFound"));
    if (page.version !== input.version) throw stale();
    const onlyUnprotect = input.protected === false && input.title === undefined && content === undefined && input.style === undefined && input.icon === undefined;
    if (page.protected && !onlyUnprotect) throw new AccessError(409, message("Errors.pageProtected"), { reason: "protected" });
    const now = new Date();
    const [saved] = await tx.update(docPages).set({
      ...(input.title !== undefined ? { title: input.title } : {}), ...(content ? { content } : {}), ...(input.style ? { style: input.style } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}), ...(input.protected !== undefined ? { protected: input.protected } : {}),
      version: page.version + 1, updatedBy: user, updatedAt: now }).where(and(eq(docPages.docId, row.id), eq(docPages.id, page.id))).returning({ version: docPages.version, updatedAt: docPages.updatedAt });
    // The first top-level page names the doc.
    if (input.title !== undefined && page.parentId === null) {
      const [first] = await tx.select({ id: docPages.id }).from(docPages).where(and(eq(docPages.docId, row.id), isNull(docPages.parentId), isNull(docPages.archivedAt))).orderBy(asc(docPages.position), asc(docPages.id)).limit(1);
      if (first?.id === page.id) await tx.update(docs).set({ title: input.title }).where(and(eq(docs.tenantId, tenantId), eq(docs.id, row.id)));
    }
    await touch(tx, tenantId, row.id);
    if (input.protected !== undefined && input.protected !== page.protected) await audit(tx, tenantId, user, input.protected ? "docs.page.protect" : "docs.page.unprotect", page.id, { docId: row.id });
    else if (input.title !== undefined && input.title !== page.title) await audit(tx, tenantId, user, "docs.page.rename", page.id, { docId: row.id });
    return { version: saved.version, updatedAt: saved.updatedAt.toISOString() };
  });
}

/** Moves a page under a parent (null: top level) at a position among its siblings; siblings are renumbered densely. */
export async function movePage(db: Database, user: string, workspace: string, docId: string, pageId: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ parentId: z.uuid().nullable(), index: z.number().int().min(0).max(docLimits.pagesPerDoc) }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    const pages = await pageRows(tx, tenantId, row.id), page = pages.find((p) => p.id === id(pageId));
    if (!page) throw new AccessError(404, message("Errors.pageNotFound"));
    if (page.protected) throw new AccessError(409, message("Errors.pageProtected"), { reason: "protected" });
    if (input.parentId) {
      if (!pages.some((p) => p.id === input.parentId)) throw new AccessError(404, message("Errors.pageNotFound"));
      if (subtreeIds(pages, page.id).includes(input.parentId)) throw new AccessError(409, message("Errors.pageCycle"));
      const height = (p: string): number => 1 + Math.max(0, ...pages.filter((x) => x.parentId === p).map((x) => height(x.id)));
      if (await pageDepth(tx, row.id, input.parentId) + height(page.id) > docLimits.pageDepth) throw bad("Errors.pageTooDeep");
    } else if (page.archivedAt) throw bad("Errors.pageNotFound");
    const siblings = pages.filter((p) => p.parentId === input.parentId && p.id !== page.id && !p.archivedAt).sort((a, b) => a.position - b.position).map((p) => p.id);
    if (page.parentId !== input.parentId) await tx.update(docPages).set({ parentId: input.parentId, updatedAt: new Date() }).where(and(eq(docPages.docId, row.id), eq(docPages.id, page.id)));
    const order = reorder(siblings, page.id, input.index);
    for (const [position, sid] of order.entries()) await tx.update(docPages).set({ position }).where(and(eq(docPages.docId, row.id), eq(docPages.id, sid)));
    // The old parent's remaining children close the gap.
    if (page.parentId !== input.parentId) {
      const rest = pages.filter((p) => p.parentId === page.parentId && p.id !== page.id).sort((a, b) => a.position - b.position);
      for (const [position, p] of rest.entries()) await tx.update(docPages).set({ position }).where(and(eq(docPages.docId, row.id), eq(docPages.id, p.id)));
    }
    await touch(tx, tenantId, row.id);
    await audit(tx, tenantId, user, "docs.page.move", page.id, { docId: row.id });
    return { moved: true };
  });
}

export async function duplicatePage(db: Database, user: string, workspace: string, docId: string, pageId: string) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    const all = await tx.select().from(docPages).where(eq(docPages.docId, row.id));
    if (!all.some((p) => p.id === id(pageId))) throw new AccessError(404, message("Errors.pageNotFound"));
    const ids = subtreeIds(all, pageId).filter((x) => !all.find((p) => p.id === x)?.archivedAt);
    if (all.length + ids.length > docLimits.pagesPerDoc) throw bad("Errors.pageLimitReached");
    const source = all.find((p) => p.id === pageId)!, map = new Map<string, string>();
    for (const sid of ids) {
      const p = all.find((x) => x.id === sid)!, top = sid === pageId;
      const made = await insertPage(tx, tenantId, row.id, user, { parentId: top ? p.parentId : map.get(p.parentId!)!, title: top ? `${p.title || message("Docs.untitled")} ${message("Docs.copySuffix")}`.slice(0, docLimits.title) : p.title, content: p.content, style: p.style, icon: p.icon, position: top ? source.position + 1 : p.position });
      map.set(sid, made.id);
    }
    // Close up the sibling order after the copy.
    const siblings = (await pageRows(tx, tenantId, row.id)).filter((p) => p.parentId === source.parentId).sort((a, b) => a.position - b.position || (a.id === map.get(pageId) ? -1 : 1));
    for (const [position, p] of siblings.entries()) await tx.update(docPages).set({ position }).where(and(eq(docPages.docId, row.id), eq(docPages.id, p.id)));
    await touch(tx, tenantId, row.id);
    await audit(tx, tenantId, user, "docs.page.duplicate", map.get(pageId)!, { docId: row.id });
    return { id: map.get(pageId)! };
  });
}

/** Archive hides a page and everything under it (restorable); delete removes them. A doc always keeps at least one visible top-level page. */
export async function archivePage(db: Database, user: string, workspace: string, docId: string, pageId: string, archived: boolean) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    const all = await tx.select().from(docPages).where(eq(docPages.docId, row.id));
    const page = all.find((p) => p.id === id(pageId));
    if (!page) throw new AccessError(404, message("Errors.pageNotFound"));
    const ids = subtreeIds(all, page.id);
    if (archived) {
      if (all.some((p) => ids.includes(p.id) && p.protected)) throw new AccessError(409, message("Errors.pageProtected"), { reason: "protected" });
      if (!all.some((p) => !p.archivedAt && !ids.includes(p.id) && p.parentId === null)) throw bad("Errors.lastPage");
    }
    await tx.update(docPages).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(and(eq(docPages.docId, row.id), inArray(docPages.id, ids)));
    await touch(tx, tenantId, row.id);
    await audit(tx, tenantId, user, archived ? "docs.page.archive" : "docs.page.restore", page.id, { docId: row.id, pages: ids.length });
    return { pages: ids.length };
  });
}
export async function deletePage(db: Database, user: string, workspace: string, docId: string, pageId: string) {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId, role) => {
    const { row, rights } = await loadDoc(tx, tenantId, id(docId), user, role, true);
    needWrite(rights);
    const all = await tx.select().from(docPages).where(eq(docPages.docId, row.id));
    const page = all.find((p) => p.id === id(pageId));
    if (!page) throw new AccessError(404, message("Errors.pageNotFound"));
    const ids = subtreeIds(all, page.id);
    if (all.some((p) => ids.includes(p.id) && p.protected)) throw new AccessError(409, message("Errors.pageProtected"), { reason: "protected" });
    if (!all.some((p) => !p.archivedAt && !ids.includes(p.id) && p.parentId === null)) throw bad("Errors.lastPage");
    // Deepest first so the parent link never points at a removed row.
    for (const pid of [...ids].reverse()) await tx.delete(docPages).where(and(eq(docPages.docId, row.id), eq(docPages.id, pid)));
    const rest = all.filter((p) => p.parentId === page.parentId && !ids.includes(p.id)).sort((a, b) => a.position - b.position);
    for (const [position, p] of rest.entries()) await tx.update(docPages).set({ position }).where(and(eq(docPages.docId, row.id), eq(docPages.id, p.id)));
    await touch(tx, tenantId, row.id);
    await audit(tx, tenantId, user, "docs.page.delete", page.id, { docId: row.id, pages: ids.length });
    return { pages: ids.length };
  });
}
