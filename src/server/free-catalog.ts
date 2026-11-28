import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, catalogItems, catalogLessonAttachments, catalogLessons, catalogLevels, catalogSections, catalogFiles, communities, communityProductLinks, files } from "../db/schema";
import { catalogPublicationVisibilities, legacyCatalogVisibility, type CatalogPublicationVisibility } from "../lib/catalog";
import { coverMimes } from "../lib/forum";
import { sanitizeRichText, type RichDoc } from "../lib/rich-text";
import { parseVideoLink, type LessonVideo } from "../lib/lesson-video";
import { labelLimit, maxLevels, maxSections, type CourseLabels } from "../lib/course-structure";
import { noteLimit, validNote, type ProgressSummary } from "../lib/course-progress";
import { suppressSmall } from "../lib/connect-retention";
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
  visibility: z.enum(["hidden", "unlisted", "listed", "community", "public"]).default("hidden"),
  coverFileId: uuid.nullable().optional(),
};
const plain = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const attachmentIds = z.array(uuid).max(20).refine(ids => new Set(ids).size === ids.length);
const lesson = z.object({ attachmentFileIds: attachmentIds.optional(), id: uuid.optional(), title, published: z.boolean(), body: z.unknown(), videoUrl: z.string().max(2048).nullable().optional() }).strict()
  .transform(({ videoUrl, ...input }, ctx) => {
    const body = sanitizeRichText(input.body);
    if (!body || Buffer.byteLength(JSON.stringify(body)) > 28_000) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "Invalid lesson body" });
      return z.NEVER;
    }
    // The pasted link is parsed to an allow-listed provider and video id; only those are stored.
    const video: LessonVideo | null = videoUrl?.trim() ? parseVideoLink(videoUrl) : null;
    if (videoUrl?.trim() && !video) {
      ctx.addIssue({ code: "custom", path: ["videoUrl"], message: "Invalid video link" });
      return z.NEVER;
    }
    return { ...input, body, video };
  });
// Level and section titles may be empty: the screens then show the course's label and number ("Week 2").
const partTitle = z.string().trim().max(120).refine(plain).default("");
const section = z.object({ id: uuid.optional(), title: partTitle, lessons: z.array(lesson).max(50).default([]) }).strict();
const level = z.object({ id: uuid.optional(), title: partTitle, sections: z.array(section).max(maxSections).default([]) }).strict();
const label = z.string().trim().max(labelLimit).refine(plain).nullable().optional().transform((value) => value || null);
const labels = z.object({ level: label, section: label, lesson: label }).strict();
/**
 * A course's content, in one of three shapes: `levels` (each holding sections), `sections` (no levels), or the original flat `lessons`, which
 * become one untitled section. Positions follow the nesting order, so the lesson order is one list across the course.
 */
const course = z.object({ ...fields, kind: z.literal("course"), labels: labels.optional(), lessons: z.array(lesson).max(50).optional(),
  sections: z.array(section).max(maxSections).optional(), levels: z.array(level).max(maxLevels).optional() }).strict()
  .superRefine((input, ctx) => {
    if ([input.lessons, input.sections, input.levels].filter((part) => part !== undefined).length > 1)
      ctx.addIssue({ code: "custom", message: "Send one course shape" });
    const parts = input.levels ? input.levels.flatMap((row) => row.sections) : input.sections ?? [];
    if (parts.length > maxSections) ctx.addIssue({ code: "custom", path: ["sections"], message: "Too many sections" });
    if (parts.reduce((sum, row) => sum + row.lessons.length, 0) > 50) ctx.addIssue({ code: "custom", path: ["lessons"], message: "Too many lessons" });
  });
