import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { communityUploadInput } from "../lib/forum";
import { eventsEnabled } from "./events";
import { inspectCommunityUpload } from "./files/community-upload-verification";
import { noOpScanner, type FileScanner } from "./files/scanner";
import { AccessError } from "./permissions";
import type { ImageMime, StorageAdapter } from "./storage/adapter";
import { withUser } from "./tenancy";

const uuid = z.uuid();
const uploadInput = communityUploadInput.refine(input => input.kind === "cover");
const coverInput = z.object({ fileId: uuid.nullable(), version: z.number().int().min(1).max(2147483646) }).strict();
type Storage = () => StorageAdapter;
type FileMeta = { id: string; key: string; checksum: string; name: string; mime: ImageMime; size: number;
  status: "pending" | "uploaded" | "quarantined" | "ready"; kind: "cover" };
type Scope = { tenantId: string; eventId: string };
type Action = "serve" | "create" | "inspect" | "status" | "set";
type Result<T> = { outcome: "ok"; data: T } | { outcome: "not_found" | "conflict" | "invalid" };

const missing = () => new AccessError(404, message("Errors.fileNotFound"));
const fileSummary = ({ id, name, mime, size, status, kind }: FileMeta) => ({ id, name, mime, size, status, kind });

async function eventCoverOperation<T>(db: Database, user: string, scope: Scope, action: Action, file: string | null, input: object = {}) {
  if (!eventsEnabled()) throw missing();
  const tenant = uuid.safeParse(scope.tenantId), event = uuid.safeParse(scope.eventId);
  if (!tenant.success || !event.success || (file !== null && !uuid.safeParse(file).success)) throw missing();
  const { outcome, ...result } = await withUser(db, user, async (tx) => (await tx.execute<{ result: Result<T> }>(sql`
    select public.events_cover_operate(${tenant.data}::uuid,${event.data}::uuid,${action},
      ${file}::uuid,${JSON.stringify(input)}::jsonb) as result`)).rows[0].result);
  if (outcome === "ok" && "data" in result) return result.data;
  if (outcome === "conflict") throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
  if (outcome === "invalid") throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
  throw missing();
}

export async function createEventCoverUpload(db: Database, user: string, scope: Scope, raw: unknown, storage: Storage) {
  const input = uploadInput.parse(raw);
  const file = await eventCoverOperation<FileMeta>(db, user, scope, "create", randomUUID(), input);
  const upload = await storage().presignUpload(file.key, { ...input, visibility: "private" });
  return { file: fileSummary(file), upload };
}

export async function confirmEventCoverUpload(db: Database, user: string, scope: Scope, id: string, storage: Storage, scanner: FileScanner = noOpScanner) {
  let file = await eventCoverOperation<FileMeta>(db, user, scope, "inspect", id);
  const setStatus = (status: FileMeta["status"]) => eventCoverOperation<FileMeta>(db, user, scope, "status", id, { status });
  if (file.status === "pending") file = await setStatus(await inspectCommunityUpload(storage(), file));
  if (file.status === "uploaded") {
    const verdict = await scanner.scan({ key: file.key, mime: file.mime, size: file.size, checksum: file.checksum });
    // The scanner port can skip in development. A skipped image stays unavailable and can be scanned again.
    if (verdict !== "skipped") file = await setStatus(verdict === "clean" ? "ready" : "quarantined");
  }
  return fileSummary(file);
}

export async function setEventCover(db: Database, user: string, scope: Scope, raw: unknown) {
  const { fileId, version } = coverInput.parse(raw);
  return eventCoverOperation<{ coverFileId: string | null; version: number }>(db, user, scope, "set", fileId, { version });
}

export async function getEventCoverUrl(db: Database, user: string, scope: Scope, storage: Storage) {
  const file = await eventCoverOperation<Pick<FileMeta, "key" | "name" | "mime">>(db, user, scope, "serve", null);
  return { url: await storage().presignDownload(file.key, file.name, { inlineImage: file.mime }), expiresIn: 60 };
}
