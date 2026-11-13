// Background workers connect as the dedicated harvest_worker role (migration 0044), never as the web application role.
type Queryable = { query: (text: string) => Promise<{ rows: Record<string, unknown>[] }> };

// Refuses unless the connection really is the unprivileged worker login: not superuser, no BYPASSRLS, not the web role.
export async function requireWorkerRole(pool: Queryable): Promise<void> {
  const { rows: [role] } = await pool.query("select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  if (role?.name !== "harvest_worker" || role.rolsuper || role.rolbypassrls) throw new Error("WORKER_ROLE_REQUIRED");
}

// WORKER_DATABASE_URL is separate from DATABASE_URL on purpose: the worker login is not the application login.
export function workerDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.WORKER_DATABASE_URL;
  if (!url) throw new Error("WORKER_DATABASE_URL_REQUIRED");
  return url;
}
