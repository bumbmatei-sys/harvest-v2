import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, campaignDrafts, campaignFiles, campaigns } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { communityUploadInput } from "../lib/forum";
import { message } from "../i18n/messages";
import { communityUploadReleased } from "./community-files";
import { inspectCommunityUpload } from "./files/community-upload-verification";
import { noOpScanner, type FileScanner } from "./files/scanner";
import { AccessError } from "./permissions";
import type { StorageAdapter } from "./storage/adapter";
import { withTenant } from "./tenancy";

// The optional cover image or logo of a wizard draft (founder 25 Nov, Q3). The same scanned-upload steps as event covers: a signed slot, the bytes straight
// to storage, then the server verifies and scans, and only a ready file can be chosen. Nothing here publishes or sends anything.
type Storage = () => StorageAdapter;
type FileRow = typeof campaignFiles.$inferSelect;
const uploadInput = communityUploadInput.refine((input) => input.kind === "cover");
const coverInput = z.object({ fileId: z.uuid().nullable(), version: z.number().int().min(1).max(2147483646) }).strict();
const missing = () => new AccessError(404, message("Errors.fileNotFound"));
const summary = ({ id, name, mime, size, status, kind }: FileRow) => ({ id, name, mime, size, status, kind });

async function openDraft(tx: Transaction, tenantId: string, id: string) {
  const [draft] = await tx.select({ id: campaignDrafts.id, status: campaignDrafts.status, version: campaignDrafts.version, coverFileId: campaignDrafts.coverFileId })
    .from(campaignDrafts).where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.id, id)));
  if (!draft) throw new AccessError(404, message("Campaigns.draftNotFound"));
  if (draft.status !== "draft") throw new AccessError(409, message("Campaigns.draftClosed"));
  return draft;
}
const fileOf = async (tx: Transaction, tenantId: string, draftId: string, id: string, uploader?: string) => {
  const [file] = await tx.select().from(campaignFiles).where(and(eq(campaignFiles.tenantId, tenantId), eq(campaignFiles.draftId, draftId), eq(campaignFiles.id, id),
    isNull(campaignFiles.retiredAt), ...(uploader ? [eq(campaignFiles.uploaderId, uploader)] : [])));
  if (!file) throw missing();
  return file;
};

/** Starts an upload: records the file as pending and returns a signed slot for the bytes. */
export async function createDraftCoverUpload(db: Database, user: string, scope: { tenantId: string; draftId: string }, raw: unknown, storage: Storage) {
  const input = uploadInput.parse(raw), draftId = uuidInput.parse(scope.draftId);
  const file = await withTenant(db, user, uuidInput.parse(scope.tenantId), "campaigns:write", async (tx, tenantId) => {
    await openDraft(tx, tenantId, draftId);
    const id = randomUUID();
    const [row] = await tx.insert(campaignFiles).values({ id, tenantId, draftId, uploaderId: user, key: `workspaces/${tenantId}/campaign-drafts/${draftId}/files/${id}`,
      kind: "cover", name: input.name, mime: input.mime as FileRow["mime"], size: input.size, checksum: input.checksum }).returning();
    return row;
  });
  return { file: summary(file), upload: await storage().presignUpload(file.key, { ...input, visibility: "private" }) };
}

/** Verifies the stored bytes, then scans them. Safe to repeat: a file still waiting for its scan stays "uploaded". */
export async function confirmDraftCoverUpload(db: Database, user: string, scope: { tenantId: string; draftId: string }, fileId: string, storage: Storage,
  scanner: FileScanner = noOpScanner, env: Record<string, string | undefined> = process.env) {
  const draftId = uuidInput.parse(scope.draftId), id = uuidInput.parse(fileId), tenant = uuidInput.parse(scope.tenantId);
  const read = () => withTenant(db, user, tenant, "campaigns:write", async (tx, tenantId) => fileOf(tx, tenantId, draftId, id, user));
  const move = (status: FileRow["status"]) => withTenant(db, user, tenant, "campaigns:write", async (tx, tenantId) => {
    await fileOf(tx, tenantId, draftId, id, user);
    const [row] = await tx.update(campaignFiles).set({ status }).where(and(eq(campaignFiles.tenantId, tenantId), eq(campaignFiles.id, id))).returning();
    return row;
  });
  let file = await read();
  if (file.status === "pending") file = await move(await inspectCommunityUpload(storage(), file));
  if (file.status === "uploaded") {
    const verdict = await scanner.scan({ key: file.key, mime: file.mime, size: file.size, checksum: file.checksum });
    // A skipped scan releases an image outside production only; in production it stays unavailable and can be checked again.
    if (verdict !== "skipped" || env.NODE_ENV !== "production") file = await move(communityUploadReleased(verdict, env) ? "ready" : "quarantined");
  }
  return summary(file);
}

