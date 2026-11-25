import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, catalogItems, catalogLessons, catalogFiles, communities, communityProductLinks, files } from "../db/schema";
import { sanitizeRichText, type RichDoc } from "../lib/rich-text";
import { message } from "../i18n/messages";
import { freeCatalogEnabled } from "./free-catalog-mode";
import { refreshDiscoverListing } from "./discover/refresh";
import { AccessError } from "./permissions";
import { withTenant, withUser } from "./tenancy";
import type { StorageAdapter } from "./storage/adapter";

const uuid = z.uuid();
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/);
const title = z.string().trim().min(1).max(120).refine((value) => !value.includes("\u0000"));
const version = z.number().int().min(1).max(2_147_483_646);
const fields = {
  title, slug: slugSchema, summary: z.string().max(2000).refine((value) => !value.includes("\u0000")).default(""),
  visibility: z.enum(["hidden", "unlisted", "listed"]).default("hidden"),
};
const lesson = z.object({ id: uuid.optional(), title, published: z.boolean(), body: z.unknown() }).strict().transform((input, ctx) => {
  const body = sanitizeRichText(input.body);
  if (!body || Buffer.byteLength(JSON.stringify(body)) > 28_000) {
    ctx.addIssue({ code: "custom", path: ["body"], message: "Invalid lesson body" });
    return z.NEVER;
  }
  return { ...input, body };
});
const draft = z.discriminatedUnion("kind", [
  z.object({ ...fields, kind: z.literal("course"), lessons: z.array(lesson).max(50).default([]) }).strict(),
  z.object({ ...fields, kind: z.literal("download"), fileIds: z.array(uuid).max(20)
    .refine((ids) => new Set(ids).size === ids.length).default([]) }).strict(),
]);
const edit = z.object({ version, draft }).strict();
const transition = z.object({ version, state: z.enum(["draft", "published", "archived"]) }).strict();
const link = z.object({ position: z.number().int().min(0).max(1000) }).strict();
const notFound = () => new AccessError(404, message("Errors.catalogItemNotFound"));
const conflict = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
const invalid = () => new AccessError(400, message("Errors.checkTheSuppliedDetails"));

type Draft = z.infer<typeof draft>;
type Item = typeof catalogItems.$inferSelect;
type Metadata = { slug: string; title: string; summary: string; kind: Item["kind"] };
type Content = Metadata & { lessons: { id: string; title: string; body: RichDoc }[]; files: { id: string; name: string }[] };

function ensureEnabled() {
  if (!freeCatalogEnabled()) throw notFound();
}
async function ministry<T>(db: Database, user: string, workspace: string, write: boolean,
  run: (tx: Transaction, tenant: string, role: string) => Promise<T>) {
  ensureEnabled();
  if (!uuid.safeParse(workspace).success) throw notFound();
  try {
    return await withTenant(db, user, workspace, write ? "catalog:manage" : "catalog:read", run);
  } catch (error) {
    if (error instanceof AccessError && error.status === 403) throw notFound();
    type DatabaseError = { code?: string; constraint?: string };
    const failure = (error as { cause?: DatabaseError })?.cause ?? (error as DatabaseError);
    if (failure?.code === "23505") {
      if (failure.constraint === "catalog_items_slug_unique") {
        throw new AccessError(400, message("Errors.checkTheSuppliedDetails"), { reason: "address_unavailable" });
      }
      throw conflict();
    }
    throw error;
  }
}
function itemScope(tenant: string, id: string) {
  if (!uuid.safeParse(id).success) throw notFound();
  return and(eq(catalogItems.tenantId, tenant), eq(catalogItems.id, id));
}
async function lockItem(tx: Transaction, tenant: string, id: string) {
  const [item] = await tx.select().from(catalogItems).where(itemScope(tenant, id)).for("update");
  if (!item) throw notFound();
  return item;
}
const editorialMetadata = {
  id: catalogItems.id, kind: catalogItems.kind, slug: catalogItems.slug, title: catalogItems.title, summary: catalogItems.summary,
  state: catalogItems.state, visibility: catalogItems.visibility, version: catalogItems.version, updatedAt: catalogItems.updatedAt,
};
const audit = (tx: Transaction, tenantId: string, actorId: string, action: string, item: Item) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action, targetId: item.id, metadata: { state: item.state, version: String(item.version) } });

