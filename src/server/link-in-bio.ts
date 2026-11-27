import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, bioClicks, bioMessages, bioPages, catalogItems, communities } from "../db/schema";
import { message } from "../i18n/messages";
import { isBrandTheme } from "../lib/theme-registry";
import { bioDefinitionSchema, bioHandleSchema, bioMessageSchema, emptyBioDefinition, fieldIssues, handleProblem, publishIssues, shownTabs, suggestHandle,
  type BioCatalogCard, type BioDefinition, type BioView, type BioViewBlock } from "../lib/link-in-bio";
import type { GivingPublicMethod } from "../lib/ways-to-give";
import { bioMessagesKey, linkInBioEnabled } from "./link-in-bio-mode";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import { bioGivingMethods, managerGivingPreview } from "./ways-to-give";

export function requireLinkInBioEnabled() { if (!linkInBioEnabled()) throw new AccessError(404, message("Errors.thisViewIsNotAvailable")); }
const uuid = z.uuid();
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
const code = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return code(error.cause);
};

export type BioOwnerView = {
  id: string; handle: string; status: "draft" | "published"; version: number; draft: BioDefinition; photoFileId: string | null; coverFileId: string | null; publishedAt: string | null;
  /** The draft differs from what visitors see. */
  unpublishedChanges: boolean;
  /** "Message me" can be offered only where the synthetic message mode is on. */
  messagesAvailable: boolean;
  /** Clicks per block over the last 30 days (approximate: no people are counted). */
  clicks: Record<string, number>;
  newMessages: number;
};

