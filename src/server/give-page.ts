import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, fundraisingCampaigns, fundraisingFiles, fundraisingPages, workspaces } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { communityUploadInput } from "../lib/forum";
import { giveSlugPattern, givePageInput, parseGivePublicView, type GivePageSettings, type GivePublicView } from "../lib/give-page";
import type { FundraisingCurrency } from "../lib/fundraising";
import { givingReportSchema, publicGivingMethods, type GivingPublicMethod } from "../lib/ways-to-give";
import { message, type MessageKey } from "../i18n/messages";
import { communityUploadReleased } from "./community-files";
import { inspectCommunityUpload } from "./files/community-upload-verification";
import { noOpScanner, type FileScanner } from "./files/scanner";
import { givePageEnabled } from "./give-page-mode";
import { AccessError } from "./permissions";
import type { StorageAdapter } from "./storage/adapter";
import { withTenant } from "./tenancy";
import { managerGivingPreview } from "./ways-to-give";
import { can } from "../lib/permissions";

/**
 * The public fundraising page of a fundraiser (/give/<slug>, founder 26 Nov). Owners and admins set the address, description, cover and whether the amount
 * shows; the page is public while the fundraiser is open (published) and Harvest staff have not hidden the ministry's giving details. Visitors read only
 * through the database's give_public_* definers. Record keeping only: no payment, no provider, no public pledge form. Audits carry ids and field names.
 */
type Storage = () => StorageAdapter;
type FileRow = typeof fundraisingFiles.$inferSelect;
type Scope = { tenantId: string; fundraisingId: string };
const fail = (status: 403 | 404 | 409, key: MessageKey) => new AccessError(status, message(key));
const notFound = () => fail(404, "Fundraising.notFound");
const missingFile = () => fail(404, "Errors.fileNotFound");
const requireEnabled = () => { if (!givePageEnabled()) throw fail(404, "GivePage.unavailable"); };
const sqlState = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? sqlState(error.cause) : undefined;
};
const constraintOf = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  if ("constraint" in error && typeof error.constraint === "string") return error.constraint;
  return "cause" in error ? constraintOf(error.cause) : undefined;
};
const settingsColumns = { slug: fundraisingPages.slug, description: fundraisingPages.description, coverFileId: fundraisingPages.coverFileId,
  showAmount: fundraisingPages.showAmount, version: fundraisingPages.version };

async function fundraiser(tx: Transaction, tenantId: string, id: string) {
  const [row] = await tx.select({ id: fundraisingCampaigns.id, status: fundraisingCampaigns.status }).from(fundraisingCampaigns)
    .where(and(eq(fundraisingCampaigns.tenantId, tenantId), eq(fundraisingCampaigns.id, id)));
  if (!row) throw notFound();
  return row;
}
async function pageOf(tx: Transaction, tenantId: string, id: string): Promise<GivePageSettings | null> {
  const [row] = await tx.select(settingsColumns).from(fundraisingPages).where(and(eq(fundraisingPages.tenantId, tenantId), eq(fundraisingPages.fundraisingId, id)));
  return row ?? null;
}

/** The page settings of one fundraiser, or null before the first save. Owners and admins. */
export async function getGivePage(db: Database, user: string, workspace: string, fundraising: string): Promise<GivePageSettings | null> {
  requireEnabled();
  const id = uuidInput.parse(fundraising);
  return withTenant(db, user, uuidInput.parse(workspace), "fundraising:publish", async (tx, tenantId) => { await fundraiser(tx, tenantId, id); return pageOf(tx, tenantId, id); });
}

/**
 * Creates or updates the page. The address is global, lowercase and not a reserved word; it cannot change once the fundraiser has left draft (also enforced by
 * the database). An existing page needs its current version. Taken and fixed addresses answer 409 with their own message.
 */
