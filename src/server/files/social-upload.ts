import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { files, socialConnections } from "../../db/schema";
import { fileKey, MAX_FILE_SIZE } from "../../lib/files";
import { mediaKind, mediaRulesFor, socialMediaMimes, type MediaMetadata } from "../../lib/social/media";
import { draftTypes } from "../../lib/social/platforms";
import { socialUploadLimits } from "../../lib/social/upload-limits";
import { auditPublish, publishConflict, publishInvalid, recordId, unavailable, withPublish } from "../social/publish-access";
import { defaultSocialDeps } from "../social/registry";
import { InvalidStoredFile, type MultipartStorage, type StorageAdapter } from "../storage/adapter";
import { noOpScanner, type FileScanner, type ScanInput } from "./scanner";

const partSize = 32 * 1024 * 1024;
const grantSeconds = 300;
const uploadMaxAgeMs = socialUploadLimits.abandonedHours * 3_600_000;
const destination = z.object({
  connectionId: z.uuid(), type: z.enum(draftTypes), format: z.enum(["reel", "short"]).optional(),
  use: z.enum(["attachment", "cover", "subtitle"]).default("attachment"),
}).strict();
const uploadInput = z.object({
  name: z.string().trim().min(1).max(200).refine(name => !/[\x00-\x1f\x7f/\\]/.test(name) && name.isWellFormed()),
  mime: z.enum(socialMediaMimes), size: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  destinations: z.array(destination).min(1).max(50).optional(),
}).strict();
const confirmInput = z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1).max(8192),
  etag: z.string().regex(/^"?[a-f0-9]{32}(?:-\d+)?"?$/i) }).strict()).max(8192).optional() }).strict();
const metadataInput = z.object({
  width: z.number().int().positive().max(65536).optional(), height: z.number().int().positive().max(65536).optional(),
  durationMs: z.number().int().positive().max(86_400_000).optional(),
}).strict();
type StoredFile = typeof files.$inferSelect;
export type SocialUploadStorage = StorageAdapter & MultipartStorage;
type Inspector = (file: ScanInput & { name: string }) => Promise<{ checksum: string; mime: string; size: number; metadata: MediaMetadata }>;
type UploadDeps = {
  storage: SocialUploadStorage;
  inspectMedia?: Inspector;
  scanner?: FileScanner;
};
const present = ({ id, name, mime, size, status, mediaMetadata }: StoredFile) => ({ id, name, mime, size, status, mediaMetadata });

async function uploadUsage(tx: Transaction, tenantId: string) {
  const { rows: [row] } = await tx.execute<{ bytes: string; unfinished: number }>(sql`
    select coalesce(sum(size),0)::text as bytes,
      (count(*) filter (where status in ('pending','uploaded') and social_retired_at is null))::int as unfinished
    from public.files where tenant_id = ${tenantId}::uuid and social_upload`);
  const usedBytes = Number(row.bytes);
  return { usedBytes, unfinished: row.unfinished, limitBytes: socialUploadLimits.ministryBytes, fileLimitBytes: socialUploadLimits.fileBytes,
    unfinishedLimit: socialUploadLimits.unfinished,
    level: usedBytes >= socialUploadLimits.ministryBytes ? "limit" : usedBytes >= socialUploadLimits.ministryBytes * socialUploadLimits.warningFraction ? "warning" : "normal" };
}
export function getSocialUploadUsage(db: Database, user: string, workspace: string, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenantId) => ({ usage: await uploadUsage(tx, tenantId) }));
}

async function destinationLimits(tx: Transaction, tenantId: string, input: z.infer<typeof uploadInput>) {
  const destinations = input.destinations ?? [];
  if (!destinations.length) return [];
  const accountIds = [...new Set(destinations.map(item => item.connectionId))];
  const accounts = await tx.select({ id: socialConnections.id, platform: socialConnections.platform }).from(socialConnections)
    .where(and(eq(socialConnections.tenantId, tenantId), eq(socialConnections.status, "active"), inArray(socialConnections.id, accountIds))).for("share");
  if (accounts.length !== accountIds.length) throw unavailable();
  return destinations.map(item => {
    const { platform } = accounts.find(account => account.id === item.connectionId)!;
    const rules = mediaRulesFor(platform, item.type, item.format);
    const rule = item.use === "attachment" ? rules?.files[mediaKind(input.mime)] : item.use === "cover" ? rules?.cover : undefined;
    const supported = item.use === "subtitle" ? !!rules?.subtitles && ["application/x-subrip", "text/vtt"].includes(input.mime)
      : !!rule?.formats.some(format => format === input.mime);
    const maxBytes = supported ? Math.min(socialUploadLimits.fileBytes, rule?.maxBytes ?? rules!.subtitles!.maxBytes) : 0;
    return { ...item, platform, maxBytes, accepted: supported && input.size <= maxBytes,
      warning: !supported ? "MEDIA_TYPE_UNAVAILABLE" : input.size > maxBytes ? "MEDIA_TOO_LARGE" : null };
  });
}

