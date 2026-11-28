# Retention jobs

The founder approved the durations in [HC-02 policy pack §§4–5](../decisions/hc-02-policy-pack.md) on 27 November 2026. Scheduling remains a go-live decision. The worker starts with `RETENTION_JOBS_ENABLED=0`.

## Go-live entry points

After approved migration and worker-role provisioning, set `RETENTION_JOBS_ENABLED=1` on the retention worker and schedule `npm run retention:jobs -- run` daily. Run the first sweep before enabling an hourly `npm run retention:jobs -- check` monitor. Use `WORKER_DATABASE_URL` for the dedicated worker login. If the role was provisioned after migration 0200, apply its final execute-grant block as the migration owner. Remove overlapping legacy schedules when switching to this runner.

Each executed policy writes counts, duration and a fixed error code. A health check fails for an errored last run, a run older than 48 hours, or a rule that has never run. The alert interface takes a rule and reason only. It claims an incident atomically before invoking a configured hook. An incident can alert again after a successful sweep. A hook failure returns an unhealthy command exit and is not retried for that incident. The CLI has no alert destination configured.

## Policy coverage

- Pending Connect responses and 90-day tombstones reuse migration 0043, with separate run records. The aggregate suppression threshold of five is unchanged.
- Hosted form responses use their recorded expiry. Verified CRM contacts and consent evidence are retained. The worker flags verified Connect contacts after 24 months without recorded contact changes, consent activity, CRM notes, tasks, associations or source activity. Fresh activity clears the flag on the next sweep. Historical account-only associations whose evidence was already erased cannot be backfilled.
- Follow-up cases in `closed` expire 12 months after the state changed to closed. The audit ledger and platform staff audit expire after 12 months, except gift, payment and consent actions, which are kept 10 years (founder decision 28 Nov 2026; list in `docs/acceptance/retention-jobs.md`). Retention run logs expire after 90 days.
- The runner uses the existing newsletter delivery and click anonymisers, the community application purge, and the community chat and DM purges. Ongoing hard-bounce and complaint suppression, former-member attribution, and DM deletion on account deletion keep their existing lifecycle.
- Prayer requests and the operational rights-request register have no backing storage in this revision. Their retention handlers belong with those features. Account self-service export requests are a separate system.