export async function saveGivePage(db: Database, user: string, workspace: string, fundraising: string, raw: unknown): Promise<GivePageSettings> {
  requireEnabled();
  const id = uuidInput.parse(fundraising), input = givePageInput.parse(raw);
  try {
    return await withTenant(db, user, uuidInput.parse(workspace), "fundraising:publish", async (tx, tenantId) => {
      const campaign = await fundraiser(tx, tenantId, id);
      if (campaign.status === "archived") throw fail(409, "Fundraising.archived");
      const current = await pageOf(tx, tenantId, id);
      const fields: string[] = [];
      let saved: GivePageSettings;
      if (!current) {
        if (input.version !== undefined) throw fail(409, "Fundraising.stale");
        [saved] = await tx.insert(fundraisingPages).values({ tenantId, fundraisingId: id, slug: input.slug, description: input.description, showAmount: input.showAmount, createdBy: user })
          .returning(settingsColumns);
        fields.push("slug", "description", "show_amount");
      } else {
        if (input.version !== current.version) throw fail(409, "Fundraising.stale");
        if (input.slug !== current.slug) { if (campaign.status !== "draft") throw fail(409, "GivePage.slugLocked"); fields.push("slug"); }
        if (input.description !== current.description) fields.push("description");
        if (input.showAmount !== current.showAmount) fields.push("show_amount");
        if (!fields.length) return current;
        const [row] = await tx.update(fundraisingPages).set({ slug: input.slug, description: input.description, showAmount: input.showAmount, version: current.version + 1, updatedAt: new Date() })
          .where(and(eq(fundraisingPages.tenantId, tenantId), eq(fundraisingPages.fundraisingId, id), eq(fundraisingPages.version, current.version))).returning(settingsColumns);
        if (!row) throw fail(409, "Fundraising.stale");
        saved = row;
      }
      await tx.insert(auditLogs).values({ tenantId, actorId: user, action: current ? "fundraising.page.update" : "fundraising.page.create", targetId: id,
        metadata: { version: String(saved.version), fields: fields.join(",") } });
      return saved;
    });
  } catch (error) {
    if (sqlState(error) === "23505" && constraintOf(error) === "fundraising_pages_slug_idx") throw fail(409, "GivePage.slugTaken");
    if (sqlState(error) === "23514" || sqlState(error) === "23505" || sqlState(error) === "23503") throw fail(409, "Fundraising.conflict");
    throw error;
  }
}

/**
 * The owner's preview: what a visitor would see once the fundraiser is open, read through row security (the same released-raised rule as the public definer,
 * public.give_released_raised). Null before the first save. Raised needs the owner/admin giving records, so anyone else previews the suppressed state.
 */
export async function givePagePreview(db: Database, user: string, workspace: string, fundraising: string): Promise<{ view: GivePublicView; methods: GivingPublicMethod[] } | null> {
  requireEnabled();
  const id = uuidInput.parse(fundraising);
  return withTenant(db, user, uuidInput.parse(workspace), "fundraising:publish", async (tx, tenantId, _role, access) => {
    const [row] = await tx.select({ title: fundraisingCampaigns.title, currency: fundraisingCampaigns.currency, goalCents: fundraisingCampaigns.goalCents }).from(fundraisingCampaigns)
      .where(and(eq(fundraisingCampaigns.tenantId, tenantId), eq(fundraisingCampaigns.id, id)));
    if (!row) throw notFound();
    const page = await pageOf(tx, tenantId, id);
    if (!page) return null;
    const [ministry] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.tenantId, tenantId));
    let raisedCents: string | null = null;
    if (page.showAmount && can(access, "giving:record")) {
      const { rows: [released] } = await tx.execute<{ raised: string | null }>(sql`select public.give_released_raised(${tenantId}::uuid, ${id}::uuid) as raised`);
      raisedCents = released?.raised ?? null;
    }
    const hasCover = Boolean(page.coverFileId);
    const view: GivePublicView = { slug: page.slug, title: row.title, description: page.description, ministry: ministry?.name ?? "", hasCover,
      amount: page.showAmount ? { currency: row.currency as FundraisingCurrency, goalCents: row.goalCents.toString(), raisedCents } : null };
    return { view, methods: await managerGivingPreview(tx, tenantId) };
  });
}

