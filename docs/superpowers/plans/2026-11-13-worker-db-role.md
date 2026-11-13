# Worker database role: plan

1. Migration `0044_worker_db_role` (+ journal, snapshot): unconditional revoke from `PUBLIC` and `harvest_app`, conditional grant to `harvest_worker`, refuse a privileged role.
2. `tests/database.ts`: pre-create the role, login password, `workerPool` and `workerURL`.
3. `src/server/worker-role.ts` (`requireWorkerRole`, `workerDatabaseUrl`); both scripts use `WORKER_DATABASE_URL` and the role check.
4. Move the existing worker-function callers in the integration tests onto the worker pool (`community-email*`, `hc-retention-db`, `connect-retention`, `hc-retention-owner`, `community-joining-definer-owner`).
5. New tests: `worker-role` (grants, denial for `harvest_app`, no table privileges, scripts refuse the wrong role, migration with an absent or privileged role) and `worker-role-owner` (restricted owner).
6. Docs: acceptance record, activation gates of `communities-c15b` and `hc-retention`, `docs/setup/worker-role.md`, `.env.example`, feature flags, dev provisioning script.
7. Full integration suite (root and `tester`), typecheck, lint of changed files, `check-source`.