export function listCatalog(db: Database, user: string, tenant: string, after: string | null) {
  return ministry(db, user, tenant, false, (tx, scope) =>
    tx.select(editorialMetadata).from(catalogItems)
      .where(and(eq(catalogItems.tenantId, scope), after === null ? undefined : sql`${catalogItems.id} > ${uuid.parse(after)}::uuid`))
      .orderBy(catalogItems.id).limit(50));
}
export function getCatalogDraft(db: Database, user: string, tenant: string, id: string) {
  return ministry(db, user, tenant, false, async (tx, scope, role) => {
    const author = role === "owner" || role === "admin";
    const query = tx.select(editorialMetadata).from(catalogItems).where(itemScope(scope, id));
    const [item] = await (author ? query.for("share") : query);
    if (!item) throw notFound();
    if (!author) return item;
    const lessons = await tx.select({ id: catalogLessons.id, title: catalogLessons.title, body: catalogLessons.body, published: catalogLessons.published })
      .from(catalogLessons).where(and(eq(catalogLessons.tenantId, scope), eq(catalogLessons.itemId, id))).orderBy(asc(catalogLessons.position));
    const downloads = await tx.select({ id: catalogFiles.fileId }).from(catalogFiles)
      .where(and(eq(catalogFiles.tenantId, scope), eq(catalogFiles.itemId, id))).orderBy(asc(catalogFiles.position));
    // The communities that show this item on their shelf (a link confers no access). Authors only, like the lessons.
    const shelves = await tx.select({ id: communityProductLinks.communityId }).from(communityProductLinks)
      .where(and(eq(communityProductLinks.tenantId, scope), eq(communityProductLinks.itemId, id))).orderBy(asc(communityProductLinks.communityId));
    return { ...item, lessons, fileIds: downloads.map((file) => file.id), communityIds: shelves.map((link) => link.id) };
  });
}
async function writeDraft(tx: Transaction, item: Item, input: Draft) {
  if (input.kind === "course") {
    const scope = and(eq(catalogLessons.tenantId, item.tenantId), eq(catalogLessons.itemId, item.id));
    const old = await tx.select({ id: catalogLessons.id }).from(catalogLessons).where(scope);
    const ids = input.lessons.flatMap((row) => row.id ? [row.id] : []);
    if (new Set(ids).size !== ids.length || ids.some((id) => !old.some((row) => row.id === id))) throw notFound();
    await tx.delete(catalogLessons).where(scope);
    if (input.lessons.length) await tx.insert(catalogLessons).values(input.lessons.map((row, position) =>
      ({ ...row, position, tenantId: item.tenantId, itemId: item.id })));
  } else {
    if (input.fileIds.length) {
      const found = await tx.select({ id: files.id }).from(files).where(and(eq(files.tenantId, item.tenantId),
        eq(files.visibility, "private"), inArray(files.id, input.fileIds)));
      if (found.length !== input.fileIds.length) throw notFound();
    }
    await tx.delete(catalogFiles).where(and(eq(catalogFiles.tenantId, item.tenantId), eq(catalogFiles.itemId, item.id)));
    if (input.fileIds.length) await tx.insert(catalogFiles).values(input.fileIds.map((fileId, position) =>
      ({ fileId, position, tenantId: item.tenantId, itemId: item.id })));
  }
}
const itemFields = ({ title, summary, slug, visibility }: Draft) => ({ title, summary, slug, visibility });