const sameDefinition = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function randomSuffix() { return randomBytes(3).toString("hex").slice(0, 4); }
async function freeHandle(tx: Transaction, tenantId: string, name: string) {
  const base = suggestHandle(name) || "ministry";
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 25).replace(/-+$/, "")}-${randomSuffix()}`;
    if (handleProblem(candidate)) continue;
    const { rows: [row] } = await tx.execute<{ taken: boolean }>(sql`select public.bio_handle_taken(${candidate}, ${tenantId}::uuid) as taken`);
    if (!row.taken) return candidate;
  }
  throw new AccessError(409, message("Errors.linkInBioHandleTaken"));
}

async function project(tx: Transaction, row: typeof bioPages.$inferSelect): Promise<BioOwnerView> {
  const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const counts = await tx.select({ block: bioClicks.blockId, clicks: sql<number>`sum(${bioClicks.clicks})::int` }).from(bioClicks)
    .where(and(eq(bioClicks.tenantId, row.tenantId), gte(bioClicks.day, since))).groupBy(bioClicks.blockId);
  const [unread] = await tx.select({ n: sql<number>`count(*)::int` }).from(bioMessages).where(and(eq(bioMessages.tenantId, row.tenantId), eq(bioMessages.status, "new"), sql`${bioMessages.expiresAt} > now()`));
  // Older drafts lack the fields added since (tab names, layout, cover switch, photo position, icon style): the schema's defaults fill them in.
  const draft = bioDefinitionSchema.safeParse(row.draft);
  return { id: row.id, handle: row.handle, status: row.status, version: row.version, draft: draft.success ? draft.data : row.draft, photoFileId: row.photoFileId, coverFileId: row.coverFileId, publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    unpublishedChanges: row.status === "published" && !sameDefinition(row.draft, row.published), messagesAvailable: bioMessagesKey() !== null,
    clicks: Object.fromEntries(counts.map((c) => [c.block, Number(c.clicks)])), newMessages: Number(unread?.n ?? 0) };
}

/** The ministry's page, created empty the first time an owner or admin opens the editor (handle from the ministry name, never colliding). */
export async function getBioPage(db: Database, user: string, workspace: string): Promise<BioOwnerView> {
  requireLinkInBioEnabled();
  return withTenant(db, user, uuid.parse(workspace), "bio:manage", async (tx, tenantId) => {
    const [existing] = await tx.select().from(bioPages).where(eq(bioPages.tenantId, tenantId));
    if (existing) return project(tx, existing);
    const { rows: [ministry] } = await tx.execute<{ name: string }>(sql`select name from workspaces where tenant_id = ${tenantId}`);
    const name = ministry?.name ?? "";
    const handle = await freeHandle(tx, tenantId, name);
    try {
      await tx.execute(sql`savepoint bio_create`);
      const [row] = await tx.insert(bioPages).values({ tenantId, handle, draft: emptyBioDefinition(name), createdBy: user }).returning();
      await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "bio.create", targetId: row.id });
      return project(tx, row);
    } catch (error) {
      if (code(error) === "23505") { await tx.execute(sql`rollback to savepoint bio_create`); const [raced] = await tx.select().from(bioPages).where(eq(bioPages.tenantId, tenantId)); if (raced) return project(tx, raced); throw new AccessError(409, message("Errors.linkInBioHandleTaken")); }
      throw error;
    }
  });
}

const saveInput = z.object({ version: z.number().int().min(1).max(2147483646), handle: bioHandleSchema.optional(), definition: bioDefinitionSchema }).strict();

/** Everything a block points at must belong to this ministry: a community that exists, a sign-up form that is currently published. */
async function checkReferences(tx: Transaction, tenantId: string, definition: BioDefinition) {
  const communityIds = definition.blocks.flatMap((block) => block.type === "community" ? [block.communityId] : []);
  if (communityIds.length) {
    const found = await tx.select({ id: communities.id }).from(communities).where(eq(communities.tenantId, tenantId));
    if (communityIds.some((id) => !found.some((row) => row.id === id))) throw new AccessError(400, message("Errors.linkInBioBlockUnavailable"));
  }
  // Products, courses and download products must be this ministry's own (read through row security as this manager).
  const itemIds = [...new Set(definition.blocks.flatMap((block) => block.type === "catalog" || block.type === "files" ? block.itemIds : []))];
  if (itemIds.length) {
    const found = await tx.select({ id: catalogItems.id, kind: catalogItems.kind }).from(catalogItems).where(and(eq(catalogItems.tenantId, tenantId), inArray(catalogItems.id, itemIds)));
    if (found.length !== itemIds.length) throw new AccessError(400, message("Errors.linkInBioBlockUnavailable"));
    const downloads = new Set(found.filter((row) => row.kind === "download").map((row) => row.id));
    if (definition.blocks.some((block) => block.type === "files" && block.itemIds.some((id) => !downloads.has(id)))) throw new AccessError(400, message("Errors.linkInBioBlockUnavailable"));
  }
  for (const block of definition.blocks) {
    if (block.type !== "newsletter" && block.type !== "form") continue;
    const { rows } = await tx.execute(sql`select 1 from crm_form_addresses where tenant_id = ${tenantId} and slug = ${block.slug}`);
    if (!rows.length) throw new AccessError(400, message("Errors.linkInBioBlockUnavailable"));
  }
}

export async function saveBioDraft(db: Database, user: string, workspace: string, raw: unknown): Promise<BioOwnerView> {
  requireLinkInBioEnabled();
  const input = saveInput.parse(raw);
  return withTenant(db, user, uuid.parse(workspace), "bio:manage", async (tx, tenantId) => {
    const [current] = await tx.select().from(bioPages).where(eq(bioPages.tenantId, tenantId)).for("update");
    if (!current) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
    if (current.version !== input.version) throw stale();
    const handle = input.handle ?? current.handle;
    if (handle !== current.handle) {
      if (current.status === "published") throw new AccessError(409, message("Errors.linkInBioHandleLocked"));
      const { rows: [row] } = await tx.execute<{ taken: boolean }>(sql`select public.bio_handle_taken(${handle}, ${tenantId}::uuid) as taken`);
      if (row.taken) throw new AccessError(409, message("Errors.linkInBioHandleTaken"), { reason: "handle_taken" });
    }
    await checkReferences(tx, tenantId, input.definition);
    try {
      await tx.execute(sql`savepoint bio_save`);
      const [row] = await tx.update(bioPages).set({ handle, draft: input.definition, version: current.version + 1, updatedAt: new Date() }).where(and(eq(bioPages.tenantId, tenantId), eq(bioPages.version, current.version))).returning();
      if (!row) throw stale();
      await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "bio.save", targetId: row.id, metadata: { version: String(row.version) } });
      return project(tx, row);
    } catch (error) {
      if (code(error) === "23505") { await tx.execute(sql`rollback to savepoint bio_save`); throw new AccessError(409, message("Errors.linkInBioHandleTaken"), { reason: "handle_taken" }); }
      throw error;
    }
  });
}

/** Handle problems are checked on the client for instant feedback and again here: length, characters, reserved words, and whether another ministry has it. */
export async function checkBioHandle(db: Database, user: string, workspace: string, raw: string): Promise<{ available: boolean; problem: "length" | "characters" | "reserved" | "taken" | null }> {
  requireLinkInBioEnabled();
  const handle = raw.trim().toLowerCase();
  return withTenant(db, user, uuid.parse(workspace), "bio:manage", async (tx, tenantId) => {
    const problem = handleProblem(handle);
    if (problem) return { available: false, problem };
    const { rows: [row] } = await tx.execute<{ taken: boolean }>(sql`select public.bio_handle_taken(${handle}, ${tenantId}::uuid) as taken`);
    return row.taken ? { available: false, problem: "taken" as const } : { available: true, problem: null };
  });
}

const transitionInput = z.object({ action: z.enum(["publish", "unpublish"]), version: z.number().int().min(1).max(2147483646) }).strict();
export async function transitionBioPage(db: Database, user: string, workspace: string, raw: unknown): Promise<BioOwnerView> {
  requireLinkInBioEnabled();
  const input = transitionInput.parse(raw);
  return withTenant(db, user, uuid.parse(workspace), "bio:manage", async (tx, tenantId) => {
    const [current] = await tx.select().from(bioPages).where(eq(bioPages.tenantId, tenantId));
    if (!current) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
    if (input.action === "publish") {
      if (current.version !== input.version) throw stale();
      const definition = bioDefinitionSchema.safeParse(current.draft);
      if (!definition.success || publishIssues(definition.data, { hasPhoto: current.photoFileId !== null }).length || Object.keys(fieldIssues(definition.data)).length) throw new AccessError(400, message("Errors.linkInBioNotReady"));
      await checkReferences(tx, tenantId, definition.data);
    }
    const { rows: [row] } = await tx.execute<{ result: string }>(sql`select public.bio_transition(${tenantId}::uuid, ${input.action}, ${input.version}) as result`);
    if (row.result === "stale") throw stale();
    if (row.result === "invalid") throw new AccessError(400, message("Errors.linkInBioNotReady"));
    if (row.result === "not_found") throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
    const [fresh] = await tx.select().from(bioPages).where(eq(bioPages.tenantId, tenantId));
    return project(tx, fresh);
  });
}

// ---- Messages (owner side) ---------------------------------------------------------------------------------------------------------------------------------
export type BioMessageRow = { id: string; name: string; email: string; body: string; status: "new" | "handled"; createdAt: string; expiresAt: string; contactId: string; createdContact: boolean };

export async function listBioMessages(db: Database, user: string, workspace: string): Promise<{ messages: BioMessageRow[]; available: boolean }> {
  requireLinkInBioEnabled();
  return withTenant(db, user, uuid.parse(workspace), "bio:manage", async (tx, tenantId) => {
    await tx.execute(sql`select public.bio_purge_expired(${tenantId}::uuid)`);
    const rows = await tx.select({ id: bioMessages.id, name: bioMessages.name, email: bioMessages.email, body: bioMessages.body, status: bioMessages.status, createdAt: bioMessages.createdAt,
      expiresAt: bioMessages.expiresAt, contactId: bioMessages.contactId, createdContact: bioMessages.createdContact }).from(bioMessages)
      .where(and(eq(bioMessages.tenantId, tenantId), sql`${bioMessages.expiresAt} > now()`)).orderBy(desc(bioMessages.createdAt), desc(bioMessages.id)).limit(200);
    return { available: bioMessagesKey() !== null, messages: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() })) };
  });
}

const messageChange = z.object({ status: z.enum(["new", "handled"]) }).strict();
export async function updateBioMessage(db: Database, user: string, workspace: string, id: string, raw: unknown) {
  requireLinkInBioEnabled();
  const input = messageChange.parse(raw);
  return withTenant(db, user, uuid.parse(workspace), "bio:manage", async (tx, tenantId) => {
    const rows = await tx.update(bioMessages).set({ status: input.status }).where(and(eq(bioMessages.tenantId, tenantId), eq(bioMessages.id, uuid.parse(id)))).returning({ id: bioMessages.id });
    if (!rows.length) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
    return { id: rows[0].id, status: input.status };
  });
}
export async function deleteBioMessage(db: Database, user: string, workspace: string, id: string) {
  requireLinkInBioEnabled();
  return withTenant(db, user, uuid.parse(workspace), "bio:manage", async (tx, tenantId) => {
    const rows = await tx.delete(bioMessages).where(and(eq(bioMessages.tenantId, tenantId), eq(bioMessages.id, uuid.parse(id)))).returning({ id: bioMessages.id });
    if (!rows.length) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "bio.message.delete", targetId: rows[0].id });
    return { id: rows[0].id };
  });
}

/** What the owner may pick from: this ministry's communities and its currently published sign-up forms. */
export type BioChoices = { communities: { id: string; name: string; status: string }[]; signups: { slug: string; title: string }[]; giving?: GivingPublicMethod[];
  /** 0134: the ministry's products and courses (any state; only published, not hidden ones reach visitors) and its live hosted forms other than sign-ups. */
  catalog?: { id: string; kind: "course" | "download"; slug: string; title: string; summary: string; state: string; visibility: string }[]; forms?: { slug: string; title: string }[] };
export async function bioChoices(db: Database, user: string, workspace: string): Promise<BioChoices> {
  requireLinkInBioEnabled();
  return withTenant(db, user, uuid.parse(workspace), "bio:manage", async (tx, tenantId) => {
    const list = await tx.select({ id: communities.id, name: communities.name, status: communities.status }).from(communities).where(eq(communities.tenantId, tenantId)).orderBy(communities.name);
    const { rows } = await tx.execute<{ slug: string; title: string }>(sql`
      select a.slug, coalesce(nullif(p.definition->>'title', ''), f.name) as title from crm_form_addresses a
      join forms f on f.tenant_id = a.tenant_id and f.id = a.form_id and f.archived_at is null
      join crm_form_publications p on p.tenant_id = a.tenant_id and p.form_id = a.form_id and p.version_id = a.version_id
      where a.tenant_id = ${tenantId} and a.version_id is not null and p.definition->'newsletter' is not null order by a.slug limit 50`);
    // The preview shows the enabled methods a visitor would see, read through row security as this manager (none without Giving access).
    const giving = await managerGivingPreview(tx, tenantId);
    const catalog = await tx.select({ id: catalogItems.id, kind: catalogItems.kind, slug: catalogItems.slug, title: catalogItems.title, summary: catalogItems.summary, state: catalogItems.state, visibility: catalogItems.visibility })
      .from(catalogItems).where(and(eq(catalogItems.tenantId, tenantId), sql`${catalogItems.state} <> 'archived'`)).orderBy(catalogItems.title).limit(100);
    const { rows: forms } = await tx.execute<{ slug: string; title: string }>(sql`
      select a.slug, coalesce(nullif(p.definition->>'title', ''), f.name) as title from crm_form_addresses a
      join forms f on f.tenant_id = a.tenant_id and f.id = a.form_id and f.archived_at is null
      join crm_form_publications p on p.tenant_id = a.tenant_id and p.form_id = a.form_id and p.version_id = a.version_id
      where a.tenant_id = ${tenantId} and a.version_id is not null and p.definition->'newsletter' is null order by a.slug limit 50`);
    return { communities: list, signups: rows, giving, catalog, forms };
  });
}

// ---- Public side ---------------------------------------------------------------------------------------------------------------------------------------------
type PublicRow = { handle: string; ministryName: string; brandTheme: string | null; definition: unknown; hasPhoto: boolean; hasCover: boolean; communities: Record<string, { name: string; tagline: string | null; slug: string }>; signups: string[];
  /** 0134: published, not hidden products and courses of the ministry, and its live hosted form addresses. Absent before that migration. */
  catalog?: Record<string, Omit<BioCatalogCard, "id">>; forms?: string[];
  /** ready gallery pictures that a gallery block of the published copy lists. */
  gallery?: string[] };

/**
 * The published page as a visitor may see it, or null (missing, unpublished and unavailable are the same answer). Hidden blocks, blocks whose community was
 * unpublished or whose sign-up form was retired, and "Message me" where messages are not enabled never reach the visitor.
 */
export async function getPublicBio(db: Database, handle: string, env: Record<string, string | undefined> = process.env): Promise<BioView | null> {
  if (!linkInBioEnabled(env) || handleProblem(handle) !== null) return null;
  const { rows: [row] } = await db.execute<{ result: PublicRow | null }>(sql`select public.bio_public_page(${handle}) as result`);
  if (!row?.result) return null;
  const parsed = bioDefinitionSchema.safeParse(row.result.definition);
  if (!parsed.success) return null;
  const { definition } = { definition: parsed.data };
  const messages = bioMessagesKey(env) !== null;
  const giving = definition.blocks.some((block) => block.type === "giving" && !block.hidden) ? await bioGivingMethods(db, handle, env) : [];
  const project = (block: BioDefinition["blocks"][number]): BioViewBlock[] => {
    if (block.hidden) return [];
    switch (block.type) {
      case "link": return [{ type: "link", id: block.id, label: block.label, url: block.url, icon: block.icon }];
      case "event": return [{ type: "event", id: block.id, title: block.title, when: block.when, url: block.url }];
      case "community": { const card = row.result!.communities[block.communityId]; return card ? [{ type: "community", id: block.id, name: card.name, tagline: card.tagline, slug: card.slug }] : []; }
      case "newsletter": return row.result!.signups.includes(block.slug) ? [{ type: "newsletter", id: block.id, slug: block.slug }] : [];
      case "message": return messages ? [{ type: "message", id: block.id, title: block.title }] : [];
      case "giving": return giving.length ? [{ type: "giving", id: block.id, title: block.title, methods: giving }] : [];
      case "catalog": case "files": {
        // A file row is a download product; a course is never listed under PDFs and ebooks.
        const items = block.itemIds.flatMap((id) => { const card = row.result!.catalog?.[id]; return card && (block.type === "catalog" || card.kind === "download") ? [{ id, ...card }] : []; });
        return items.length ? [{ type: block.type, id: block.id, title: block.title, items }] : [];
      }
      case "form": return row.result!.forms?.includes(block.slug) ? [{ type: "form", id: block.id, title: block.title, slug: block.slug }] : [];
      case "video": return [{ type: "video", id: block.id, title: block.title, video: { provider: block.provider, id: block.videoId } }];
      case "contact": return [{ type: "contact", id: block.id, email: block.email, phone: block.phone, whatsapp: block.whatsapp }];
      case "location": return [{ type: "location", id: block.id, label: block.label, address: block.address }];
      case "live": return block.on ? [{ type: "live", id: block.id, title: block.title, url: block.url }] : [];
      case "testimonials": return [{ type: "testimonials", id: block.id, items: block.items }];
      case "gallery": { const ready = block.fileIds.filter((id) => row.result!.gallery?.includes(id)); return ready.length ? [{ type: "gallery", id: block.id, title: block.title, fileIds: ready }] : []; }
      case "share": return [{ type: "share", id: block.id, title: block.title }];
      case "countdown": return [{ type: "countdown", id: block.id, title: block.title, at: block.at, url: block.url }];
    }
  };
  // A hidden tab, and a tab with nothing to show, never reach the visitor.
  const tabs = shownTabs(definition, definition.blocks).map((t) => ({ ...t, blocks: t.blocks.flatMap(project) })).filter((t) => t.blocks.length > 0);
  return { handle: row.result.handle, ministryName: row.result.ministryName, name: definition.name, bio: definition.bio, tabs, layout: definition.layout, showCover: definition.cover,
    photoAlign: definition.photoAlign, iconStyle: definition.iconStyle, hasPhoto: row.result.hasPhoto, hasCover: definition.cover && row.result.hasCover,
    scheme: definition.scheme, buttons: definition.buttons, brandTheme: isBrandTheme(row.result.brandTheme) ? row.result.brandTheme : null, socials: definition.socials };
}

export type ClickOutcome = "ok" | "not_found" | "limited";
export async function recordBioClick(db: Database, handle: string, block: string, visitor: string): Promise<ClickOutcome> {
  if (!linkInBioEnabled()) return "not_found";
  const { rows: [row] } = await db.execute<{ result: ClickOutcome }>(sql`select public.bio_record_click(${handle}, ${block}, ${visitor}) as result`);
  return row.result;
}

/** One gallery picture of a published page (bio_public_gallery checks that a shown gallery block lists it), or null. */
export async function publicBioGalleryPhoto(db: Database, handle: string, file: string): Promise<{ key: string; name: string; mime: "image/jpeg" | "image/png" | "image/webp" } | null> {
  if (!linkInBioEnabled() || handleProblem(handle) !== null || !uuid.safeParse(file).success) return null;
  const { rows: [row] } = await db.execute<{ result: { key: string; name: string; mime: "image/jpeg" | "image/png" | "image/webp" } | null }>(sql`select public.bio_public_gallery(${handle}, ${file}::uuid) as result`);
  return row?.result ?? null;
}

export async function publicBioPhoto(db: Database, handle: string, kind: "photo" | "cover" = "photo"): Promise<{ key: string; name: string; mime: "image/jpeg" | "image/png" | "image/webp" } | null> {
  if (!linkInBioEnabled() || handleProblem(handle) !== null) return null;
  const { rows: [row] } = await db.execute<{ result: { key: string; name: string; mime: "image/jpeg" | "image/png" | "image/webp" } | null }>(sql`select public.bio_public_photo(${handle}, ${kind}) as result`);
  return row?.result ?? null;
}

// ---- "Message me" ------------------------------------------------------------------------------------------------------------------------------------------
const PROOF_LIFETIME_MS = 600_000;
const MINIMUM_FILL_TIME_MS = 1_000;
const sign = (key: Buffer, handle: string, payload: string) => createHmac("sha256", key).update(`bio-message-proof:${handle}:${payload}`).digest();

/** A ten-minute proof the form carries back: an HMAC over a random nonce and the issue time. Nothing about the visitor is in it. */
export function issueBioProof(handle: string, key: Buffer, now = Date.now()) {
  const payload = `${randomUUID()}.${now}`;
  return `${payload}.${sign(key, handle, payload).toString("base64url")}`;
}
function readProof(proof: string, handle: string, key: Buffer, now: number) {
  const [receipt, issued, signature, ...extra] = proof.split(".");
  if (extra.length || !uuid.safeParse(receipt).success || !/^\d{13}$/.test(issued ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(signature ?? "")) return null;
  if (!timingSafeEqual(sign(key, handle, `${receipt}.${issued}`), Buffer.from(signature, "base64url"))) return null;
  const age = now - Number(issued);
  if (age < 0 || age >= PROOF_LIFETIME_MS) return null;
  return { receipt, age, expiresAt: new Date(Number(issued) + PROOF_LIFETIME_MS).toISOString() };
}

export type MessageOutcome = "ok" | "invalid" | "spam" | "not_found" | "conflict" | "limited";
/**
 * Stores one message and creates or reuses the CRM person by email (database function; synthetic addresses only). Never sends anything: no copy to the visitor,
 * no notice to the owner. The honeypot and a one-second minimum fill time reject bots; the database rate limits and single-use receipt do the rest.
 */
export async function submitBioMessage(db: Database, handle: string, raw: unknown, key: Buffer, visitor: string, now = Date.now()): Promise<MessageOutcome> {
  const parsed = bioMessageSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  const input = parsed.data;
  const proof = readProof(input.proof, handle, key, now);
  if (!proof) return "invalid";
  if (input.website || proof.age < MINIMUM_FILL_TIME_MS) return "spam";
  const requestHash = createHmac("sha256", key).update(JSON.stringify(["bio-message", proof.receipt, input.name, input.email.toLowerCase(), input.message])).digest("hex");
  const { rows: [row] } = await db.execute<{ result: MessageOutcome }>(sql`
    select public.bio_submit_message(${handle}, ${proof.receipt}::uuid, ${proof.expiresAt}::timestamptz, ${input.name}, ${input.email}, ${input.message}, ${requestHash}, ${visitor}) as result`);
  return row.result;
}
