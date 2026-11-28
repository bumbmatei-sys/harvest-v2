# CI: GitHub Actions

`.github/workflows/ci.yml` is the only CI (the main CI since 12 Nov 2026; CircleCI was removed on 25 Nov 2026, after its 2 GiB type check heap ran out on every run while Actions covered every check it ran). It runs on every PR and on `main`, and by hand from Actions → CI → Run workflow:

| Job | Runs | Notes |
| --- | --- | --- |
| **quality** | lint, typecheck, unit tests and build, one runner each | every PR and `main` |
| **migrations and RLS** | migrations applied twice on Postgres 17, then `test:rls` | every PR and `main` |
| **browser 1/6 to 6/6** | Playwright split across six runners | each runner uses an optimized Next.js build and disposable embedded Postgres |
| **build and PWA** | build, then `test:pwa` | every PR and `main` |
| **Neon migrations** | applies migrations to a disposable Neon branch | `main` only, see below |

**Neon migrations** never runs PR code with the Neon key. It runs only on `main`: after a merge that changes `drizzle/`, or by hand for a PR. For a PR, open Actions → CI → Run workflow on `main` and give `pr_number` and `expected_sha` (the reviewed head). The job checks out trusted `main`, checks that the PR's head is still `expected_sha`, copies only the PR's `drizzle/` in (refusing symlinks), and applies it to a disposable Neon branch, which is always deleted. `NEON_API_KEY` and `NEON_PROJECT_ID` are scoped to the two Neon API steps. PR runs, including forks, never receive these secrets.

PR runs are cancelled by a newer push to the same branch; runs on `main` are never cancelled. Every job has a time limit. Browser shards retain a JSON Playwright report as `browser-results-<run>-<shard>` for seven days. A failing shard also retains its HTML report and test results as `browser-failures-<run>-<shard>`. Traces are off in CI.

Playwright splits whole spec files, so one very large spec file limits how much sharding helps; split such files when one dominates, or raise the shard count in `ci.yml`.

## Browser test modes

Run `npm run test:e2e` for the local dev-server default. Set `E2E_WEBPACK=1` to use Webpack for that dev server.

Run `E2E_SERVER=production npm run test:e2e` to compile an optimized build with `next build --webpack` and serve it with `next start`. The runner builds into `.next/e2e` and supplies the same loopback-only synthetic application configuration, email sink, storage mock and disposable database as the dev runner. Install Chromium first with `npx playwright install chromium`. For one CI-sized shard, append `-- --trace off --shard=1/6`.

CI uses the production build for all six browser shards. To measure flakiness on the same commit, select the PR branch in Actions → CI → Run workflow, set `browser_repetitions` to `3`, and leave the Neon inputs empty. Each repetition runs all six shards. Use the job annotations or JSON reports to sum `unexpected` and `flaky` separately and identify the affected specs. Set `browser_mode` to `baseline` for a manual run of the current main commit with the dev server. Playwright API request fixtures retry a connection reset once at the transport layer. HTTP responses and assertion errors pass through unchanged.

## Community browser readiness

The applications and forum specs run on the first browser shard, which shares a cold Next.js dev server, embedded PostgreSQL and a local storage mock. The sign-in helper creates a unique account in each browser context. The specs create separate ministries and communities, and the storage mock keys uploads by ministry, community and file ID.

On main at `5337ec0`, a full-sequence trace showed the join POST succeed while the forum navigation was still pending. The forum cover upload received a ticket and a successful local PUT, then timed out at the filename assertion while confirmation was pending. On retry the cover and attachment completed, while the navigation to the new post hit the same assertion deadline. Running either onboarding or campaigns as the only applications predecessor also exposed the five-second assertion racing a pending draft save.

Wait on the relevant request and then assert the UI outcome. For the editor’s sidebar link, wait for the Communities destination before checking its heading. Check the join response before waiting for the member forum navigation and heading. Wait for the application update and queue refresh before checking the review sheet. Use the visible file chooser and wait for confirmation of that file's `ready` status before checking the chip. After editing or moderating a post, wait for the mutation and the post refresh. To replay the complete affected shard, run `CI=1 E2E_SERVER=production npx playwright test --trace off --shard=1/6` from a fresh checkout with Chromium installed.