export function createCatalogItem(db: Database, user: string, tenant: string, raw: unknown) {
  return ministry(db, user, tenant, true, async (tx, scope) => {
    const input = draft.parse(raw);
    const [item] = await tx.insert(catalogItems).values({ ...itemFields(input), kind: input.kind, tenantId: scope, createdBy: user }).returning();
    await writeDraft(tx, item, input);
    await audit(tx, scope, user, "catalog.create", item);
    return { id: item.id, version: item.version };
  });
}
export function updateCatalogItem(db: Database, user: string, tenant: string, id: string, raw: unknown) {
  return ministry(db, user, tenant, true, async (tx, scope) => {
    const current = await lockItem(tx, scope, id);
    const input = edit.parse(raw);
    if (current.version !== input.version || current.state !== "draft") throw conflict();
    if (current.kind !== input.draft.kind) throw invalid();
    await writeDraft(tx, current, input.draft);
    const [item] = await tx.update(catalogItems).set({ ...itemFields(input.draft), version: current.version + 1, updatedAt: new Date() })
      .where(itemScope(scope, id)).returning();
    await audit(tx, scope, user, "catalog.edit", item);
    await refreshDiscoverListing(tx, scope, item.kind === "course" ? "course" : "product", id);
    return { id, version: item.version };
  });
}
export function setCatalogState(db: Database, user: string, tenant: string, id: string, raw: unknown) {
  return ministry(db, user, tenant, true, async (tx, scope) => {
    const current = await lockItem(tx, scope, id);
    const input = transition.parse(raw);
    if (input.version !== current.version || current.state === "archived") throw conflict();
    if (input.state === current.state) return { id, version: current.version, state: current.state };
    if (input.state === "published") {
      if (current.visibility === "hidden") throw invalid();
      if (current.kind === "course") {
        const [published] = await tx.select({ id: catalogLessons.id }).from(catalogLessons).where(and(
          eq(catalogLessons.tenantId, scope), eq(catalogLessons.itemId, id), eq(catalogLessons.published, true),
        )).limit(1);
        if (!published) throw invalid();
      } else {
        const downloads = await tx.select({ status: files.status, visibility: files.visibility }).from(catalogFiles)
          .innerJoin(files, and(eq(files.tenantId, catalogFiles.tenantId), eq(files.id, catalogFiles.fileId)))
          .where(and(eq(catalogFiles.tenantId, scope), eq(catalogFiles.itemId, id))).for("share", { of: files });
        if (!downloads.length || downloads.some((file) => file.status !== "ready" || file.visibility !== "private")) throw invalid();
      }
    }
    const [item] = await tx.update(catalogItems).set({ state: input.state, version: current.version + 1, updatedAt: new Date() })
      .where(itemScope(scope, id)).returning();
    await audit(tx, scope, user, "catalog.state", item);
    await refreshDiscoverListing(tx, scope, item.kind === "course" ? "course" : "product", id);
    return { id, version: item.version, state: item.state };
  });
}
export function setCommunityProductLink(db: Database, user: string, tenant: string, communityId: string, id: string, raw: unknown, remove = false) {
  return ministry(db, user, tenant, true, async (tx, scope) => {
    if (!uuid.safeParse(communityId).success) throw notFound();
    const [community] = await tx.select({ id: communities.id }).from(communities)
      .where(and(eq(communities.tenantId, scope), eq(communities.id, communityId)));
    if (!community) throw notFound();
    const current = await lockItem(tx, scope, id);
    const position = remove ? 0 : link.parse(raw).position;
    if (remove) {
      const deleted = await tx.delete(communityProductLinks).where(and(eq(communityProductLinks.tenantId, scope),
        eq(communityProductLinks.communityId, communityId), eq(communityProductLinks.itemId, id))).returning();
      if (!deleted.length) throw notFound();
    } else {
      if (current.state !== "published") throw notFound();
      await tx.insert(communityProductLinks).values({ tenantId: scope, communityId, itemId: id, position })
        .onConflictDoUpdate({ target: [communityProductLinks.tenantId, communityProductLinks.communityId, communityProductLinks.itemId], set: { position } });
    }
    await tx.insert(auditLogs).values({ tenantId: scope, actorId: user, action: remove ? "catalog.unlink" : "catalog.link",
      targetId: id, metadata: { communityId } });
    return { linked: !remove };
  });
}
async function access<T>(db: Database, slug: string, action: "metadata" | "enrol" | "content" | "file", user?: string, file?: string) {
  ensureEnabled();
  if (!slugSchema.safeParse(slug).success || (file && !uuid.safeParse(file).success)) throw notFound();
  const query = sql`select public.catalog_access(${slug}, ${action}, ${file ?? null}::uuid) as data`;
  const result = user
    ? await withUser(db, user, (tx) => tx.execute<{ data: T | null }>(query))
    : await db.execute<{ data: T | null }>(query);
  const data = result.rows[0]?.data;
  if (data == null) throw notFound();
  return data;
}
export const getPublicCatalogItem = (db: Database, slug: string) => access<Metadata>(db, slug, "metadata");
export const enrolInCatalogItem = (db: Database, user: string, slug: string) => access<{ enrolled: true }>(db, slug, "enrol", user);
export const getCatalogContent = (db: Database, user: string, slug: string) => access<Content>(db, slug, "content", user);
export async function catalogDownload(db: Database, user: string, slug: string, fileId: string, storage: () => Pick<StorageAdapter, "presignDownload">) {
  const file = await access<{ key: string; name: string }>(db, slug, "file", user, fileId);
  return { url: await storage().presignDownload(file.key, file.name) };
}
