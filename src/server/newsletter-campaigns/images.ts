import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { files } from "../../db/schema";
import { message } from "../../i18n/messages";
import { newsletterImageInput, newsletterImageMimes } from "../../lib/email/image-limits";
import { youtubeThumbnailUrl, parseVideoLink } from "../../lib/email/video";
import { fileKey, publicFilePath } from "../../lib/files";
import { communityUploadReleased } from "../community-files";
import { inspectCommunityUpload } from "../files/community-upload-verification";
import { noOpScanner, type FileScanner } from "../files/scanner";
import { AccessError } from "../permissions";
import type { StorageAdapter } from "../storage/adapter";
import { audit, unavailable, withNewsletter } from "./access";

const mimes = [...newsletterImageMimes];
type Row = typeof files.$inferSelect;
const present = (file: Row) => ({ id: file.id, name: file.name, mime: file.mime, size: file.size, status: file.status, createdAt: file.createdAt,
  path: file.status === "ready" ? publicFilePath(file.tenantId, file.id) : null });

/**
 * Newsletter images are ordinary ministry files (public, not social) that only become usable once ready: a clean scan, or, outside
 * production only, a skipped scan (same rule as event covers and community uploads). Production stays closed until a real scanner exists.
 */
export async function listNewsletterImages(db: Database, actor: string, workspace: string) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const rows = await tx.select().from(files).where(and(eq(files.tenantId, tenant), eq(files.visibility, "public"), eq(files.socialUpload, false),
      eq(files.status, "ready"), inArray(files.mime, mimes))).orderBy(desc(files.createdAt)).limit(60);
    return { images: rows.map(present) };
  });
}

export async function createNewsletterImageUpload(db: Database, storage: StorageAdapter, actor: string, workspace: string, raw: unknown) {
  const input = newsletterImageInput.parse(raw);
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const id = randomUUID(), key = fileKey(tenant, id);
    const [file] = await tx.insert(files).values({ ...input, id, key, tenantId: tenant, ownerId: actor, visibility: "public" }).returning();
    await audit(tx, tenant, actor, "newsletter.image.upload", id, 1);
    return { file: present(file), upload: await storage.presignUpload(key, { ...input, visibility: "public" }) };
  });
}

/** Verify the stored bytes (size, type, checksum), then scan; only the uploader confirms. Safe to repeat. */
export async function confirmNewsletterImageUpload(db: Database, storage: StorageAdapter, actor: string, workspace: string, fileId: string,
  scanner: FileScanner = noOpScanner, env: Record<string, string | undefined> = process.env) {
  const id = z.uuid().safeParse(fileId);
  if (!id.success) throw unavailable();
  const own = (tx: Transaction, tenant: string) => tx.select().from(files).where(and(eq(files.tenantId, tenant), eq(files.id, id.data), eq(files.ownerId, actor),
    eq(files.visibility, "public"), eq(files.socialUpload, false), inArray(files.mime, mimes)));
  const setStatus = (status: "uploaded" | "quarantined" | "ready", from: Row["status"]) => withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const [row] = await tx.update(files).set({ status, updatedAt: new Date() }).where(and(eq(files.tenantId, tenant), eq(files.id, id.data), eq(files.ownerId, actor), eq(files.status, from))).returning();
    return row ?? (await own(tx, tenant))[0];
  });
  let file = await withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => (await own(tx, tenant))[0]);
  if (!file) throw unavailable();
  if (file.status === "pending") file = (await setStatus(await inspectCommunityUpload(storage, file), "pending")) ?? file;
  if (file.status === "uploaded") {
    const verdict = await scanner.scan({ key: file.key, mime: file.mime, size: file.size, checksum: file.checksum });
    if (verdict !== "skipped" || env.NODE_ENV !== "production") file = (await setStatus(communityUploadReleased(verdict, env) ? "ready" : "quarantined", "uploaded")) ?? file;
  }
  return present(file);
}

/** A thumbnail suggestion from a YouTube link: fetched server side from the fixed image host using only the parsed video id, stored and scanned like any upload. Non-production only. */
export function thumbnailSuggestionsEnabled(env: Record<string, string | undefined> = process.env) { return env.NODE_ENV !== "production"; }
export async function suggestVideoThumbnail(db: Database, storage: StorageAdapter, actor: string, workspace: string, raw: unknown,
  options: { fetcher?: typeof fetch; scanner?: FileScanner; env?: Record<string, string | undefined> } = {}) {
  const env = options.env ?? process.env, fetcher = options.fetcher ?? fetch;
  if (!thumbnailSuggestionsEnabled(env)) throw new AccessError(404, message("Errors.newsletterImageSuggestionUnavailable"));
  // Authorise (feature flag, role) before any outbound request.
  await withNewsletter(db, actor, workspace, "newsletter:campaigns", async () => undefined);
  const input = z.object({ videoUrl: z.string().max(2000) }).strict().parse(raw);
  const link = parseVideoLink(input.videoUrl);
  if (link?.kind !== "youtube") throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
  const response = await fetcher(youtubeThumbnailUrl(link.id), { redirect: "error", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok || response.headers.get("content-type")?.split(";")[0] !== "image/jpeg") throw new AccessError(409, message("Errors.newsletterImageSuggestionUnavailable"));
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > 5 * 1024 * 1024) throw new AccessError(409, message("Errors.newsletterImageSuggestionUnavailable"));
  const { createHash } = await import("node:crypto");
  const upload = await createNewsletterImageUpload(db, storage, actor, workspace,
    { name: `video-${link.id}.jpg`, mime: "image/jpeg", size: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") });
  const put = await fetcher(upload.upload.url, { method: upload.upload.method, headers: upload.upload.headers, body: bytes }).catch(() => null);
  if (!put?.ok) throw new AccessError(409, message("Errors.newsletterImageSuggestionUnavailable"));
  return confirmNewsletterImageUpload(db, storage, actor, workspace, upload.file.id, options.scanner, env);
}
