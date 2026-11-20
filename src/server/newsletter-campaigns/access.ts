import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { auditLogs, files, workspaces } from "../../db/schema";
import { message } from "../../i18n/messages";
import { publicFilePath } from "../../lib/files";
import { renderNewsletter, newsletterHttps, type NewsletterContent } from "../../lib/newsletter-content";
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
  const origin = newsletterHttps(process.env.HARVEST_NEWSLETTER_ORIGIN ?? "https://newsletter.example.test");
  if (!origin || new URL(origin).pathname !== "/" || new URL(origin).search || new URL(origin).hash) {
    throw conflict("ORIGIN_UNAVAILABLE");
  }
  return new URL(origin).origin;
}

export async function campaignPreview(tx: Transaction, tenant: string, content: NewsletterContent, preheader?: string | null) {
  const [ministry] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.tenantId, tenant));
  const images = new Map<string, string>();
  for (const block of content) {
    if (block.type !== "image" || images.has(block.fileId)) continue;
    const [file] = await tx.select({ id: files.id }).from(files).where(and(eq(files.tenantId, tenant),
      eq(files.id, block.fileId), eq(files.status, "ready"), eq(files.visibility, "public"), inArray(files.mime, ["image/jpeg", "image/png", "image/webp"]))).for("share");
    if (!file) throw unavailable();
    images.set(block.fileId, new URL(publicFilePath(tenant, block.fileId), newsletterOrigin()).href);
  }
  return renderNewsletter(content, { preheader, ministryName: ministry?.name, unsubscribe: previewUnsubscribe, images });
}
