import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { communityUploadInput } from "../lib/forum";
import { communityUploadReleased } from "./community-files";
import { inspectCommunityUpload } from "./files/community-upload-verification";
import { noOpScanner, type FileScanner } from "./files/scanner";
import { requireLinkInBioEnabled } from "./link-in-bio";
import { AccessError } from "./permissions";
import type { ImageMime, StorageAdapter } from "./storage/adapter";
import { withUser } from "./tenancy";

// The profile photo goes through the same private upload, verification and scan path as an event cover (events-covers.ts); only the database function differs.
const uuid = z.uuid();
const uploadInput = communityUploadInput.refine((input) => input.kind === "cover");
const photoInput = z.object({ fileId: uuid.nullable(), version: z.number().int().min(1).max(2147483646) }).strict();
type Storage = () => StorageAdapter;
type FileMeta = { id: string; key: string; checksum: string; name: string; mime: ImageMime; size: number; status: "pending" | "uploaded" | "quarantined" | "ready"; kind: "photo" | "cover" | "gallery" };
/** `gallery` pictures are listed by a gallery block, never set on the page. */
export type BioImageKind = "photo" | "cover" | "gallery";
type Action = "serve" | "create" | "inspect" | "status" | "set";
type Result<T> = { outcome: "ok"; data: T } | { outcome: "not_found" | "conflict" | "invalid" };

const missing = () => new AccessError(404, message("Errors.fileNotFound"));
const summary = ({ id, name, mime, size, status }: FileMeta) => ({ id, name, mime, size, status, kind: "cover" as const });

async function operate<T>(db: Database, user: string, tenantId: string, action: Action, file: string | null, input: object = {}, kind: BioImageKind = "photo") {
  requireLinkInBioEnabled();
  const tenant = uuid.safeParse(tenantId);
  if (!tenant.success || (file !== null && !uuid.safeParse(file).success)) throw missing();
  const { outcome, ...result } = await withUser(db, user, async (tx) => (await tx.execute<{ result: Result<T> }>(sql`
    select public.bio_photo_operate(${tenant.data}::uuid, ${action}, ${file}::uuid, ${JSON.stringify({ ...input, kind })}::jsonb) as result`)).rows[0].result);
  if (outcome === "ok" && "data" in result) return result.data;
  if (outcome === "conflict") throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
  if (outcome === "invalid") throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
  throw missing();
}

export async function createBioPhotoUpload(db: Database, user: string, tenantId: string, raw: unknown, storage: Storage, kind: BioImageKind = "photo") {
  const input = uploadInput.parse(raw);
  const file = await operate<FileMeta>(db, user, tenantId, "create", randomUUID(), input, kind);
  const upload = await storage().presignUpload(file.key, { ...input, visibility: "private" });
  return { file: summary(file), upload };
}

export async function confirmBioPhotoUpload(db: Database, user: string, tenantId: string, id: string, storage: Storage, kind: BioImageKind = "photo", scanner: FileScanner = noOpScanner, env: Record<string, string | undefined> = process.env) {
  let file = await operate<FileMeta>(db, user, tenantId, "inspect", id, {}, kind);
  const setStatus = (status: FileMeta["status"]) => operate<FileMeta>(db, user, tenantId, "status", id, { status }, kind);
  if (file.status === "pending") file = await setStatus(await inspectCommunityUpload(storage(), file));
  if (file.status === "uploaded") {
    const verdict = await scanner.scan({ key: file.key, mime: file.mime, size: file.size, checksum: file.checksum });
    // A skipped scan releases an image outside production only; in production it stays unavailable and can be scanned again.
    if (verdict !== "skipped" || env.NODE_ENV !== "production") file = await setStatus(communityUploadReleased(verdict, env) ? "ready" : "quarantined");
  }
  return summary(file);
}

export async function setBioPhoto(db: Database, user: string, tenantId: string, raw: unknown, kind: BioImageKind = "photo") {
  const { fileId, version } = photoInput.parse(raw);
  const result = await operate<{ photoFileId: string | null; version: number }>(db, user, tenantId, "set", fileId, { version }, kind);
  return { coverFileId: result.photoFileId, version: result.version };
}

export async function getBioPhotoUrl(db: Database, user: string, tenantId: string, storage: Storage, kind: BioImageKind = "photo") {
  const file = await operate<Pick<FileMeta, "key" | "name" | "mime">>(db, user, tenantId, "serve", null, {}, kind);
  return { url: await storage().presignDownload(file.key, file.name, { inlineImage: file.mime }), expiresIn: 60 };
}

/** The owner's preview of one gallery picture of the page (ready and not retired), as a one-minute signed address. */
export async function getBioGalleryUrl(db: Database, user: string, tenantId: string, fileId: string, storage: Storage) {
  const file = await operate<Pick<FileMeta, "key" | "name" | "mime">>(db, user, tenantId, "serve", fileId, {}, "gallery");
  return { url: await storage().presignDownload(file.key, file.name, { inlineImage: file.mime }), expiresIn: 60 };
}
