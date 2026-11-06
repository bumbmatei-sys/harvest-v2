import { message } from "../i18n/messages";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, crmSavedViews } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { fullState, objectTypes, systemViews, viewInput, viewPatch, viewState, type ObjectType, type ViewInput, type ViewPatch, type ViewState } from "../lib/crm-fields";
import { loadDefinitions, resolveState } from "./crm-filters";
import { AccessError, type Permission } from "./permissions";
import { withTenant } from "./tenancy";
import { z } from "zod";

export type SavedView = { id: string; name: string; objectType: ObjectType; kind: "system" | "workspace" | "personal"; state: ViewState; version: number; editable: boolean };
const writePermission = (objectType: ObjectType): Permission => (objectType === "person" ? "contacts:write" : "companies:write");
const readPermission = (objectType: ObjectType): Permission => (objectType === "person" ? "contacts:read" : "companies:read");
const missing = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
const systemReadOnly = () => new AccessError(403, message("Errors.systemViewsCannotBeChanged"));

function toView(row: typeof crmSavedViews.$inferSelect, writable: boolean): SavedView {
  const parsed = viewState.safeParse(row.state);
  return { id: row.id, name: row.name, objectType: row.objectType, kind: row.ownerUserId ? "personal" : "workspace", state: parsed.success ? parsed.data : fullState({}), version: row.version, editable: writable };
}
/** Visible rows: the workspace's shared views plus the caller's own personal views. */
function visibleRows(tx: Transaction, tenantId: string, userId: string, objectType: ObjectType) {
  return tx.select().from(crmSavedViews).where(and(eq(crmSavedViews.tenantId, tenantId), eq(crmSavedViews.objectType, objectType),
    or(isNull(crmSavedViews.ownerUserId), eq(crmSavedViews.ownerUserId, userId)))).orderBy(asc(crmSavedViews.name), asc(crmSavedViews.id));
}

export function listViews(db: Database, userId: string, workspace: string, objectType: ObjectType, role?: { writable: boolean }) {
  const type = z.enum(objectTypes).parse(objectType);
  return withTenant(db, userId, uuidInput.parse(workspace), readPermission(type), async (tx, tenantId) => {
    const writable = role?.writable ?? false;
    const rows = await visibleRows(tx, tenantId, userId, type);
    return [
      ...systemViews[type].map((view): SavedView => ({ id: view.id, name: view.name, objectType: type, kind: "system", state: fullState(view.state), version: 1, editable: false })),
      ...rows.map((row) => toView(row, writable)),
    ];
  });
}

/** Resolve a view id for the caller. Unknown, foreign or another user's personal view → null. */
export function findView(db: Database, userId: string, workspace: string, objectType: ObjectType, id: string) {
  const type = z.enum(objectTypes).parse(objectType);
  return withTenant(db, userId, uuidInput.parse(workspace), readPermission(type), async (tx, tenantId) => {
    const system = systemViews[type].find((view) => view.id === id);
    if (system) return { id: system.id, name: system.name, objectType: type, kind: "system", state: fullState(system.state), version: 1, editable: false } satisfies SavedView;
    if (!uuidInput.safeParse(id).success) return null;
    const [row] = await tx.select().from(crmSavedViews).where(and(eq(crmSavedViews.tenantId, tenantId), eq(crmSavedViews.id, id), eq(crmSavedViews.objectType, type),
      or(isNull(crmSavedViews.ownerUserId), eq(crmSavedViews.ownerUserId, userId))));
    return row ? toView(row, false) : null;
  });
}

/** Views are saved only by writers; the stored state must be valid for this tenant now. */
export function createView(db: Database, userId: string, workspace: string, data: ViewInput) {
  const input = viewInput.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), writePermission(input.objectType), async (tx, tenantId) => {
    resolveState(input.objectType, input.state, await loadDefinitions(tx, tenantId, input.objectType));
    const [row] = await tx.insert(crmSavedViews).values({ tenantId, objectType: input.objectType, name: input.name, ownerUserId: input.shared ? null : userId, state: input.state, createdBy: userId }).returning();
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.view_create", targetId: row.id, metadata: { objectType: row.objectType, shared: String(input.shared) } });
    return toView(row, true);
  });
}

async function lockOwned(tx: Transaction, tenantId: string, userId: string, id: string) {
  if (id.startsWith("system:")) throw systemReadOnly();
  const viewId = uuidInput.safeParse(id);
  if (!viewId.success) throw missing();
  const [row] = await tx.select().from(crmSavedViews).where(and(eq(crmSavedViews.tenantId, tenantId), eq(crmSavedViews.id, viewId.data),
    or(isNull(crmSavedViews.ownerUserId), eq(crmSavedViews.ownerUserId, userId)))).for("update");
  if (!row) throw missing();
  return row;
}
export function updateView(db: Database, userId: string, workspace: string, objectType: ObjectType, id: string, data: ViewPatch) {
  const type = z.enum(objectTypes).parse(objectType), { version, ...input } = viewPatch.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), writePermission(type), async (tx, tenantId) => {
    const current = await lockOwned(tx, tenantId, userId, id);
    if (current.objectType !== type) throw missing();
    if (current.version !== version) throw stale();
    if (input.state) resolveState(type, input.state, await loadDefinitions(tx, tenantId, type));
    const ownerUserId = input.shared === undefined ? current.ownerUserId : input.shared ? null : userId;
    const [row] = await tx.update(crmSavedViews).set({ ...(input.name ? { name: input.name } : {}), ...(input.state ? { state: input.state } : {}), ownerUserId, updatedAt: new Date(), version: sql`${crmSavedViews.version} + 1` })
      .where(and(eq(crmSavedViews.tenantId, tenantId), eq(crmSavedViews.id, current.id), eq(crmSavedViews.version, version))).returning();
    if (!row) throw stale();
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.view_update", targetId: row.id, metadata: { shared: String(!row.ownerUserId) } });
    return toView(row, true);
  });
}
export function deleteView(db: Database, userId: string, workspace: string, objectType: ObjectType, id: string) {
  const type = z.enum(objectTypes).parse(objectType);
  return withTenant(db, userId, uuidInput.parse(workspace), writePermission(type), async (tx, tenantId) => {
    const current = await lockOwned(tx, tenantId, userId, id);
    if (current.objectType !== type) throw missing();
    await tx.delete(crmSavedViews).where(and(eq(crmSavedViews.tenantId, tenantId), eq(crmSavedViews.id, current.id)));
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.view_delete", targetId: current.id });
    return { deleted: true };
  });
}
