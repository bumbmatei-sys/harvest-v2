import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { renderEmail, type EmailJob } from "../lib/community-email";
import { verifyUnsubscribe } from "../lib/community-email-token";
import type { CommunityMailSender } from "./community-email-sender";

// C15b: the notification email worker. It queues what is due, claims batches, renders plain text, sends through the given
// sender and records the result. It reports counts only: never an address, a title or an error body.
type Queryable = { query: <R extends Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: R[] }> };
type ClaimedJob = EmailJob & { idempotencyKey: string };
export type RunOptions = { origin: string; secret: string; now?: number };
export type RunResult = { queued: number; sent: number; failed: number };

const BATCH = 25, MAX_BATCHES = 40, SEND_TIMEOUT_MS = 15_000;

/**
 * Only one worker run at a time (session advisory lock on the given connection), so a slow provider can never make two
 * overlapping runs send the same batch. Returns null when another run holds the lock.
 */
export async function withWorkerLock<T>(client: Queryable, run: () => Promise<T>): Promise<T | null> {
  const { rows: [{ locked }] } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext('harvest:community-email-worker')) as locked");
  if (!locked) return null;
  try { return await run(); }
  finally { await client.query("select pg_advisory_unlock(hashtext('harvest:community-email-worker'))").catch(() => undefined); }
}

export async function runCommunityEmail(pool: Queryable, sender: CommunityMailSender, options: RunOptions): Promise<RunResult> {
  const { rows: [{ queued }] } = await pool.query<{ queued: number }>("select public.community_email_enqueue($1) as queued", [200]);
  let sent = 0, failed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { rows: [{ claimed }] } = await pool.query<{ claimed: { jobs: ClaimedJob[]; picked: number } }>("select public.community_email_claim($1) as claimed", [BATCH]);
    if (claimed.picked === 0) break;
    for (const job of claimed.jobs) {
      let error: string | null = null;
      try {
        const mail = renderEmail(job, { origin: options.origin, secret: options.secret, now: options.now });
        try { await sender({ to: job.to, ...mail, idempotencyKey: job.idempotencyKey, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) }); }
        catch { error = "send_failed"; }
      } catch { error = "render_failed"; }
      await pool.query("select public.community_email_complete($1::uuid, $2, $3)", [job.id, error ? "failed" : "sent", error]);
      if (error) failed++; else sent++;
    }
  }
  return { queued, sent, failed };
}

/**
 * One-click unsubscribe. The token is the only credential. The answer is the same whether or not the token was valid, so
 * it reveals nothing; the only possible change is turning that membership's email off.
 */
export async function unsubscribeByToken(db: Database, secret: string, token: string): Promise<void> {
  const target = verifyUnsubscribe(secret, token);
  if (!target) return;
  await db.execute(sql`select public.community_email_unsubscribe(${target.tenantId}::uuid, ${target.communityId}::uuid, ${target.userId}) as v`);
}
