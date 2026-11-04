import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { files } from "../../db/schema";
import { fileKey, publicFilePath, uploadInput } from "../../lib/files";
import { AccessError } from "../permissions";
import { withTenant } from "../tenancy";
import { InvalidStoredFile, type StorageAdapter } from "../storage/adapter";
import { noOpScanner, type FileScanner } from "./scanner";

type StoredFile = typeof files.$inferSelect;
function present(file: StoredFile) {
  return { id: file.id, name: file.name, mime: file.mime, size: file.size, status: file.status,
    visibility: file.visibility, createdAt: file.createdAt,
    publicUrl: file.visibility === "public" && file.status === "ready" ? publicFilePath(file.tenantId, file.id) : null,
  };
}
function requireWriter(role: string) {
  if (!["owner", "admin", "member"].includes(role)) throw new AccessError(403, "Your role cannot upload files.");
}
export function listFiles(db: Database, userId: string, workspaceHint: string) {
  return withTenant(db, userId, z.uuid().parse(workspaceHint), "workspace:read", async (tx, tenantId) => {
    const rows = await tx.select().from(files).where(eq(files.tenantId, tenantId)).orderBy(desc(files.createdAt)).limit(100);
    return rows.map((file) => ({ ...present(file), canConfirm: file.ownerId === userId }));
  });
}
export function createUpload(db: Database, storage: StorageAdapter, userId: string, workspaceHint: string, raw: unknown) {
  const input = uploadInput.parse(raw);
  return withTenant(db, userId, z.uuid().parse(workspaceHint), "workspace:read", async (tx, tenantId, role) => {
    requireWriter(role);
    const id = randomUUID();
    const key = fileKey(tenantId, id);
    const [file] = await tx.insert(files).values({ ...input, id, key, tenantId, ownerId: userId }).returning();
    return { file: present(file), upload: await storage.presignUpload(key, input) };
  });
}
export async function confirmUpload(db: Database, storage: StorageAdapter, userId: string, workspaceHint: string, fileId: string, scanner: FileScanner = noOpScanner) {
  z.uuid().parse(workspaceHint); z.uuid().parse(fileId);
  // Persist verified receipt before processing. A failed scanner leaves an uploaded
  // row that confirmation can retry; the scanner seam can move to a durable job later.
  await withTenant(db, userId, workspaceHint, "workspace:read", async (tx, tenantId, role) => {
    requireWriter(role);
    const [file] = await tx.select().from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, fileId))).for("update");
    if (!file) throw new AccessError(404, "File not found.");
    if (file.ownerId !== userId) throw new AccessError(403, "Only the uploader can confirm this file.");
    if (file.status !== "pending") return;
    try {
      const actual = await storage.inspect(file.key, file.size);
      if (actual.size !== file.size || actual.mime !== file.mime || actual.checksum !== file.checksum) throw new InvalidStoredFile("Upload verification failed.");
    } catch (error) {
      if (!(error instanceof InvalidStoredFile)) throw new AccessError(409, "Upload is unavailable. Finish uploading and retry confirmation.");
      await tx.update(files).set({ status: "quarantined", updatedAt: new Date() }).where(eq(files.id, fileId));
      return;
    }
    await tx.update(files).set({ status: "uploaded", updatedAt: new Date() }).where(eq(files.id, fileId));
  });
  return withTenant(db, userId, workspaceHint, "workspace:read", async (tx, tenantId, role) => {
    requireWriter(role);
    const [file] = await tx.select().from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, fileId))).for("update");
    if (!file) throw new AccessError(404, "File not found.");
    if (file.ownerId !== userId) throw new AccessError(403, "Only the uploader can confirm this file.");
    if (file.status !== "uploaded") return present(file);
    const verdict = await scanner.scan({ key: file.key, size: file.size, mime: file.mime, checksum: file.checksum });
    const status = verdict === "clean" || (verdict === "skipped" && file.visibility === "private") ? "ready" : "quarantined";
    const [processed] = await tx.update(files).set({ status, updatedAt: new Date() }).where(eq(files.id, fileId)).returning();
    return present(processed);
  });
}
export function fileDownload(db: Database, storage: StorageAdapter, userId: string, workspaceHint: string, fileId: string) {
  z.uuid().parse(fileId);
  return withTenant(db, userId, z.uuid().parse(workspaceHint), "workspace:read", async (tx, tenantId) => {
    const [file] = await tx.select().from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, fileId)));
    if (!file) throw new AccessError(404, "File not found.");
    if (file.status !== "ready") throw new AccessError(409, "This file is not available for download.");
    if (file.visibility === "public") return { url: publicFilePath(tenantId, fileId), expiresIn: null };
    return { url: await storage.presignDownload(file.key, file.name), expiresIn: 60 };
  });
}
/** Deliberately anonymous: the RLS exception exposes only this one ready public file. */
export function publicDownload(db: Database, storage: StorageAdapter, workspaceHint: string, fileId: string) {
  z.uuid().parse(workspaceHint); z.uuid().parse(fileId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.public_file_id', ${fileId}, true), set_config('app.public_file_tenant_id', ${workspaceHint}, true)`);
    const [file] = await tx.select().from(files).where(and(eq(files.id, fileId), eq(files.tenantId, workspaceHint), eq(files.visibility, "public"), eq(files.status, "ready")));
    if (!file) throw new AccessError(404, "File not found.");
    return storage.presignDownload(file.key, file.name);
  });
}