export function createSocialUpload(db: Database, user: string, workspace: string, raw: unknown, deps = defaultSocialDeps()) {
  return withPublish(db, user, workspace, deps, async (tx, tenantId) => {
    const input = uploadInput.parse(raw);
    if (input.size > socialUploadLimits.fileBytes) throw publishInvalid("SOCIAL_UPLOAD_FILE_LIMIT", { maxBytes: socialUploadLimits.fileBytes });
    const limits = await destinationLimits(tx, tenantId, input);
    if (limits.length && !limits.some(limit => limit.accepted)) throw publishInvalid("SOCIAL_UPLOAD_NO_ACCEPTING_DESTINATION", { destinations: limits });
    // The SQL trigger takes the same lock so direct inserts and concurrent requests share the boundary.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('social-upload:' || ${tenantId}::text, 0))`);
    const usage = await uploadUsage(tx, tenantId);
    if (usage.unfinished >= usage.unfinishedLimit) throw publishInvalid("SOCIAL_UPLOAD_UNFINISHED_LIMIT", { usage });
    if (usage.usedBytes + input.size > usage.limitBytes) throw publishInvalid("SOCIAL_UPLOAD_MINISTRY_LIMIT", { usage });
    const id = randomUUID();
    const { name, mime, size, checksum } = input;
    const [file] = await tx.insert(files).values({ id, name, mime, size, checksum, key: fileKey(tenantId, id), tenantId, ownerId: user, socialUpload: true }).returning();
    await auditPublish(tx, tenantId, user, "social.media_create", id);
    return { file: present(file), destinations: limits, usage: await uploadUsage(tx, tenantId),
      upload: size > MAX_FILE_SIZE ? { kind: "multipart", partSize, partCount: Math.ceil(size / partSize) } : { kind: "single" } };
  });
}

function lookup(db: Database, user: string, workspace: string, id: string, deps: ReturnType<typeof defaultSocialDeps>) {
  return withPublish(db, user, workspace, deps, async (tx, tenantId) => {
    const [row] = await tx.select().from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, recordId(id)),
      eq(files.ownerId, user), eq(files.socialUpload, true), isNull(files.socialRetiredAt)));
    if (!row) throw unavailable();
    return row;
  });
}

export async function signSocialUpload(db: Database, user: string, workspace: string, id: string, raw: unknown, storage: SocialUploadStorage, deps = defaultSocialDeps()) {
  const request = z.object({ partNumber: z.number().int().min(1).max(8192).optional() }).strict().parse(raw);
  const file = await lookup(db, user, workspace, id, deps);
  if (file.createdAt.getTime() + uploadMaxAgeMs <= deps.now().getTime() + grantSeconds * 1000) throw publishConflict("SOCIAL_UPLOAD_EXPIRED");
  if (file.status !== "pending") throw publishConflict("UPLOAD_ALREADY_CONFIRMED");
  if (file.size <= MAX_FILE_SIZE) {
    if (request.partNumber !== undefined) throw publishInvalid("UNEXPECTED_UPLOAD_PART");
    return { upload: await storage.presignUpload(file.key, { mime: file.mime, size: file.size }) };
  }
  const partNumber = request.partNumber;
  if (!partNumber || partNumber > Math.ceil(file.size / partSize)) throw publishInvalid("INVALID_UPLOAD_PART");
  let uploadId = file.multipartId;
  if (!uploadId) {
    const proposed = await storage.startMultipart(file.key, file.mime);
    try {
      uploadId = await withPublish(db, user, workspace, deps, async (tx, tenantId) => {
        const key = and(eq(files.id, id), eq(files.tenantId, tenantId), eq(files.ownerId, user), eq(files.socialUpload, true), isNull(files.socialRetiredAt));
        const [locked] = await tx.select().from(files).where(key).for("update");
        if (!locked || locked.status !== "pending") throw publishConflict("UPLOAD_ALREADY_CONFIRMED");
        if (locked.multipartId) return locked.multipartId;
        await tx.update(files).set({ multipartId: proposed, updatedAt: sql`now()` }).where(key);
        return proposed;
      });
    } finally {
      if (uploadId !== proposed) await storage.abortMultipart(file.key, proposed).catch(() => undefined);
    }
  }
  return { upload: await storage.presignPart(file.key, uploadId, partNumber, Math.min(partSize, file.size - (partNumber - 1) * partSize)) };
}

