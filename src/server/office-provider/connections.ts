import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { auditLogs, officeConnectAttempts, officeConnections } from "../../db/schema";
import { message } from "../../i18n/messages";
import { AccessError, type Permission } from "../permissions";
import { withTenant } from "../tenancy";
import { operationAvailable } from "./capabilities";
import { available, grant, officeNotice, operationKind, type Health, type OfficeAccount, type OfficeProvider, type OfficeRequest, type OfficeResult } from "./port";
import type { OfficeMailReview } from "./review";
import { OfficeProviderError, type Credential } from "./types";

export const OFFICE_INTEGRATION_ENABLED = false;
export const OFFICE_MAIL_SEND_ENABLED = false;
export const OFFICE_CALENDAR_WRITE_ENABLED = false;
export type Connection = typeof officeConnections.$inferSelect;
export type OfficeDeps = {
  provider: OfficeProvider;
  credential: Credential;
  now: () => Date;
  review: OfficeMailReview;
  /** Injected by unit and integration tests only. The HTTP gate never supplies a sender. */
  testDelivery?: true;
};

export const unavailable = () => new AccessError(404, message("Errors.workspaceUnavailable"));
export async function withOffice<T>(db: Database, actor: string, workspace: string, permission: Permission, deps: OfficeDeps | null,
  run: (tx: Transaction, tenant: string, deps: OfficeDeps) => Promise<T>) {
  if (!deps || (deps.provider.id !== "fake" && !OFFICE_INTEGRATION_ENABLED)) throw unavailable();
  const tenant = z.uuid().safeParse(workspace);
  if (!tenant.success) throw unavailable();
  try {
    return await withTenant(db, actor, tenant.data, permission, (tx, id) => run(tx, id, deps));
  } catch (error) {
    if (error instanceof AccessError && error.status === 403) throw unavailable();
    throw error;
  }
}

export function connectionAccount(row: Connection): OfficeAccount | null {
  return row.platform && row.profileRef
    ? { ref: row.externalAccountRef, platform: row.platform, kind: row.kind, profileRef: row.profileRef } : null;
}

function connectionView(row: Connection, deps: OfficeDeps) {
  const operations = Object.keys(operationKind) as (keyof typeof operationKind)[];
  const compatible = row.platform && row.provider === deps.provider.id;
  return {
    id: row.id, kind: row.kind, platform: row.platform, health: compatible ? row.health : "reconnect_needed",
    grants: compatible ? row.grants : 0, noticeVersion: row.noticeVersion,
    capabilities: Object.fromEntries(operations.filter(action => operationKind[action] === row.kind).map(action => [
      action, compatible && row.platform && operationAvailable(row.platform, action, row.provider === "fake")
        ? (["createEvent", "updateEvent", "deleteEvent"].includes(action) && !OFFICE_CALENDAR_WRITE_ENABLED ? "disabled" : "available")
        : "unavailable",
    ])),
    ...(row.kind === "mail" && { send: "disabled" }),
  };
}

export const auditOffice = (tx: Transaction, tenantId: string, actorId: string, action: OfficeRequest["action"], targetId: string, outcome: string) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action: `office.${action}`, targetId, metadata: { outcome } });

export async function officeConnection(tx: Transaction, tenant: string, owner: string, id: string | undefined, write: boolean) {
  if (!id) throw unavailable();
  const [row] = await tx.select().from(officeConnections).where(and(
    eq(officeConnections.tenantId, tenant), eq(officeConnections.ownerUserId, owner), eq(officeConnections.id, id),
  )).for(write ? "update" : "share");
  if (!row) throw unavailable();
  return row;
}

export function listOfficeConnections(db: Database, actor: string, workspace: string, deps: OfficeDeps | null = null) {
  return withOffice(db, actor, workspace, "office:connect", deps, async (tx, tenant, current) => {
    const rows = await tx.select().from(officeConnections).where(and(eq(officeConnections.tenantId, tenant), eq(officeConnections.ownerUserId, actor)))
      .orderBy(officeConnections.kind, officeConnections.createdAt, officeConnections.id);
    return { notice: officeNotice, connections: rows.map(row => connectionView(row, current)) };
  });
}

const cleanHealth = (value: Health, kind: Connection["kind"]): Health => {
  const grants = value.grants & grant[kind];
  return { health: grants ? value.health : "reconnect_needed", grants };
};

export function providerFailure(error: unknown): OfficeResult {
  if (!(error instanceof OfficeProviderError)) throw error;
  switch (error.code) {
    case "NOT_FOUND": throw unavailable();
    case "CONFLICT": throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
    case "INVALID_REQUEST": throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
    case "RATE_LIMITED":
    case "TEMPORARY":
    case "AUTH": return { state: "temporarily_unavailable" };
    case "RECONNECT_NEEDED": return { state: "reconnect_needed" };
    case "UNAVAILABLE": return { state: "unavailable" };
    case "DISABLED": return { state: "disabled" };
  }
}

async function lockConnections(tx: Transaction, tenant: string, actor: string) {
  // All lifecycle mutations take this lock before any connection row lock.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["office", tenant, actor])}, 0))`);
}

