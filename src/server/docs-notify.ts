import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { docNotifications, docs, users } from "../db/schema";
import { userLabel, id, requireDocsEnabled } from "./docs-access";
import { withTenant } from "./tenancy";

export type NotificationKind = "mention" | "reply" | "assigned" | "shared";
/** In-app notifications only: one row per person, never to the actor. Nothing is sent outside the app. */
export async function notify(tx: Transaction, tenantId: string, actor: string, recipients: readonly string[], kind: NotificationKind, docId: string, pageId: string | null, commentId: string | null) {
  const unique = [...new Set(recipients)].filter((r) => r !== actor);
  if (!unique.length) return;
  await tx.insert(docNotifications).values(unique.map((userId) => ({ tenantId, userId, kind, docId, pageId, commentId, actorId: actor })));
}
export type NotificationRow = { id: string; kind: NotificationKind; docId: string; docTitle: string; pageId: string | null; actorName: string; readAt: string | null; createdAt: string };
export async function listNotifications(db: Database, user: string, workspace: string): Promise<{ items: NotificationRow[]; unread: number }> {
  requireDocsEnabled();
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId) => {
    // A notification about a doc the person can no longer open is not shown (the join sees only readable docs).
    const rows = await tx.select({ n: docNotifications, title: docs.title, actor: userLabel }).from(docNotifications).innerJoin(docs, eq(docs.id, docNotifications.docId)).innerJoin(users, eq(users.id, docNotifications.actorId))
      .where(and(eq(docNotifications.tenantId, tenantId), eq(docNotifications.userId, user))).orderBy(desc(docNotifications.createdAt)).limit(30);
    return { unread: rows.filter((r) => !r.n.readAt).length, items: rows.map((r) => ({ id: r.n.id, kind: r.n.kind, docId: r.n.docId, docTitle: r.title, pageId: r.n.pageId, actorName: r.actor, readAt: r.n.readAt ? r.n.readAt.toISOString() : null, createdAt: r.n.createdAt.toISOString() })) };
  });
}
export async function markNotificationsRead(db: Database, user: string, workspace: string, raw: unknown) {
  requireDocsEnabled();
  const input = z.object({ ids: z.union([z.literal("all"), z.array(z.uuid()).max(50)]) }).strict().parse(raw);
  return withTenant(db, user, id(workspace), "docs:read", async (tx, tenantId) => {
    const where = and(eq(docNotifications.tenantId, tenantId), eq(docNotifications.userId, user), isNull(docNotifications.readAt), input.ids === "all" ? undefined : sql`${docNotifications.id} = any(${input.ids})`);
    await tx.update(docNotifications).set({ readAt: new Date() }).where(where);
    return { ok: true };
  });
}
