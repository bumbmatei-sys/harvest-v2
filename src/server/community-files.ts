import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { communityFiles } from "../db/schema";
import { communityFileKey, communityUploadInput } from "../lib/forum";
import { message } from "../i18n/messages";
import { communitySlug } from "./communities";
import { forumContext } from "./community-forum";
import { AccessError } from "./permissions";
import { InvalidStoredFile, type StorageAdapter } from "./storage/adapter";
import { noOpScanner, type FileScanner } from "./files/scanner";
import { withUser } from "./tenancy";

// PR 4b: member uploads (post covers and attachments). Same verification path as ministry files (presigned PUT,
// byte inspection, scanner), but readable by the whole community, so a file is released ONLY on a clean scan.
// Outside production a skipped scan also releases it, so the feature can be developed; production stays closed
// until a real malware scanner is wired (activation gate).
export function communityUploadReleased(verdict: "clean" | "infected" | "skipped", env: Record<string, string | undefined> = process.env) {
  return verdict === "clean" || (verdict === "skipped" && env.NODE_ENV !== "production");
}

type Outcome = { outcome: string; id: string | null };
const unavailable = () => new AccessError(404, message("Errors.uploadNotAvailable"));

export async function createCommunityUpload(db: Database, storage: StorageAdapter, userId: string, slug: string, raw: unknown) {
  const input = communityUploadInput.parse(raw), parsed = communitySlug.parse(slug), id = randomUUID();
  const result = await withUser(db, userId, async (tx) => (await tx.execute<{ v: Outcome }>(sql`select public.community_file_create(${parsed}, ${id}::uuid, ${input.kind},
    ${input.name}, ${input.mime}, ${input.size}, ${input.checksum}) as v`)).rows[0].v);
  if (result.outcome !== "ok") throw new AccessError(404, message("Errors.communityNotFound"));
  const [file] = await withUser(db, userId, (tx) => tx.select().from(communityFiles).where(eq(communityFiles.id, id)));
  const upload = await storage.presignUpload(communityFileKey(file.tenantId, file.communityId, id), { name: input.name, mime: input.mime, size: input.size, checksum: input.checksum, visibility: "private" });
  return { file: { id, name: file.name, mime: file.mime, size: file.size, status: file.status, kind: file.kind }, upload };
}

const setStatus = (db: Database, userId: string, slug: string, id: string, status: string) =>
  withUser(db, userId, async (tx) => (await tx.execute<{ v: Outcome }>(sql`select public.community_file_set_status(${slug}, ${id}::uuid, ${status}) as v`)).rows[0].v);

/** Verify the uploaded bytes, then scan. Only the uploader confirms; only forward transitions are possible. */
export async function confirmCommunityUpload(db: Database, storage: StorageAdapter, userId: string, slug: string, fileId: string, scanner: FileScanner = noOpScanner) {
  const parsed = communitySlug.parse(slug), id = z.uuid().parse(fileId);
  const read = async () => (await withUser(db, userId, (tx) => tx.select().from(communityFiles).where(and(eq(communityFiles.id, id), eq(communityFiles.uploaderId, userId)))))[0];
  let file = await read();
  if (!file) throw unavailable();
  if (file.status === "pending") {
    let next: "uploaded" | "quarantined" = "uploaded";
    try {
      const actual = await storage.inspect(file.key, file);
      if (actual.size !== file.size || actual.mime !== file.mime || actual.checksum !== file.checksum) throw new InvalidStoredFile(message("Errors.uploadVerificationFailed"));
    } catch (error) {
      if (!(error instanceof InvalidStoredFile)) throw new AccessError(409, message("Errors.uploadIsUnavailableFinishUploadingAndRetryConfirmation"));
      next = "quarantined";
    }
    await setStatus(db, userId, parsed, id, next);
    file = await read();
  }
  if (file.status === "uploaded") {
    const verdict = await scanner.scan({ key: file.key, size: file.size, mime: file.mime, checksum: file.checksum });
    await setStatus(db, userId, parsed, id, communityUploadReleased(verdict) ? "ready" : "quarantined");
    file = await read();
  }
  return { id: file.id, name: file.name, mime: file.mime, size: file.size, status: file.status, kind: file.kind };
}

/** A short-lived download URL for a ready file, for readers of the community only. */
export async function communityFileUrl(db: Database, storage: StorageAdapter, userId: string, slug: string, fileId: string) {
  const ctx = await forumContext(db, userId, slug), id = z.uuid().safeParse(fileId);
  if (!ctx || !id.success) throw unavailable();
  const [file] = await withUser(db, userId, (tx) => tx.select().from(communityFiles)
    .where(and(eq(communityFiles.id, id.data), eq(communityFiles.communityId, ctx.id), eq(communityFiles.status, "ready"))));
  if (!file) throw unavailable();
  return storage.presignDownload(file.key, file.name);
}