type Lifecycle = Extract<OfficeRequest, { action: "startConnect" | "finishConnect" | "health" | "disconnect" }>;
export function officeLifecycle(db: Database, actor: string, workspace: string, request: Lifecycle, deps: OfficeDeps | null) {
  return withOffice(db, actor, workspace, "office:connect", deps, async (tx, tenant, current) => {
    const { provider, credential } = current;
    const owner = and(eq(officeConnections.tenantId, tenant), eq(officeConnections.ownerUserId, actor));
    const attempts = and(eq(officeConnectAttempts.tenantId, tenant), eq(officeConnectAttempts.ownerUserId, actor));
    const { action, input } = request;
    if (action !== "health") await lockConnections(tx, tenant, actor);

    if (action === "startConnect") {
      const [existing] = request.connectionId
        ? [await officeConnection(tx, tenant, actor, request.connectionId, true)]
        : await tx.select().from(officeConnections).where(and(owner, eq(officeConnections.kind, input.kind), isNotNull(officeConnections.platform))).for("update");
      const account = existing ? connectionAccount(existing) : null;
      if (existing && existing.kind !== input.kind) throw unavailable();
      if (existing && account && (account.platform !== input.platform || existing.provider !== provider.id)) {
        throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
      }
      const attemptId = randomUUID();
      let started;
      try {
        started = await provider.startConnect(credential, { attemptId, kind: input.kind, platform: input.platform, existing: account ?? undefined });
      } catch (error) {
        const result = providerFailure(error);
        await auditOffice(tx, tenant, actor, action, attemptId, result.state);
        return result;
      }
      await tx.delete(officeConnectAttempts).where(and(attempts, eq(officeConnectAttempts.kind, input.kind)));
      await tx.insert(officeConnectAttempts).values({
        tenantId: tenant, ownerUserId: actor, id: attemptId, provider: provider.id, connectionId: existing?.id,
        kind: input.kind, platform: input.platform, noticeVersion: input.noticeVersion, profileRef: started.profileRef,
        handoffRef: started.handoffRef, expiresAt: started.expiresAt,
      });
      await auditOffice(tx, tenant, actor, action, attemptId, "started");
      return { state: "pending", attemptId, url: started.url, expiresAt: started.expiresAt.toISOString() } as const;
    }

    if (action === "finishConnect") {
      const condition = and(attempts, eq(officeConnectAttempts.id, input.attemptId));
      const [attempt] = await tx.select().from(officeConnectAttempts).where(condition);
      if (!attempt || attempt.provider !== provider.id) throw unavailable();
      const existing = attempt.connectionId ? await officeConnection(tx, tenant, actor, attempt.connectionId, true) : null;
      const fail = async () => {
        await tx.delete(officeConnectAttempts).where(condition);
        await auditOffice(tx, tenant, actor, action, attempt.id, "failed");
        return { state: "failed" } as const;
      };
      if (attempt.expiresAt <= current.now()) return fail();
      const previous = existing && connectionAccount(existing);
      let result;
      try {
        result = await provider.finishConnect(credential, { ...attempt, expectedRef: previous?.ref });
      } catch (error) {
        const outcome = providerFailure(error);
        await auditOffice(tx, tenant, actor, action, attempt.id, outcome.state);
        return outcome;
      }
      if (result.state === "pending") return { state: "pending" } as const;
      if (result.state !== "connected") return fail();
      const update = { ...cleanHealth(result.health, attempt.kind), noticeVersion: attempt.noticeVersion };
      let row;
      if (previous && existing) {
        if (previous.ref !== result.accountRef || previous.profileRef !== attempt.profileRef || previous.platform !== attempt.platform) return fail();
        [row] = await tx.update(officeConnections).set(update).where(and(owner, eq(officeConnections.id, existing.id))).returning();
      } else {
        // A legacy row owns no valid grant; its replacement receives a fresh connection id.
        [row] = await tx.insert(officeConnections).values({
          ...update, tenantId: tenant, ownerUserId: actor, kind: attempt.kind, platform: attempt.platform,
          profileRef: attempt.profileRef, provider: provider.id, externalAccountRef: result.accountRef,
        }).onConflictDoNothing().returning();
        if (!row) return fail();
        if (existing) await tx.delete(officeConnections).where(and(owner, eq(officeConnections.id, existing.id)));
      }
      await tx.delete(officeConnectAttempts).where(condition);
      await auditOffice(tx, tenant, actor, action, row.id, row.health);
      return { state: "connected", connection: connectionView(row, current) } as const;
    }

    const row = await officeConnection(tx, tenant, actor, request.connectionId, true);
    const account = connectionAccount(row);
    const condition = and(owner, eq(officeConnections.id, row.id));
    if (account && row.provider !== provider.id) return { state: "unavailable" } as const;
    if (action === "health") {
      if (!account) return available(connectionView(row, current));
      let health;
      try {
        health = cleanHealth(await provider.health(credential, account), row.kind);
      } catch (error) {
        if (error instanceof OfficeProviderError && error.code === "NOT_FOUND") health = { health: "reconnect_needed", grants: 0 } as const;
        else {
          const result = providerFailure(error);
          await auditOffice(tx, tenant, actor, action, row.id, result.state);
          return result;
        }
      }
      await tx.update(officeConnections).set(health).where(condition);
      await auditOffice(tx, tenant, actor, action, row.id, health.health);
      return available(connectionView({ ...row, ...health }, current));
    }

    if (account) {
      try {
        await provider.disconnect(credential, account);
      } catch (error) {
        if (!(error instanceof OfficeProviderError && error.code === "NOT_FOUND")) {
          const result = providerFailure(error);
          await auditOffice(tx, tenant, actor, action, row.id, result.state);
          return result;
        }
      }
    }
    await tx.delete(officeConnections).where(condition);
    await auditOffice(tx, tenant, actor, action, row.id, "disconnected");
    return { state: "disconnected" } as const;
  });
}