// ---- Cover (scanned upload, the campaign/event cover steps) -----------------------------------------------------------------------------------------------
const uploadInput = communityUploadInput.refine((input) => input.kind === "cover");
const coverInput = z.object({ fileId: z.uuid().nullable(), version: z.number().int().min(1).max(2147483646) }).strict();
const summary = ({ id, name, mime, size, status, kind }: FileRow) => ({ id, name, mime, size, status, kind });
const fileOf = async (tx: Transaction, tenantId: string, fundraisingId: string, id: string, uploader?: string) => {
  const [file] = await tx.select().from(fundraisingFiles).where(and(eq(fundraisingFiles.tenantId, tenantId), eq(fundraisingFiles.fundraisingId, fundraisingId),
    eq(fundraisingFiles.id, id), isNull(fundraisingFiles.retiredAt), ...(uploader ? [eq(fundraisingFiles.uploaderId, uploader)] : [])));
  if (!file) throw missingFile();
  return file;
};
async function editablePage(tx: Transaction, tenantId: string, id: string) {
  const campaign = await fundraiser(tx, tenantId, id);
  if (campaign.status === "archived") throw fail(409, "Fundraising.archived");
  const page = await pageOf(tx, tenantId, id);
  if (!page) throw fail(409, "GivePage.saveFirst");
  return page;
}

/** Starts an upload: records the file as pending and returns a signed slot for the bytes. The page must exist (saved once). */
export async function createGiveCoverUpload(db: Database, user: string, scope: Scope, raw: unknown, storage: Storage) {
  requireEnabled();
  const input = uploadInput.parse(raw), fundraisingId = uuidInput.parse(scope.fundraisingId);
  const file = await withTenant(db, user, uuidInput.parse(scope.tenantId), "fundraising:publish", async (tx, tenantId) => {
    await editablePage(tx, tenantId, fundraisingId);
    const id = randomUUID();
    const [row] = await tx.insert(fundraisingFiles).values({ id, tenantId, fundraisingId, uploaderId: user, key: `workspaces/${tenantId}/fundraising/${fundraisingId}/files/${id}`,
      kind: "cover", name: input.name, mime: input.mime as FileRow["mime"], size: input.size, checksum: input.checksum }).returning();
    return row;
  });
  return { file: summary(file), upload: await storage().presignUpload(file.key, { ...input, visibility: "private" }) };
}

/** Verifies the stored bytes, then scans them. Safe to repeat. A skipped scan releases an image outside production only. */
export async function confirmGiveCoverUpload(db: Database, user: string, scope: Scope, fileId: string, storage: Storage,
  scanner: FileScanner = noOpScanner, env: Record<string, string | undefined> = process.env) {
  requireEnabled();
  const fundraisingId = uuidInput.parse(scope.fundraisingId), id = uuidInput.parse(fileId), tenant = uuidInput.parse(scope.tenantId);
  const read = () => withTenant(db, user, tenant, "fundraising:publish", async (tx, tenantId) => fileOf(tx, tenantId, fundraisingId, id, user));
  const move = (status: FileRow["status"]) => withTenant(db, user, tenant, "fundraising:publish", async (tx, tenantId) => {
    await fileOf(tx, tenantId, fundraisingId, id, user);
    const [row] = await tx.update(fundraisingFiles).set({ status }).where(and(eq(fundraisingFiles.tenantId, tenantId), eq(fundraisingFiles.id, id))).returning();
    return row;
  });
  let file = await read();
  if (file.status === "pending") file = await move(await inspectCommunityUpload(storage(), file));
  if (file.status === "uploaded") {
    const verdict = await scanner.scan({ key: file.key, mime: file.mime, size: file.size, checksum: file.checksum });
    if (verdict !== "skipped" || env.NODE_ENV !== "production") file = await move(communityUploadReleased(verdict, env) ? "ready" : "quarantined");
  }
  return summary(file);
}

