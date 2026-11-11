# CI: routine checks and the manual final review

## What runs when

| Tier | Trigger | Jobs | Typical time |
| --- | --- | --- | --- |
| Routine | Every push and PR update | `fast_checks`: lint, typecheck, unit, migrations (applied twice), RLS/integration tests, build | about 6 minutes |
| Final review | Manual, exact PR head | `browser_review` (Playwright, sharded across 4 containers) and `build_pwa_review` (build and PWA check), in parallel | previously about 27 minutes in one container; expect roughly a third of that |
| Migration check | Manual, from `main` | `neon_review`: applies the PR's migration files to a disposable Neon branch | a few minutes |

`neon_review` is its own manual run from `main`, not part of the PR-branch final review. It never executes PR code: it checks out trusted `main`, verifies the PR head, and replaces `drizzle/` with the PR's copy. Because its config always comes from `main`, the restricted `harvest-neon-ci` context's `refs/heads/main` rule already allows it, so no per-PR context edit is needed.

## Triggering the final review

In CircleCI's Trigger Pipeline dialog, or through the run-pipeline API for this GitHub App project, select the exact PR head branch and set:

- `full_review=true`
- `expected_sha=<40-character PR head SHA>`
- `pr_number=<open PR number>`

## Triggering the Neon migration check

Only for PRs that change `drizzle/`. In the Trigger Pipeline dialog or through the run-pipeline API, select branch **`main`** (CircleCI requires the config and checkout branch to match) and set:

- `neon_only=true`
- `expected_sha=<40-character PR head SHA>`
- `pr_number=<open PR number>`

The job refuses to run unless the pipeline is on `main` and `expected_sha` is still the PR's current head. Keep the older per-PR and per-SHA expression rules on `harvest-neon-ci` until the first successful `neon_only` run from `main` has confirmed the `refs/heads/main` clause matches; after that they can be removed (keep that clause and the repo-name and no-SSH conditions). The `run_neon` parameter was removed.

Every job refuses to run if the checkout is not the selected head, the branch is `main`, or the PR head or branch has moved.

## Sharding

`browser_review` runs `playwright test --shard=N/4` in each container. Each container starts its own dev server and disposable database, so shards do not share state. Playwright splits whole spec files, so one very large spec file limits how much sharding helps; split such files when one dominates. Raise `parallelism` in `.circleci/config.yml` to shard further (each container repeats the roughly two-minute install).

Failure traces are stored per container as `test-results-<index>.tar.gz` and `playwright-report-<index>.tar.gz` under `browser-failures`. Passing runs keep no screenshots.