const draft = z.discriminatedUnion("kind", [
  course,
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
type Metadata = { slug: string; title: string; summary: string; kind: Item["kind"]; priceLabel?: string; hasCover?: boolean };
type Content = Metadata & { lessons: { id: string; title: string; body: RichDoc; sectionId?: string; video?: LessonVideo | null }[]; files: { id: string; name: string }[];
  labels?: CourseLabels; levels?: { id: string; title: string }[]; sections?: { id: string; levelId: string | null; title: string }[];
  /** 0131: the caller's own completed lessons and notes (published lessons only). */
  completed?: string[]; notes?: { lessonId: string; body: string }[] };
type CourseInput = Extract<Draft, { kind: "course" }>;
type LessonInput = NonNullable<CourseInput["lessons"]>[number];

/** The nested course input as rows in course order: levels, sections (each naming its level) and lessons (each naming its section). */
function flatten(input: CourseInput) {
  const levels: { id?: string; key: string; title: string }[] = [];
  const sections: { id?: string; key: string; level: string | null; title: string }[] = [];
  const lessons: (LessonInput & { section: string })[] = [];
  const addSection = (row: z.infer<typeof section>, level: string | null) => {
    const key = row.id ?? randomUUID();
    sections.push({ id: row.id, key, level, title: row.title });
    for (const item of row.lessons) lessons.push({ ...item, section: key });
  };
  if (input.levels) for (const row of input.levels) {
    const key = row.id ?? randomUUID();
    levels.push({ id: row.id, key, title: row.title });
    for (const part of row.sections) addSection(part, key);
  }
  else if (input.sections) for (const part of input.sections) addSection(part, null);
  else if (input.lessons?.length) addSection({ title: "", lessons: input.lessons }, null);
  return { levels, sections, lessons };
}

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
  state: catalogItems.state, visibility: catalogItems.visibility, coverFileId: catalogItems.coverFileId, priceLabel: catalogItems.priceLabel, version: catalogItems.version, updatedAt: catalogItems.updatedAt,
};
const catalogView = <T extends Pick<Item, "visibility" | "state">>(row: T) => {
  const visibility = legacyCatalogVisibility(row.visibility);
  const publicationVisibility: CatalogPublicationVisibility = row.state === "draft" ? "draft"
    : visibility === "listed" ? "public" : visibility === "hidden" ? "community" : "unlisted";
  return { ...row, visibility, publicationVisibility };
};
const audit = (tx: Transaction, tenantId: string, actorId: string, action: string, item: Item) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action, targetId: item.id, metadata: { state: item.state, version: String(item.version) } });

