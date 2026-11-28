import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, catalogItems, catalogLandings, catalogReviews, files, users } from "../db/schema";
import { landingBody, landingInput, landingLimits, saleProblem, type PublicLanding } from "../lib/catalog-landing";
import { message } from "../i18n/messages";
import { freeCatalogEnabled } from "./free-catalog-mode";
import { refreshDiscoverListing } from "./discover/refresh";
import { AccessError } from "./permissions";
import { withTenant, withUser } from "./tenancy";

// Product and course landing page: owner editing (owners and admins of the ministry, catalogue rights), the public read through the
// published-only definer, reviews by people who have the item, and hiding a review (audited). Checkout stays off: a price is shown only.
const uuid = z.uuid();
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/);
const notFound = () => new AccessError(404, message("Errors.catalogItemNotFound"));
const conflict = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
const invalid = (reason?: string) => new AccessError(400, message("Errors.checkTheSuppliedDetails"), reason ? { reason } : undefined);
const imageMimes = ["image/jpeg", "image/png", "image/webp"];

function ensureEnabled() { if (!freeCatalogEnabled()) throw notFound(); }
/** Owners and admins of the ministry with catalogue rights; anyone else, a foreign ministry or a foreign item is the same "not found". */
async function staff<T>(db: Database, user: string, tenant: string, run: (tx: Transaction, scope: string) => Promise<T>) {
  ensureEnabled();
  if (!uuid.safeParse(tenant).success) throw notFound();
  try { return await withTenant(db, user, tenant, "catalog:manage", (tx, scope) => run(tx, scope)); }
  catch (error) { if (error instanceof AccessError && error.status === 403) throw notFound(); throw error; }
}
async function ownItem(tx: Transaction, scope: string, id: string, lock = false) {
  if (!uuid.safeParse(id).success) throw notFound();
  const query = tx.select({ id: catalogItems.id, kind: catalogItems.kind, state: catalogItems.state }).from(catalogItems)
    .where(and(eq(catalogItems.tenantId, scope), eq(catalogItems.id, id)));
  const [item] = await (lock ? query.for("update") : query);
  if (!item) throw notFound();
  return item;
}

export type OwnerLanding = Omit<z.infer<typeof landingInput>, "version"> & { version: number };
export type OwnerReview = { userId: string; name: string; rating: number; body: string; hidden: boolean; updatedAt: string };

/** The item's landing as the owner edits it (defaults before the first save) and every review, hidden ones included. */
export function getLanding(db: Database, user: string, tenant: string, id: string) {
  return staff(db, user, tenant, async (tx, scope) => {
    await ownItem(tx, scope, id);
    const [row] = await tx.select().from(catalogLandings).where(and(eq(catalogLandings.tenantId, scope), eq(catalogLandings.itemId, id)));
    const landing: OwnerLanding = row ? {
      version: row.version, subtitle: row.subtitle, body: row.body ?? null, included: row.included, aboutHeading: row.aboutHeading, aboutBody: row.aboutBody,
      aboutPhotoId: row.aboutPhotoId, faq: row.faq, ctaQuote: row.ctaQuote, ctaLabel: row.ctaLabel,
      price: row.priceCents !== null && row.currency ? { cents: row.priceCents, currency: row.currency as "USD" } : null,
      sale: row.saleCents !== null && row.saleStartsAt && row.saleEndsAt ? { cents: row.saleCents, startsAt: row.saleStartsAt.toISOString(), endsAt: row.saleEndsAt.toISOString() } : null,
    } : { version: 0, subtitle: "", body: null, included: [], aboutHeading: "", aboutBody: "", aboutPhotoId: null, faq: [], ctaQuote: "", ctaLabel: "", price: null, sale: null };
    const reviews = await tx.select({ userId: catalogReviews.userId, name: users.name, rating: catalogReviews.rating, body: catalogReviews.body, hiddenAt: catalogReviews.hiddenAt,
      updatedAt: catalogReviews.updatedAt }).from(catalogReviews).innerJoin(users, eq(users.id, catalogReviews.userId))
      .where(and(eq(catalogReviews.tenantId, scope), eq(catalogReviews.itemId, id))).orderBy(desc(catalogReviews.updatedAt)).limit(200);
    return { landing, reviews: reviews.map((r): OwnerReview => ({ userId: r.userId, name: r.name.trim().split(/\s+/)[0] ?? "", rating: r.rating, body: r.body,
      hidden: r.hiddenAt !== null, updatedAt: r.updatedAt.toISOString() })) };
  });
}

/**
 * Saves the landing with the expected version (0 before the first save). The photo must be one of the ministry's ready private images; a sale needs a
 * price, a lower amount and an end after its start and in the future. A price changes the Discover listing to paid. Archived items are read-only.
 */
