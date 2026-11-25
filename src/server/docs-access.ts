import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Transaction } from "../db/client";
import { auditLogs, docShares, docs, users } from "../db/schema";
import { docRights, type DocRights } from "../lib/docs";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";

// Shared by every Docs server module: errors, the audit helper and the one place that decides what the caller may do with a doc.
export const gone = () => new AccessError(404, message("Errors.docNotFound"));
export const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
export const denied = () => new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
export const bad = (key: Parameters<typeof message>[0]) => new AccessError(400, message(key));
export const id = (value: string) => z.uuid().parse(value);
export const audit = (tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, metadata: Record<string, string | number> = {}) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata: Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)])) });

/**
 * Loads a doc and what the caller may do with it (`docRights`: the same rule as the database policies). A doc the caller may not read is not returned by the database,
 * so it answers "not available". The row lock is taken only by someone who may change the doc (a row the update policy hides cannot be locked).
 */
export async function loadDoc(tx: Transaction, tenantId: string, docId: string, user: string, role: string, lock = false, trashed = false) {
  const [row] = await tx.select().from(docs).where(and(eq(docs.tenantId, tenantId), eq(docs.id, docId), trashed ? isNotNull(docs.deletedAt) : isNull(docs.deletedAt)));
  if (!row) throw gone();
  const [share] = await tx.select({ role: docShares.role }).from(docShares).where(and(eq(docShares.docId, row.id), eq(docShares.userId, user)));
  const rights = docRights(role, row.ownerId, user, { visibility: row.visibility, ministryAccess: row.ministryAccess, share: share?.role ?? null });
  if (lock && rights.write) await tx.select({ id: docs.id }).from(docs).where(and(eq(docs.tenantId, tenantId), eq(docs.id, docId))).for("update");
  return { row, rights };
}
export const needWrite = (rights: DocRights) => { if (!rights.write) throw denied(); };
export const needManage = (rights: DocRights) => { if (!rights.manage) throw denied(); };
export const needComment = (rights: DocRights) => { if (!rights.comment) throw denied(); };
export const sqlNow = sql`now()`;

/** Docs are a development-only module until activated: never in production (same gate as the newsletter and the Office screens). */
export function docsEnabled(env: Record<string, string | undefined> = process.env) { return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production"; }
export function requireDocsEnabled() { if (!docsEnabled()) throw new AccessError(404, message("Errors.thisViewIsNotAvailable")); }


/** People who signed in with a code may have no name yet: the start of the email before the @ stands in (never a long id). */
export const userLabel = sql<string>`coalesce(nullif(btrim(${users.name}),''), left(split_part(${users.email},'@',1), 24))`;
/** The public link is part of the plan but hard-off: never in production, and in development only with the synthetic switch. */
export function docsPublicLinksEnabled(env: Record<string, string | undefined> = process.env) { return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && env.HARVEST_DOCS_PUBLIC === "synthetic"; }
