import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { auditLogs, externalWebhookEvents, jobs } from "../../db/schema";
import { message } from "../../i18n/messages";
import { uuidInput } from "../../lib/contact-input";
import { AccessError } from "../permissions";
import { withTenant } from "../tenancy";
import { jobHandlers, type Job, type JobHandlers } from "./handlers";
import { dispatchOutbox } from "./outbox";
import { backoffMs, JobFailure, LEASE_MS, queueQuery } from "./primitives";

const unlocked = { lockedAt: null, lockedBy: null, lockToken: null };
const expired = sql`${jobs.lockedAt} <= now() - ${LEASE_MS} * interval '1 millisecond'`;
const batchSize = z.number().int().min(1).max(100);
export function listJobs(db: Database, user: string, workspace: string, query: z.input<typeof queueQuery> = {}) {
  const { page, status } = queueQuery.parse(query);
  return withTenant(db, user, uuidInput.parse(workspace), "jobs:read", async (tx, tenantId) => {
    const rows = await tx.select({ id: jobs.id, kind: jobs.kind, status: jobs.status, attempts: jobs.attempts, runAttempts: jobs.runAttempts,
      maxAttempts: jobs.maxAttempts, replayCount: jobs.replayCount, scheduledFor: jobs.scheduledFor, lockedAt: jobs.lockedAt,
      lastError: jobs.lastError, createdAt: jobs.createdAt, updatedAt: jobs.updatedAt,
    }).from(jobs).where(and(eq(jobs.tenantId, tenantId), status ? eq(jobs.status, status) : undefined))
      .orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(51).offset((page - 1) * 50);
    return { rows: rows.slice(0, 50), page, hasMore: rows.length > 50 };
  });
}
export function listWebhookEvents(db: Database, user: string, workspace: string, query: { page?: number } = {}) {
  const { page } = queueQuery.parse(query);
  return withTenant(db, user, uuidInput.parse(workspace), "jobs:read", async (tx, tenantId) => {
    // Raw bodies remain in the audit store; the operator list exposes metadata only.
    const rows = await tx.select({ id: externalWebhookEvents.id, provider: externalWebhookEvents.provider,
      providerEventId: externalWebhookEvents.providerEventId, sequence: externalWebhookEvents.sequence,
      occurredAt: externalWebhookEvents.occurredAt, createdAt: externalWebhookEvents.createdAt,
    }).from(externalWebhookEvents).where(eq(externalWebhookEvents.tenantId, tenantId))
      .orderBy(desc(externalWebhookEvents.createdAt), desc(externalWebhookEvents.id)).limit(51).offset((page - 1) * 50);
    return { rows: rows.slice(0, 50), page, hasMore: rows.length > 50 };
  });
}
export function replayJob(db: Database, user: string, workspace: string, jobId: string) {
  return withTenant(db, user, uuidInput.parse(workspace), "jobs:operate", async (tx, tenantId) => {
    const id = uuidInput.parse(jobId);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, id))).for("update");
    if (!job) throw new AccessError(404, message("Errors.jobNotAvailable"));
    if (job.status !== "dead_letter") throw new AccessError(409, message("Errors.jobReplayRequiresDeadLetter"));
    const [replayed] = await tx.update(jobs).set({ status: "queued", runAttempts: 0, replayCount: sql`${jobs.replayCount} + 1`,
      scheduledFor: sql`now()`, updatedAt: sql`now()`, ...unlocked,
    }).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, id))).returning({ id: jobs.id, status: jobs.status, replayCount: jobs.replayCount });
    await tx.insert(auditLogs).values({ tenantId, actorId: user, action: "job.replay", targetId: id });
    return replayed;
  });
}
export function flushOutbox(db: Database, user: string, workspace: string, limit = 50) {
  batchSize.parse(limit);
  return withTenant(db, user, uuidInput.parse(workspace), "jobs:operate", (tx, tenantId) => dispatchOutbox(tx, tenantId, limit));
}
export function claimJob(db: Database, user: string, workspace: string, worker: string) {
  z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.:-]+$/).parse(worker);
  return withTenant(db, user, uuidInput.parse(workspace), "jobs:operate", async (tx, tenantId) => {
    // Recover exhausted crashed claims without holding locks on another worker.
    const exhausted = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.status, "running"), expired,
      sql`${jobs.runAttempts} >= ${jobs.maxAttempts}`)).limit(100).for("update", { skipLocked: true });
    for (const row of exhausted) await tx.update(jobs).set({ status: "dead_letter", lastError: "LEASE_EXPIRED", updatedAt: sql`now()`, ...unlocked })
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, row.id)));
    const [due] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), lt(jobs.runAttempts, jobs.maxAttempts),
      or(and(eq(jobs.status, "queued"), lte(jobs.scheduledFor, sql`now()`)), and(eq(jobs.status, "running"), expired))))
      .orderBy(asc(jobs.scheduledFor), asc(jobs.id)).limit(1).for("update", { skipLocked: true });
    if (!due) return null;
    const [claimed] = await tx.update(jobs).set({ status: "running", attempts: sql`${jobs.attempts} + 1`, runAttempts: sql`${jobs.runAttempts} + 1`,
      lockedAt: sql`now()`, lockedBy: worker, lockToken: randomUUID(), updatedAt: sql`now()`,
    }).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, due.id))).returning();
    return claimed;
  });
}
export function runClaimedJob(db: Database, user: string, workspace: string, claim: Pick<Job, "id" | "lockToken">, handlers: JobHandlers = jobHandlers) {
  uuidInput.parse(claim.id); uuidInput.parse(claim.lockToken);
  return withTenant(db, user, uuidInput.parse(workspace), "jobs:operate", async (tx, tenantId) => {
    // Lock before invoking any handler. A reclaimed/expired token cannot act.
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, claim.id), eq(jobs.status, "running"),
      eq(jobs.lockToken, claim.lockToken!), sql`not (${expired})`)).for("update");
    if (!job) return { status: "stale_claim" as const };
    try {
      // The savepoint rolls ALL handler writes back on failure while allowing
      // the outer transaction to persist the retry/DLQ outcome.
      await tx.transaction(async (effects) => {
        const handler = Object.hasOwn(handlers, job.kind) ? handlers[job.kind] : undefined;
        if (!handler) throw new JobFailure("UNSUPPORTED_JOB_KIND");
        await handler(effects, job);
      });
    } catch (error) {
      const status = job.runAttempts >= job.maxAttempts ? "dead_letter" : "queued";
      await tx.update(jobs).set({ status, lastError: error instanceof JobFailure ? error.code : "HANDLER_FAILED",
        scheduledFor: sql`now() + ${backoffMs(job.runAttempts)} * interval '1 millisecond'`, updatedAt: sql`now()`, ...unlocked,
      }).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, job.id), eq(jobs.lockToken, job.lockToken!)));
      return { status };
    }
    await tx.update(jobs).set({ status: "succeeded", lastError: null, updatedAt: sql`now()`, ...unlocked })
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, job.id), eq(jobs.lockToken, job.lockToken!)));
    return { status: "succeeded" as const };
  });
}
export async function drainJobs(db: Database, user: string, workspace: string, worker: string, limit = 50) {
  batchSize.parse(limit);
  let dispatched = 0, flushFailed = false;
  try { dispatched = await flushOutbox(db, user, workspace, limit); }
  catch (error) {
    if (error instanceof AccessError || error instanceof z.ZodError) throw error;
    // Flush has its own transaction. Already queued work can still progress.
    flushFailed = true;
  }
  const results = [];
  for (let i = 0; i < limit; i++) {
    const claim = await claimJob(db, user, workspace, worker);
    if (!claim) break;
    results.push({ id: claim.id, ...await runClaimedJob(db, user, workspace, claim) });
  }
  return { dispatched, flushFailed, results };
}