export async function confirmSocialUpload(db: Database, user: string, workspace: string, id: string, raw: unknown, upload: UploadDeps, deps = defaultSocialDeps()) {
  const { parts } = confirmInput.parse(raw);
  const file = await withPublish(db, user, workspace, deps, async (tx, tenantId) => {
    const key = and(eq(files.tenantId, tenantId), eq(files.id, recordId(id)), eq(files.ownerId, user), eq(files.socialUpload, true), isNull(files.socialRetiredAt));
    const [row] = await tx.select().from(files).where(key).for("update");
    if (!row) throw unavailable();
    if (row.status === "ready" || row.status === "quarantined") return row;
    if (row.createdAt.getTime() + uploadMaxAgeMs <= deps.now().getTime()) throw publishConflict("SOCIAL_UPLOAD_EXPIRED");
    await tx.update(files).set({ socialConfirmUntil: sql`now() + interval '10 minutes'` }).where(key);
    return row;
  });
  if (file.status === "ready" || file.status === "quarantined") return { file: present(file) };
  if (file.size > MAX_FILE_SIZE && file.status === "pending") {
    if (!file.multipartId || parts?.length !== Math.ceil(file.size / partSize) || parts.some((part, i) => part.partNumber !== i + 1)) {
      throw publishInvalid("INVALID_UPLOAD_PARTS");
    }
    // Completion can succeed before its reply is lost. Inspection below still has to prove the immutable object.
    await upload.storage.completeMultipart(file.key, file.multipartId, parts).catch(() => undefined);
  } else if (parts?.length) {
    throw publishInvalid("UNEXPECTED_UPLOAD_PART");
  }
  const input = { key: file.key, name: file.name, mime: file.mime, size: file.size, checksum: file.checksum };
  const needsProbe = mediaKind(file.mime) !== "document" || !["application/pdf", "text/plain"].includes(file.mime) || file.size > MAX_FILE_SIZE;
  if (needsProbe && !upload.inspectMedia) throw publishConflict("MEDIA_INSPECTOR_UNAVAILABLE");
  let status: StoredFile["status"] = "uploaded";
  let metadata: MediaMetadata | null = null;
  try {
    const inspected = upload.inspectMedia ? await upload.inspectMedia(input) : { ...await upload.storage.inspect(file.key, file), metadata: {} };
    if (inspected.checksum !== file.checksum || inspected.size !== file.size || inspected.mime !== file.mime) throw new InvalidStoredFile("MEDIA_VERIFICATION_FAILED");
    metadata = metadataInput.parse(inspected.metadata);
    const kind = mediaKind(file.mime);
    if (kind !== "document" && (!metadata.width || !metadata.height || (kind === "video" && !metadata.durationMs))) {
      throw new InvalidStoredFile("MEDIA_METADATA_UNAVAILABLE");
    }
    const verdict = await (upload.scanner ?? noOpScanner).scan(input);
    if (verdict === "clean") status = "ready";
    if (verdict === "infected") status = "quarantined";
  } catch (error) {
    if (!(error instanceof InvalidStoredFile || error instanceof z.ZodError)) throw publishConflict("MEDIA_UPLOAD_NOT_AVAILABLE");
    status = "quarantined";
  }
  return withPublish(db, user, workspace, deps, async (tx, tenantId) => {
    const key = and(eq(files.tenantId, tenantId), eq(files.id, id), eq(files.ownerId, user), eq(files.socialUpload, true), isNull(files.socialRetiredAt));
    const [current] = await tx.select().from(files).where(key).for("update");
    if (!current) throw unavailable();
    if (current.status === "ready" || current.status === "quarantined") return { file: present(current) };
    const [updated] = await tx.update(files).set({ status, socialConfirmUntil: null, mediaMetadata: metadata, updatedAt: sql`now()` }).where(key).returning();
    await auditPublish(tx, tenantId, user, "social.media_confirm", id);
    return { file: present(updated) };
  });
}
