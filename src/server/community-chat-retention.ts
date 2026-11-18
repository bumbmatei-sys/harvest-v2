type Queryable = { query: (statement: string, values?: number[] | string[]) => Promise<{ rows: Record<string, unknown>[] }> };

type Counts = Record<string, number>;
const channelFields = ["deleted"] as const;
const dmFields = ["deleted", "conversations", "evidence", "expired", "reminded"] as const;
type Options = { batch?: number; maxBatches?: number };
type Sweep<K extends string> = { counts: Record<K, number>; batches: number; capped: boolean };
type Health = { lastSuccessAt: string | null; lastStatus: "ok" | "failed" | null; overdue: boolean; failedSinceSuccess: boolean };

async function sweep<K extends string>(pool: Queryable, statement: string, fields: readonly K[], options: Required<Options>): Promise<Sweep<K>> {
  const counts = Object.fromEntries(fields.map(field => [field, 0])) as Record<K, number>;
  let batches = 0;
  while (batches < options.maxBatches) {
    const row = (await pool.query(statement, [options.batch])).rows[0]?.result as Counts | undefined;
    let work = 0;
    for (const field of fields) {
      const value = row?.[field];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("CHAT_PURGE_INVALID_RESULT");
      counts[field] += value;
      work += value;
    }
    batches++;
    if (!work) return { counts, batches, capped: false };
  }
  return { counts, batches, capped: true };
}

/** Both lanes get a bounded turn even when the first still has a backlog. 0057 can run before 0058. */
export async function runChatPurge(pool: Queryable, { batch = 200, maxBatches = 50 }: Options = {}) {
  if (!Number.isInteger(batch) || batch < 1 || batch > 1000 ||
      !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 50) throw new Error("CHAT_PURGE_INVALID_OPTIONS");
  const dmAvailable = (await pool.query("select to_regprocedure('public.community_chat_purge_dm(integer)') is not null as available")).rows[0]?.available;
  if (typeof dmAvailable !== "boolean") throw new Error("CHAT_PURGE_INVALID_RESULT");
  const options = { batch, maxBatches };
  const channels = await sweep(pool, "select public.community_chat_purge_channels($1) as result", channelFields, options);
  const dm = dmAvailable ? await sweep(pool, "select public.community_chat_purge_dm($1) as result", dmFields, options) : null;
  return { channels, dm };
}

/** Each sweep is a standalone statement. Log a rolled-back failure in a fresh statement. */
export async function runChatPurgeJob(pool: Queryable, options: Options = {}) {
  try {
    return { ok: true as const, ...(await runChatPurge(pool, options)) };
  } catch {
    await pool.query("select public.community_chat_purge_record_failure($1)", ["sweep_failed"]).catch(() => undefined);
    return { ok: false as const };
  }
}

export async function chatPurgeHealth(pool: Queryable) {
  const row = (await pool.query("select public.community_chat_purge_health() as health")).rows[0]?.health as Health | undefined;
  if (!row || typeof row.overdue !== "boolean" || typeof row.failedSinceSuccess !== "boolean") throw new Error("CHAT_PURGE_INVALID_HEALTH");
  const { lastSuccessAt, lastStatus, overdue, failedSinceSuccess } = row;
  return { lastSuccessAt, lastStatus, overdue, failedSinceSuccess, healthy: !overdue && !failedSinceSuccess };
}