/** Chooses a ready file as the page's cover, or clears it. The page version must be current; the replaced file is retired. Audited. */
export async function setGiveCover(db: Database, user: string, scope: Scope, raw: unknown) {
  requireEnabled();
  const { fileId, version } = coverInput.parse(raw), fundraisingId = uuidInput.parse(scope.fundraisingId);
  return withTenant(db, user, uuidInput.parse(scope.tenantId), "fundraising:publish", async (tx, tenantId) => {
    const current = await editablePage(tx, tenantId, fundraisingId);
    if (current.version === version + 1 && current.coverFileId === fileId) return { coverFileId: current.coverFileId, version: current.version };
    if (current.version !== version) throw fail(409, "Fundraising.stale");
    if (current.coverFileId === fileId) return { coverFileId: current.coverFileId, version: current.version };
    if (fileId && (await fileOf(tx, tenantId, fundraisingId, fileId)).status !== "ready") throw missingFile();
    const [row] = await tx.update(fundraisingPages).set({ coverFileId: fileId, version: version + 1, updatedAt: new Date() })
      .where(and(eq(fundraisingPages.tenantId, tenantId), eq(fundraisingPages.fundraisingId, fundraisingId), eq(fundraisingPages.version, version)))
      .returning({ coverFileId: fundraisingPages.coverFileId, version: fundraisingPages.version });
    if (!row) throw fail(409, "Fundraising.stale");
    if (current.coverFileId) await tx.update(fundraisingFiles).set({ retiredAt: new Date() })
      .where(and(eq(fundraisingFiles.tenantId, tenantId), eq(fundraisingFiles.id, current.coverFileId), isNull(fundraisingFiles.retiredAt)));
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "fundraising.page.cover", targetId: fundraisingId, metadata: { version: String(row.version), fields: "cover" } });
    return row;
  });
}

/** A one-minute signed address for the page's cover (owner preview). */
export async function getGiveCoverUrl(db: Database, user: string, scope: Scope, storage: Storage) {
  requireEnabled();
  const fundraisingId = uuidInput.parse(scope.fundraisingId);
  const file = await withTenant(db, user, uuidInput.parse(scope.tenantId), "fundraising:publish", async (tx, tenantId) => {
    const page = await pageOf(tx, tenantId, fundraisingId);
    if (!page?.coverFileId) throw missingFile();
    const [row] = await tx.select().from(fundraisingFiles).where(and(eq(fundraisingFiles.tenantId, tenantId), eq(fundraisingFiles.id, page.coverFileId),
      eq(fundraisingFiles.status, "ready"), isNull(fundraisingFiles.retiredAt)));
    if (!row) throw missingFile();
    return row;
  });
  return { url: await storage().presignDownload(file.key, file.name, { inlineImage: file.mime }), expiresIn: 60 };
}

// ---- Public -------------------------------------------------------------------------------------------------------------------------------------------------
const slugProblem = (slug: string) => !giveSlugPattern.test(slug);

/** The page a visitor sees, or null (unknown, draft, closed, archived, hidden by staff, module off). */
export async function publicGivePage(db: Database, slug: string, env: Record<string, string | undefined> = process.env): Promise<GivePublicView | null> {
  if (!givePageEnabled(env) || slugProblem(slug)) return null;
  const { rows: [row] } = await db.execute<{ result: unknown }>(sql`select public.give_public_page(${slug}) as result`);
  return row?.result ? parseGivePublicView(row.result) : null;
}
/** The ministry's enabled giving methods for a public page, or [] (not public, none enabled, staff hid them, module off). */
export async function publicGiveMethods(db: Database, slug: string, env: Record<string, string | undefined> = process.env): Promise<GivingPublicMethod[]> {
  if (!givePageEnabled(env) || slugProblem(slug)) return [];
  const { rows: [row] } = await db.execute<{ result: unknown }>(sql`select public.give_public_giving(${slug}) as result`);
  return publicGivingMethods(row?.result);
}
export async function publicGiveCover(db: Database, slug: string, env: Record<string, string | undefined> = process.env) {
  if (!givePageEnabled(env) || slugProblem(slug)) return null;
  const { rows: [row] } = await db.execute<{ result: { key: string; name: string; mime: "image/jpeg" | "image/png" | "image/webp" } | null }>(sql`select public.give_public_cover(${slug}) as result`);
  return row?.result ?? null;
}

export type GiveReportOutcome = "ok" | "invalid" | "not_found" | "limited";
/** A visitor reports a public give page. No account; the hashed visitor key lives only in the one-minute counters. A filled honeypot is accepted and dropped. */
export async function submitGiveReport(db: Database, slug: string, raw: unknown, visitor: string, env: Record<string, string | undefined> = process.env): Promise<GiveReportOutcome> {
  if (!givePageEnabled(env)) return "not_found";
  const parsed = givingReportSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  if (parsed.data.website) return "ok";
  if (slugProblem(slug)) return "not_found";
  const { rows: [row] } = await db.execute<{ result: GiveReportOutcome }>(sql`select public.give_report_giving(${slug}, ${parsed.data.reason}, ${parsed.data.note ?? null}, ${visitor}) as result`);
  return row.result;
}
