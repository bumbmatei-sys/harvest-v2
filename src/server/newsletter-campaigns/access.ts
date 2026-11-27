import { newsletterFileLink, newsletterOrigin as siteNewsletterOrigin } from "../../lib/site-address";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { auditLogs, files, newsletterSettings, workspaces } from "../../db/schema";
import { message } from "../../i18n/messages";
import { newsletterImageMimes } from "../../lib/email/image-limits";
import { documentFileIds, isEmailDocument, type EmailDocument } from "../../lib/email/blocks";
import { renderNewsletter, type NewsletterContent } from "../../lib/newsletter-content";
import type { Permission } from "../../lib/permissions";
import { requireNewsletterEnabled } from "../newsletter";
import { AccessError } from "../permissions";
import { withTenant } from "../tenancy";

export const unavailable = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));
export const conflict = (code: string) => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { code });
export const version = z.number().int().positive().max(2_147_483_646);
export const pageInput = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), after: z.uuid().optional() }).strict();

export function id(value: string) {
  if (!z.uuid().safeParse(value).success) throw unavailable();
  return value;
}

export async function withNewsletter<T>(db: Database, actor: string, workspace: string, permission: Permission,
  run: (tx: Transaction, tenantId: string) => Promise<T>) {
  requireNewsletterEnabled();
  try {
    return await withTenant(db, actor, id(workspace), permission, run);
  } catch (error) {
    if (error instanceof AccessError && error.status === 403) throw unavailable();
    throw error;
  }
}

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function audit(tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, version: number) {
  await tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata: { version: String(version) } });
}

export const previewUnsubscribe = "https://newsletter.example.test/api/newsletter/unsubscribe";

export function newsletterOrigin() {
  try { return siteNewsletterOrigin(); } catch { throw conflict("ORIGIN_UNAVAILABLE"); }
}

/** Public addresses for the uploaded images a document uses. Throws unless every one is a ready, public image of this ministry (so nothing unscanned is ever rendered). */
export async function documentImages(tx: Transaction, tenant: string, doc: Pick<EmailDocument, "cover" | "blocks">) {
  const ids = documentFileIds(doc), map = new Map<string, string>();
  if (!ids.length) return map;
  const rows = await tx.select({ id: files.id }).from(files).where(and(eq(files.tenantId, tenant), inArray(files.id, ids), eq(files.status, "ready"),
    eq(files.visibility, "public"), eq(files.socialUpload, false), inArray(files.mime, [...newsletterImageMimes]))).for("share");
  if (rows.length !== ids.length) throw new AccessError(409, message("Errors.newsletterImageUnavailable"), { code: "IMAGE_UNAVAILABLE" });
  for (const { id } of rows) map.set(id, newsletterFileLink(tenant, id));
  return map;
}

/** The ministry counts link clicks now (the review preview then shows the footer line that sent emails will carry). */
export async function countsClicks(tx: Transaction, tenant: string) {
  const [row] = await tx.select({ on: newsletterSettings.clickTracking }).from(newsletterSettings).where(eq(newsletterSettings.tenantId, tenant));
  return row?.on ?? false;
}

export async function campaignPreview(tx: Transaction, tenant: string, content: NewsletterContent, preheader?: string | null, clicksCounted = false) {
  const [ministry] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.tenantId, tenant));
  let images = new Map<string, string>();
  if (isEmailDocument(content)) images = await documentImages(tx, tenant, content);
  else for (const block of Array.isArray(content) ? content : []) {
    if (block.type !== "image" || images.has(block.fileId)) continue;
    const [file] = await tx.select({ id: files.id }).from(files).where(and(eq(files.tenantId, tenant),
      eq(files.id, block.fileId), eq(files.status, "ready"), eq(files.visibility, "public"), inArray(files.mime, ["image/jpeg", "image/png", "image/webp"]))).for("share");
    if (!file) throw unavailable();
    images.set(block.fileId, newsletterFileLink(tenant, block.fileId));
  }
  return renderNewsletter(content, { preheader, ministryName: ministry?.name, unsubscribe: previewUnsubscribe, images, clicksCounted });
}