export function saveLanding(db: Database, user: string, tenant: string, id: string, raw: unknown, now = Date.now()) {
  return staff(db, user, tenant, async (tx, scope) => {
    const parsed = landingInput.safeParse(raw);
    if (!parsed.success) throw invalid();
    const input = parsed.data, problem = saleProblem(input, now);
    if (problem) throw invalid(`sale_${problem}`);
    const body = input.body === null ? null : landingBody(input.body);
    if (input.body !== null && !body) throw invalid("body");
    const item = await ownItem(tx, scope, id, true);
    if (item.state === "archived") throw conflict();
    if (input.aboutPhotoId) {
      const [photo] = await tx.select({ mime: files.mime, status: files.status, visibility: files.visibility }).from(files)
        .where(and(eq(files.tenantId, scope), eq(files.id, input.aboutPhotoId)));
      if (!photo || photo.visibility !== "private" || !imageMimes.includes(photo.mime)) throw invalid("photo");
    }
    const [current] = await tx.select({ version: catalogLandings.version }).from(catalogLandings)
      .where(and(eq(catalogLandings.tenantId, scope), eq(catalogLandings.itemId, id))).for("update");
    if ((current?.version ?? 0) !== input.version) throw conflict();
    const values = { subtitle: input.subtitle, body, included: input.included, aboutHeading: input.aboutHeading, aboutBody: input.aboutBody, aboutPhotoId: input.aboutPhotoId,
      faq: input.faq, ctaQuote: input.ctaQuote, ctaLabel: input.ctaLabel, priceCents: input.price?.cents ?? null, currency: input.price?.currency ?? null,
      saleCents: input.sale?.cents ?? null, saleStartsAt: input.sale ? new Date(input.sale.startsAt) : null, saleEndsAt: input.sale ? new Date(input.sale.endsAt) : null,
      version: input.version + 1, updatedAt: new Date() };
    if (current) await tx.update(catalogLandings).set(values).where(and(eq(catalogLandings.tenantId, scope), eq(catalogLandings.itemId, id)));
    else await tx.insert(catalogLandings).values({ ...values, tenantId: scope, itemId: id });
    await tx.insert(auditLogs).values({ tenantId: scope, actorId: user, action: "catalog.landing", targetId: id,
      metadata: { version: String(values.version), priced: input.price ? "yes" : "no", sale: input.sale ? "yes" : "no" } });
    await refreshDiscoverListing(tx, scope, item.kind === "course" ? "course" : "product", id);
    return { version: values.version };
  });
}

const hideInput = z.object({ hidden: z.boolean() }).strict();
/** Owners and admins hide or show one review. Audited with the reviewer as the target, never the review text. */
export function setReviewHidden(db: Database, user: string, tenant: string, id: string, reviewer: string, raw: unknown) {
  return staff(db, user, tenant, async (tx, scope) => {
    const { hidden } = hideInput.parse(raw);
    await ownItem(tx, scope, id);
    if (!reviewer || reviewer.length > 200) throw notFound();
    const updated = await tx.update(catalogReviews).set(hidden ? { hiddenAt: new Date(), hiddenBy: user } : { hiddenAt: null, hiddenBy: null })
      .where(and(eq(catalogReviews.tenantId, scope), eq(catalogReviews.itemId, id), eq(catalogReviews.userId, reviewer))).returning({ userId: catalogReviews.userId });
    if (!updated.length) throw notFound();
    await tx.insert(auditLogs).values({ tenantId: scope, actorId: user, action: hidden ? "catalog.review_hide" : "catalog.review_show", targetId: id, metadata: { reviewer } });
    return { hidden };
  });
}

/** The public landing of a published, visible item, or null. The caller's own review and eligibility come with it when signed in. */
export async function publicLanding(db: Database, slug: string, user?: string | null): Promise<PublicLanding | null> {
  ensureEnabled();
  if (!slugSchema.safeParse(slug).success) return null;
  const query = sql`select public.catalog_landing(${slug}) as data`;
  const result = user
    ? await withUser(db, user, (tx) => tx.execute<{ data: PublicLanding | null }>(query))
    : await db.transaction((tx) => tx.execute<{ data: PublicLanding | null }>(query));
  const data = result.rows[0]?.data ?? null;
  if (!data) return null;
  return { ...data, rating: { average: data.rating.average === null ? null : Number(data.rating.average), count: Number(data.rating.count) } };
}

const reviewInput = z.object({ rating: z.number().int().min(1).max(5), body: z.string().max(landingLimits.review) }).strict();
/** A signed-in person writes or edits their one review. Only someone who has the item (an active enrolment or grant) may. */
export async function saveReview(db: Database, user: string, slug: string, raw: unknown) {
  ensureEnabled();
  if (!slugSchema.safeParse(slug).success) throw notFound();
  const parsed = reviewInput.safeParse(raw);
  if (!parsed.success) throw invalid();
  const status = await withUser(db, user, async (tx) => (await tx.execute<{ s: string }>(
    sql`select public.catalog_review_save(${slug}, ${parsed.data.rating}, ${parsed.data.body}) as s`)).rows[0].s);
  if (status === "not_found") throw notFound();
  if (status === "invalid") throw invalid();
  if (status === "not_eligible") throw new AccessError(403, message("Errors.checkTheSuppliedDetails"), { reason: "not_eligible" });
  return { saved: true as const };
}

/** The about-the-creator photo of a public landing (storage key, name and type), or null. */
export async function landingPhoto(db: Database, slug: string) {
  ensureEnabled();
  if (!slugSchema.safeParse(slug).success) return null;
  const result = await db.transaction((tx) => tx.execute<{ data: { key: string; name: string; mime: "image/jpeg" | "image/png" | "image/webp" } | null }>(
    sql`select public.catalog_landing_photo(${slug}) as data`));
  return result.rows[0]?.data ?? null;
}

/** The owner's ready private images, for the photo picker. */
export function listLandingImages(db: Database, user: string, tenant: string) {
  return staff(db, user, tenant, (tx, scope) => tx.select({ id: files.id, name: files.name }).from(files)
    .where(and(eq(files.tenantId, scope), eq(files.visibility, "private"), eq(files.status, "ready"), inArray(files.mime, imageMimes))).orderBy(desc(files.createdAt)).limit(100));
}
