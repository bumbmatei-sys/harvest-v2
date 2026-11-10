# CI: routine checks and the manual final review

## What runs when

| Tier | Trigger | Jobs | Typical time |
| --- | --- | --- | --- |
| Routine | Every push and PR update | `fast_checks`: lint, typecheck, unit, migrations (applied twice), RLS/integration tests, build | about 6 minutes |
| Final review | Manual, exact PR head | `browser_review` (Playwright, sharded across 4 containers) and `build_pwa_review` (build and PWA check), in parallel | previously about 27 minutes in one container; expect roughly a third of that |
| Migration check | Manual, with the final review | `neon_review`: applies the migration chain to a disposable Neon branch | a few minutes |

`neon_review` no longer waits for the browser jobs. It never executes PR code (it restores only `drizzle/` from the PR onto trusted `main`), so it can run alongside them.

## Triggering the final review

In CircleCI's Trigger Pipeline dialog, or through the run-pipeline API for this GitHub App project, select the exact PR head branch and set:

- `full_review=true`
- `expected_sha=<40-character PR head SHA>`
- `pr_number=<open PR number>`
- `run_neon=false` for a PR that does not change `drizzle/`. Leave it `true` (the default) when it does. With `false`, the restricted `harvest-neon-ci` context is not used at all.

Every job refuses to run if the checkout is not the selected head, the branch is `main`, or the PR head or branch has moved.

## Sharding

`browser_review` runs `playwright test --shard=N/4` in each container. Each container starts its own dev server and disposable database, so shards do not share state. Playwright splits whole spec files, so one very large spec file limits how much sharding helps; split such files when one dominates. Raise `parallelism` in `.circleci/config.yml` to shard further (each container repeats the roughly two-minute install).

Failure traces are stored per container as `test-results-<index>.tar.gz` and `playwright-report-<index>.tar.gz` under `browser-failures`. Passing runs keep no screenshots.
