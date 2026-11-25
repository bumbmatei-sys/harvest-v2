import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Transaction } from "../db/client";
import { auditLogs, docPageShares, docShares, docs, users } from "../db/schema";
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
export async function loadDoc(tx: Transaction, tenantId: string, docId: string, user: string, role: string, lock = false, trashed = false, page?: string | "any") {
  const [row] = await tx.select().from(docs).where(and(eq(docs.tenantId, tenantId), eq(docs.id, docId), trashed ? isNotNull(docs.deletedAt) : isNull(docs.deletedAt)));
  if (!row) throw gone();
  const [share] = await tx.select({ role: docShares.role }).from(docShares).where(and(eq(docShares.docId, row.id), eq(docShares.userId, user)));
  let rights: DocRights = docRights(role, row.ownerId, user, { visibility: row.visibility, ministryAccess: row.ministryAccess, share: share?.role ?? null });
  let pageRoles: Record<string, "view" | "comment" | "edit"> | null = null;
  if (!rights.read) {
    // A person with a page share (and nothing else) sees only the shared page. Everything that does not name a page still answers "not available".
    if (page === undefined) throw gone();
    const shares = await tx.select({ pageId: docPageShares.pageId, role: docPageShares.role }).from(docPageShares).where(and(eq(docPageShares.docId, row.id), eq(docPageShares.userId, user), page === "any" ? undefined : eq(docPageShares.pageId, page)));
    if (!shares.length) throw gone();
    pageRoles = Object.fromEntries(shares.map((x) => [x.pageId, x.role]));
    const best = shares.find((x) => x.role === "edit") ?? shares.find((x) => x.role === "comment") ?? shares[0];
    rights = { manage: false, write: page !== "any" && best.role === "edit", comment: page !== "any" && best.role !== "view", read: true, pageOnly: true };
  }
  if (lock && rights.write && !rights.pageOnly) await tx.select({ id: docs.id }).from(docs).where(and(eq(docs.tenantId, tenantId), eq(docs.id, docId))).for("update");
  return { row, rights, pageRoles };
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
