import type { Client } from "pg";
import { withDb } from "../../db/request";
import type { JobDispatch, JobPort } from "./dispatch";

export type JobBindings = {
  HARVEST_ENV?: string;
  WORKER_HYPERDRIVE?: { connectionString: string };
};

export type JobConnection = Pick<Client, "query">;
const leaseSeconds = 60;

function scope<T>(env: JobBindings, run: (connection: JobConnection) => Promise<T>) {
  // Construct the DB environment explicitly. Neither an app binding nor a
  // process connection URL can serve as the worker login.
  return withDb({ runtime: "workers", role: "worker", WORKER_HYPERDRIVE: env.WORKER_HYPERDRIVE },
    (_db, connection) => run(connection));
}

export function jobLease(env: JobBindings, { job, scheduledTime }: JobDispatch, seconds = leaseSeconds) {
  const token = crypto.randomUUID();
  const fence = async (connection: JobConnection) => {
    const { rows: [row] } = await connection.query<{ valid: boolean }>("select public.worker_job_fence($1,$2) as valid", [job, token]);
    if (!row?.valid) throw new Error("WORKER_JOB_LEASE_LOST");
  };
  const finish = async (connection: JobConnection, done: boolean) => {
    const { rows: [row] } = await connection.query<{ valid: boolean }>("select public.worker_job_finish($1,$2,$3) as valid", [job, token, done]);
    if (!row?.valid) throw new Error("WORKER_JOB_LEASE_LOST");
  };

  return {
    async acquire() {
      const { rows: [row] } = await scope(env, connection => connection.query<{ state: string }>(
        "select public.worker_job_acquire($1,$2,$3,$4) as state", [job, new Date(scheduledTime).toISOString(), token, seconds]));
      if (row?.state === "done") return "duplicate";
      if (row?.state === "busy" || row?.state === "acquired") return row.state;
      throw new Error("WORKER_JOB_ACQUIRE_FAILED");
    },
    async renew() {
      const { rows: [row] } = await scope(env, connection => connection.query<{ valid: boolean }>(
        "select public.worker_job_renew($1,$2,$3) as valid", [job, token, seconds]));
      if (!row?.valid) throw new Error("WORKER_JOB_LEASE_LOST");
    },
    transaction<T>(run: (connection: JobConnection) => Promise<T>, complete: boolean | ((result: T) => boolean) = false) {
      return scope(env, async connection => {
        await connection.query("begin");
        try {
          await fence(connection);
          const result = await run(connection);
          if (typeof complete === "function" ? complete(result) : complete) await finish(connection, true);
          else await fence(connection);
          await connection.query("commit");
          return result;
        } catch (error) {
          await connection.query("rollback").catch(() => undefined);
          throw error;
        }
      });
    },
    finish: (done: boolean) => scope(env, connection => finish(connection, done)),
  };
}

type Lease = ReturnType<typeof jobLease>;
export function leasedJobPort(env: JobBindings, run: (dispatch: JobDispatch, lease: Lease) => Promise<void>): JobPort {
  return { async run(dispatch) {
    const lease = jobLease(env, dispatch);
    const acquired = await lease.acquire();
    if (acquired !== "acquired") return acquired;
    try {
      await run(dispatch, lease);
      return "done";
    } catch (error) {
      await lease.finish(false).catch(() => undefined);
      throw error;
    }
  } };
}