export function listCatalog(db: Database, user: string, tenant: string, after: string | null) {
  return ministry(db, user, tenant, false, async (tx, scope) =>
    (await tx.select(editorialMetadata).from(catalogItems)
      .where(and(eq(catalogItems.tenantId, scope), after === null ? undefined : sql`${catalogItems.id} > ${uuid.parse(after)}::uuid`))
      .orderBy(catalogItems.id).limit(50)).map(catalogView));
}
export function getCatalogDraft(db: Database, user: string, tenant: string, id: string) {
  return ministry(db, user, tenant, false, async (tx, scope, role) => {
    const author = role === "owner" || role === "admin";
    const query = tx.select(editorialMetadata).from(catalogItems).where(itemScope(scope, id));
    const [item] = await (author ? query.for("share") : query);
    if (!item) throw notFound();
    if (!author) return catalogView(item);
    const rows = await tx.select({ id: catalogLessons.id, title: catalogLessons.title, body: catalogLessons.body, published: catalogLessons.published,
      sectionId: catalogLessons.sectionId, videoProvider: catalogLessons.videoProvider, videoId: catalogLessons.videoId })
      .from(catalogLessons).where(and(eq(catalogLessons.tenantId, scope), eq(catalogLessons.itemId, id))).orderBy(asc(catalogLessons.position));
    const attachments = await tx.select({ lessonId: catalogLessonAttachments.lessonId, fileId: catalogLessonAttachments.fileId })
      .from(catalogLessonAttachments).where(and(eq(catalogLessonAttachments.tenantId, scope), eq(catalogLessonAttachments.itemId, id)))
      .orderBy(catalogLessonAttachments.position);
    const lessons = rows.map(({ videoProvider, videoId, ...row }) => ({ ...row,
      attachmentFileIds: attachments.filter(file => file.lessonId === row.id).map(file => file.fileId), video: videoProvider && videoId ? { provider: videoProvider, id: videoId } : null }));
    const levels = await tx.select({ id: catalogLevels.id, title: catalogLevels.title }).from(catalogLevels)
      .where(and(eq(catalogLevels.tenantId, scope), eq(catalogLevels.itemId, id))).orderBy(asc(catalogLevels.position));
    const sections = await tx.select({ id: catalogSections.id, levelId: catalogSections.levelId, title: catalogSections.title }).from(catalogSections)
      .where(and(eq(catalogSections.tenantId, scope), eq(catalogSections.itemId, id))).orderBy(asc(catalogSections.position));
    const [named] = await tx.select({ level: catalogItems.levelLabel, section: catalogItems.sectionLabel, lesson: catalogItems.lessonLabel })
      .from(catalogItems).where(itemScope(scope, id));
    const downloads = await tx.select({ id: catalogFiles.fileId }).from(catalogFiles)
      .where(and(eq(catalogFiles.tenantId, scope), eq(catalogFiles.itemId, id))).orderBy(asc(catalogFiles.position));
    // The communities that show this item on their shelf (a link confers no access). Authors only, like the lessons.
    const shelves = await tx.select({ id: communityProductLinks.communityId }).from(communityProductLinks)
      .where(and(eq(communityProductLinks.tenantId, scope), eq(communityProductLinks.itemId, id))).orderBy(asc(communityProductLinks.communityId));
    return { ...catalogView(item), lessons, levels, sections, labels: named, fileIds: downloads.map((file) => file.id), communityIds: shelves.map((link) => link.id) };
  });
}
async function writeDraft(tx: Transaction, item: Item, input: Draft) {
  if (input.kind === "course") {
    const owner = { tenantId: item.tenantId, itemId: item.id };
    const scope = and(eq(catalogLessons.tenantId, item.tenantId), eq(catalogLessons.itemId, item.id));
    const sectionScope = and(eq(catalogSections.tenantId, item.tenantId), eq(catalogSections.itemId, item.id));
    const levelScope = and(eq(catalogLevels.tenantId, item.tenantId), eq(catalogLevels.itemId, item.id));
    const { levels, sections, lessons } = flatten(input);
    // A supplied id must already belong to this course (and appear once); anything else is the same unavailable answer as a missing item.
    const known = (rows: { id?: string }[], stored: { id: string }[]) => {
      const ids = rows.flatMap((row) => row.id ? [row.id] : []), old = new Set(stored.map((row) => row.id));
      if (new Set(ids).size !== ids.length || ids.some((id) => !old.has(id))) throw notFound();
    };
    known(lessons, await tx.select({ id: catalogLessons.id }).from(catalogLessons).where(scope));
    known(sections, await tx.select({ id: catalogSections.id }).from(catalogSections).where(sectionScope));
    known(levels, await tx.select({ id: catalogLevels.id }).from(catalogLevels).where(levelScope));
    // Upserts by id (0131): a kept lesson keeps its row, so learner progress and notes on it survive edits and reorders. Position uniques are checked at
    // commit, so swapped positions do not collide midway. Only the rows the owner removed are deleted, after everything kept has moved off them.
    const upsert = <T extends typeof catalogLevels | typeof catalogSections | typeof catalogLessons>(table: T, set: Record<string, unknown>) =>
      ({ target: [table.tenantId, table.itemId, table.id], set });
    if (levels.length) await tx.insert(catalogLevels).values(levels.map((row, position) => ({ ...owner, id: row.key, title: row.title, position })))
      .onConflictDoUpdate(upsert(catalogLevels, { title: sql`excluded.title`, position: sql`excluded.position` }));
    if (sections.length) await tx.insert(catalogSections).values(sections.map((row, position) =>
      ({ ...owner, id: row.key, levelId: row.level, title: row.title, position })))
      .onConflictDoUpdate(upsert(catalogSections, { title: sql`excluded.title`, position: sql`excluded.position`, levelId: sql`excluded.level_id` }));
    const lessonRows = lessons.map(({ section: sectionId, video, id, attachmentFileIds, ...row }, position) =>
      ({ record: { ...row, ...owner, id: id ?? randomUUID(), position, sectionId, videoProvider: video?.provider ?? null, videoId: video?.id ?? null }, attachmentFileIds }));
    if (lessonRows.length) await tx.insert(catalogLessons).values(lessonRows.map(({ record }) => record))
      .onConflictDoUpdate(upsert(catalogLessons, { title: sql`excluded.title`, body: sql`excluded.body`, published: sql`excluded.published`, position: sql`excluded.position`,
        sectionId: sql`excluded.section_id`, videoProvider: sql`excluded.video_provider`, videoId: sql`excluded.video_id` }));
    const configured = lessonRows.filter(row => row.attachmentFileIds !== undefined);
    const requested = [...new Set(configured.flatMap(row => row.attachmentFileIds ?? []))];
    await requireCatalogAssets(tx, item.tenantId, requested);
    if (configured.length) {
      await tx.delete(catalogLessonAttachments).where(and(eq(catalogLessonAttachments.tenantId, item.tenantId),
        eq(catalogLessonAttachments.itemId, item.id), inArray(catalogLessonAttachments.lessonId, configured.map(({ record }) => record.id))));
      const attachments = configured.flatMap(({ record, attachmentFileIds }) =>
        (attachmentFileIds ?? []).map((fileId, position) => ({ ...owner, lessonId: record.id, fileId, position })));
      if (attachments.length) await tx.insert(catalogLessonAttachments).values(attachments);
    }
    const keep = (ids: string[], column: typeof catalogLessons.id | typeof catalogSections.id | typeof catalogLevels.id) =>
      ids.length ? sql`${column} not in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})` : sql`true`;
    await tx.delete(catalogLessons).where(and(scope, keep(lessonRows.map(({ record }) => record.id), catalogLessons.id)));
    await tx.delete(catalogSections).where(and(sectionScope, keep(sections.map((row) => row.key), catalogSections.id)));
    await tx.delete(catalogLevels).where(and(levelScope, keep(levels.map((row) => row.key), catalogLevels.id)));
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
async function requireCatalogAssets(tx: Transaction, tenant: string, ids: string[], image = false) {
  if (!ids.length) return;
  const rows = await tx.select({ id: files.id }).from(files).where(and(eq(files.tenantId, tenant), inArray(files.id, ids),
    eq(files.status, "ready"), eq(files.visibility, "private"), eq(files.socialUpload, false),
    image ? inArray(files.mime, [...coverMimes]) : undefined)).for("share");
  if (rows.length !== ids.length) throw notFound();
}
const itemFields = (input: Draft) => {
  const { title, summary, slug, visibility, coverFileId } = input;
  // Labels belong to the course. A save without them keeps the ones stored (the original API sends none).
  const named = input.kind === "course" && input.labels ? { levelLabel: input.labels.level, sectionLabel: input.labels.section, lessonLabel: input.labels.lesson } : {};
  return { title, summary, slug, visibility, ...(coverFileId === undefined ? {} : { coverFileId }), ...named };
};

export function createCatalogItem(db: Database, user: string, tenant: string, raw: unknown) {
  return ministry(db, user, tenant, true, async (tx, scope) => {
    const input = draft.parse(raw);
    if (input.coverFileId) await requireCatalogAssets(tx, scope, [input.coverFileId], true);
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
    if (input.draft.coverFileId) await requireCatalogAssets(tx, scope, [input.draft.coverFileId], true);
    await writeDraft(tx, current, input.draft);
    const fields = itemFields(input.draft);
    if (fields.visibility === legacyCatalogVisibility(current.visibility)) fields.visibility = current.visibility;
    const [item] = await tx.update(catalogItems).set({ ...fields, version: current.version + 1, updatedAt: new Date() })
      .where(itemScope(scope, id)).returning();
    await audit(tx, scope, user, "catalog.edit", item);
    await refreshDiscoverListing(tx, scope, item.kind === "course" ? "course" : "product", id);
    return { id, version: item.version };
  });
}
const publication = z.object({ version, visibility: z.enum(catalogPublicationVisibilities).optional(),
  coverFileId: uuid.nullable().optional() }).strict().refine(value => value.visibility !== undefined || value.coverFileId !== undefined);

export function setCatalogPublication(db: Database, user: string, tenant: string, id: string, raw: unknown) {
  return ministry(db, user, tenant, true, async (tx, scope) => {
    const current = await lockItem(tx, scope, id);
    const input = publication.parse(raw);
    if (current.version !== input.version || current.state === "archived") throw conflict();
    if (input.coverFileId) await requireCatalogAssets(tx, scope, [input.coverFileId], true);
    const state = input.visibility === "draft" ? "draft" : current.state;
    const visibility = input.visibility === undefined || input.visibility === "draft" ? current.visibility : input.visibility;
    const [item] = await tx.update(catalogItems).set({ state, visibility, coverFileId: input.coverFileId,
      version: current.version + 1, updatedAt: new Date() }).where(itemScope(scope, id)).returning();
    await audit(tx, scope, user, "catalog.publication", item);
    await refreshDiscoverListing(tx, scope, item.kind === "course" ? "course" : "product", id);
    return { version: item.version, state: item.state, visibility: catalogView(item).publicationVisibility, coverFileId: item.coverFileId };
  });
}

export function setCatalogState(db: Database, user: string, tenant: string, id: string, raw: unknown) {
  return ministry(db, user, tenant, true, async (tx, scope) => {
    const current = await lockItem(tx, scope, id);
    const input = transition.parse(raw);
    if (input.version !== current.version || current.state === "archived") throw conflict();
    if (input.state === current.state) return { id, version: current.version, state: current.state };
    if (input.state === "published") {
      // A hidden item may be published (founder, 26 Nov): it is then seen only through the community shelves that show it.
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
      await tx.insert(communityProductLinks).values({ tenantId: scope, communityId, itemId: id, position, kind: current.kind })
        .onConflictDoUpdate({ target: [communityProductLinks.tenantId, communityProductLinks.communityId, communityProductLinks.itemId], set: { position } });
    }
    await tx.insert(auditLogs).values({ tenantId: scope, actorId: user, action: remove ? "catalog.unlink" : "catalog.link",
      targetId: id, metadata: { communityId } });
    return { linked: !remove };
  });
}
/**
 * C13/C16 owner view: the ministry's published courses and downloads, each with whether this community shows it. Links are read under the catalogue
 * staff policy, so a ministry member without catalogue rights sees every item unlinked (and cannot change it).
 */
export function listCommunityShelf(db: Database, user: string, tenant: string, communityId: string) {
  return ministry(db, user, tenant, false, async (tx, scope) => {
    if (!uuid.safeParse(communityId).success) throw notFound();
    const [community] = await tx.select({ id: communities.id }).from(communities)
      .where(and(eq(communities.tenantId, scope), eq(communities.id, communityId)));
    if (!community) throw notFound();
    const rows = await tx.select({ id: catalogItems.id, kind: catalogItems.kind, slug: catalogItems.slug, title: catalogItems.title, visibility: catalogItems.visibility,
      position: communityProductLinks.position, featured: communityProductLinks.featured })
      .from(catalogItems).leftJoin(communityProductLinks, and(eq(communityProductLinks.tenantId, catalogItems.tenantId),
        eq(communityProductLinks.itemId, catalogItems.id), eq(communityProductLinks.communityId, communityId)))
      .where(and(eq(catalogItems.tenantId, scope), eq(catalogItems.state, "published")))
      .orderBy(sql`${communityProductLinks.position} is null`, desc(communityProductLinks.featured), asc(communityProductLinks.position), asc(catalogItems.title), asc(catalogItems.id)).limit(500);
    return rows.map(({ position, featured, ...row }) => ({ ...row, visibility: legacyCatalogVisibility(row.visibility), linked: position !== null, position, featured: featured === true }));
  });
}
const arrangement = z.object({ kind: z.enum(["course", "download"]), order: z.array(uuid).max(500).refine((ids) => new Set(ids).size === ids.length),
  featured: uuid.nullable() }).strict();
/**
 * C13/C16 owner order of one shelf: `order` must name exactly the items this community shows of that kind; their positions become the list order.
 * `featured` is one of them or null. At most one featured item per community and shelf (partial unique index); the old one is cleared first.
 */
export function arrangeCommunityShelf(db: Database, user: string, tenant: string, communityId: string, raw: unknown) {
  return ministry(db, user, tenant, true, async (tx, scope) => {
    if (!uuid.safeParse(communityId).success) throw notFound();
    const input = arrangement.parse(raw);
    const [community] = await tx.select({ id: communities.id }).from(communities)
      .where(and(eq(communities.tenantId, scope), eq(communities.id, communityId)));
    if (!community) throw notFound();
    const shelf = and(eq(communityProductLinks.tenantId, scope), eq(communityProductLinks.communityId, communityId), eq(communityProductLinks.kind, input.kind));
    const current = await tx.select({ id: communityProductLinks.itemId }).from(communityProductLinks).where(shelf).for("update");
    const linked = new Set(current.map((row) => row.id));
    if (input.order.length !== linked.size || input.order.some((id) => !linked.has(id))) throw conflict();
    if (input.featured !== null && !linked.has(input.featured)) throw conflict();
    await tx.update(communityProductLinks).set({ featured: false }).where(and(shelf, eq(communityProductLinks.featured, true)));
    for (const [position, itemId] of input.order.entries())
      await tx.update(communityProductLinks).set({ position, featured: itemId === input.featured }).where(and(shelf, eq(communityProductLinks.itemId, itemId)));
    await tx.insert(auditLogs).values({ tenantId: scope, actorId: user, action: "catalog.arrange", targetId: communityId,
      metadata: { kind: input.kind, featured: input.featured ?? "" } });
    return { order: input.order, featured: input.featured };
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
/** Published metadata by exact slug. A hidden item resolves only with the `user` of a community whose shelf shows it (0123). */
export const getPublicCatalogItem = (db: Database, slug: string, user?: string) => access<Metadata>(db, slug, "metadata", user);
export const enrolInCatalogItem = (db: Database, user: string, slug: string) => access<{ enrolled: true }>(db, slug, "enrol", user);
export const getCatalogContent = (db: Database, user: string, slug: string) => access<Content>(db, slug, "content", user);
export async function catalogDownload(db: Database, user: string, slug: string, fileId: string, storage: () => Pick<StorageAdapter, "presignDownload">) {
  const file = await access<{ key: string; name: string }>(db, slug, "file", user, fileId);
  return { url: await storage().presignDownload(file.key, file.name) };
}

// 0131 learner progress and notes. Every write goes through public.catalog_learner, which first passes catalog_access(slug, 'content'): only an
// enrolled learner with an active grant, on a published lesson of a course they can open, writes, and only their own row.
const noteBody = z.string().max(noteLimit).refine((value) => validNote(value));
async function learner(db: Database, user: string, slug: string, lesson: string, action: "complete" | "incomplete" | "note", body?: string) {
  ensureEnabled();
  if (!slugSchema.safeParse(slug).success || !uuid.safeParse(lesson).success) throw notFound();
  const result = await withUser(db, user, (tx) => tx.execute<{ data: Record<string, boolean> | null }>(
    sql`select public.catalog_learner(${slug}, ${lesson}::uuid, ${action}, ${body ?? null}) as data`));
  const data = result.rows[0]?.data;
  if (data == null) throw notFound();
  return data;
}
/** Marks one lesson complete or not complete for the signed-in learner. */
export async function setLessonComplete(db: Database, user: string, slug: string, lesson: string, raw: unknown) {
  const { completed } = z.object({ completed: z.boolean() }).strict().parse(raw);
  return learner(db, user, slug, lesson, completed ? "complete" : "incomplete") as Promise<{ completed: boolean }>;
}
/** Saves the learner's private note on one lesson; an empty note deletes it. Plain text, at most 4000 characters. */
export async function saveLessonNote(db: Database, user: string, slug: string, lesson: string, raw: unknown) {
  const { body } = z.object({ body: noteBody }).strict().parse(raw);
  return learner(db, user, slug, lesson, "note", body) as Promise<{ saved: true }>;
}
export type MyNote = { lessonId: string; body: string; updatedAt: string; course: { slug: string; title: string } | null; lesson: string | null };
/** The signed-in person's notes across courses, newest first. */
export async function listMyNotes(db: Database, user: string) {
  ensureEnabled();
  const result = await withUser(db, user, (tx) => tx.execute<{ data: MyNote[] | null }>(sql`select public.catalog_my_notes() as data`));
  return result.rows[0]?.data ?? [];
}
/**
 * Owners and admins: one course's enrolment and per-lesson completion counts. Counts of 1 to 4 are withheld (null) by the database and again here
 * (the shared small-group rule). No learner, row or note is ever returned.
 */
export function getCatalogProgress(db: Database, user: string, tenant: string, id: string) {
  return ministry(db, user, tenant, true, async (tx, scope) => {
    if (!uuid.safeParse(id).success) throw notFound();
    const result = await tx.execute<{ data: ProgressSummary | null }>(sql`select public.catalog_progress_summary(${scope}::uuid, ${id}::uuid) as data`);
    const data = result.rows[0]?.data;
    if (!data) throw notFound();
    return { ...data, enrolled: data.enrolled === null ? null : suppressSmall(data.enrolled),
      lessons: data.lessons.map((row) => ({ ...row, completed: row.completed === null ? null : suppressSmall(row.completed) })) };
  });
}