/** Chooses a ready file as the draft's cover, or clears it. The draft version must be current; the replaced file is retired. */
export async function setDraftCover(db: Database, user: string, scope: { tenantId: string; draftId: string }, raw: unknown) {
  const { fileId, version } = coverInput.parse(raw), draftId = uuidInput.parse(scope.draftId);
  return withTenant(db, user, uuidInput.parse(scope.tenantId), "campaigns:write", async (tx, tenantId) => {
    const current = await openDraft(tx, tenantId, draftId);
    // A retry of a change that already went through returns the same answer.
    if (current.version === version + 1 && current.coverFileId === fileId) return { coverFileId: current.coverFileId, version: current.version };
    if (current.version !== version) throw new AccessError(409, message("Campaigns.draftChanged"), { reason: "stale" });
    if (current.coverFileId === fileId) return { coverFileId: current.coverFileId, version: current.version };
    if (fileId) {
      const file = await fileOf(tx, tenantId, draftId, fileId);
      if (file.status !== "ready") throw missing();
    }
    const [row] = await tx.update(campaignDrafts).set({ coverFileId: fileId, version: version + 1, updatedAt: new Date() })
      .where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.id, draftId), eq(campaignDrafts.version, version), eq(campaignDrafts.status, "draft")))
      .returning({ coverFileId: campaignDrafts.coverFileId, version: campaignDrafts.version });
    if (!row) throw new AccessError(409, message("Campaigns.draftChanged"), { reason: "stale" });
    if (current.coverFileId) await tx.update(campaignFiles).set({ retiredAt: new Date() })
      .where(and(eq(campaignFiles.tenantId, tenantId), eq(campaignFiles.id, current.coverFileId), isNull(campaignFiles.retiredAt)));
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "campaign.draft.cover", targetId: draftId, metadata: { version: String(row.version) } });
    return row;
  });
}

const download = async (storage: Storage, file: Pick<FileRow, "key" | "name" | "mime">) =>
  ({ url: await storage().presignDownload(file.key, file.name, { inlineImage: file.mime }), expiresIn: 60 });

/** A short-lived signed address for the draft's cover, for anyone who can read the draft. */
export async function getDraftCoverUrl(db: Database, user: string, scope: { tenantId: string; draftId: string }, storage: Storage) {
  const draftId = uuidInput.parse(scope.draftId);
  const file = await withTenant(db, user, uuidInput.parse(scope.tenantId), "campaigns:read", async (tx, tenantId) => {
    const [draft] = await tx.select({ coverFileId: campaignDrafts.coverFileId }).from(campaignDrafts).where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.id, draftId)));
    if (!draft?.coverFileId) throw missing();
    const [row] = await tx.select().from(campaignFiles).where(and(eq(campaignFiles.tenantId, tenantId), eq(campaignFiles.id, draft.coverFileId), eq(campaignFiles.status, "ready"), isNull(campaignFiles.retiredAt)));
    if (!row) throw missing();
    return row;
  });
  return download(storage, file);
}

/** A short-lived signed address for a campaign's cover, for anyone who can read the campaign. */
export async function getCampaignCoverUrl(db: Database, user: string, scope: { tenantId: string; campaignId: string }, storage: Storage) {
  const id = uuidInput.parse(scope.campaignId);
  const file = await withTenant(db, user, uuidInput.parse(scope.tenantId), "campaigns:read", async (tx, tenantId) => {
    const [campaign] = await tx.select({ coverFileId: campaigns.coverFileId }).from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, id), isNull(campaigns.archivedAt)));
    if (!campaign?.coverFileId) throw missing();
    const [row] = await tx.select().from(campaignFiles).where(and(eq(campaignFiles.tenantId, tenantId), eq(campaignFiles.id, campaign.coverFileId), eq(campaignFiles.status, "ready")));
    if (!row) throw missing();
    return row;
  });
  return download(storage, file);
}
