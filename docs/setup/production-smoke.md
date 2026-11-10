# Production smoke test

A short, read-only check of the deployed site after every merge to `main`. It
runs in CircleCI with no manual trigger and no Claude involvement, and takes a
few minutes, most of it waiting for the deployment to finish.

## What it checks

1. **Waits for the release.** `scripts/smoke-wait-for-deploy.sh` polls
   `/api/version` until the site serves the merged commit (or a later `main`
   commit), for up to 20 minutes. `/api/version` returns only the build's Git
   commit, which Vercel provides as `VERCEL_GIT_COMMIT_SHA`.
2. **Signed out** (`tests/smoke/public.api.spec.ts`): the sign-in screen and
   install manifest are served, auth answers, and workspace data needs a session.
3. **Signed in as the smoke church** (`tests/smoke/signed-in.*.spec.ts`):
   - first proves the session belongs to `HARVEST_SMOKE_EMAIL` and that the
     account sees exactly one workspace, named `HARVEST_SMOKE_WORKSPACE`. If
     either fails, nothing else runs, so a real person's session is refused;
   - reads People, Organizations, pipelines, tasks and campaigns through the API;
   - opens the workspace list, People, Organizations and Campaigns screens in
     Chromium and fails on an error screen or a browser crash.

## Safety

- **Read-only.** Every browser request other than GET/HEAD/OPTIONS is aborted
  and fails the test. API checks only send GET. The suite never signs in,
  signs out, sends a code or email, or touches payments. The one write it
  causes is Better Auth extending the smoke session's own expiry when it is
  used.
- **Only the smoke church.** See the identity check above. Give the smoke
  account no role in any other workspace.
- **Secrets stay out of logs and artifacts.** Traces, screenshots and videos are
  off because they would capture the session cookie. Errors name settings,
  never values. Only the JUnit result is stored.
- **Main only, restricted context.** The job runs only on `main` and is the only
  job that uses the `harvest-prod-smoke` context.

## One-time setup (founder)

1. On the live site, sign in with an address used only for this (for example a
   `+smoke` alias of your mailbox) and create one workspace, such as
   `Harvest Smoke Test`. Add no real people or data to it.
2. In that browser, open developer tools → Application (Storage in Firefox) →
   Cookies → the site, and copy the value of
   `__Secure-better-auth.session_token`. Then just close the window. **Do not
   sign out**, which would end that session.
3. In CircleCI **Organization Settings → Contexts**, create `harvest-prod-smoke`
   with the same restrictions as `harvest-neon-ci` (this project only,
   administrators only, no SSH, trusted `main` configuration only) and add:

   | Name | Value |
   | --- | --- |
   | `HARVEST_SMOKE_BASE_URL` | the site's origin, for example `https://app.example` |
   | `HARVEST_SMOKE_SESSION_TOKEN` | the cookie value from step 2 |
   | `HARVEST_SMOKE_EMAIL` | the smoke account's email address |
   | `HARVEST_SMOKE_WORKSPACE` | the smoke workspace's exact name |
   | `VERCEL_AUTOMATION_BYPASS_SECRET` | only if the site uses Vercel Deployment Protection |

4. Merge this change after the context exists; until then the job fails on
   `main` with "harvest-prod-smoke is missing".

## Keeping the session alive

Sessions last 7 days and each smoke run extends them. If a week passes with no
merge to `main`, the session lapses and the next run fails with "The smoke
sign-in has expired". Repeat steps 1–2 and update `HARVEST_SMOKE_SESSION_TOKEN`.
An optional daily CircleCI scheduled trigger on `main` keeps it alive.

## Running it by hand

```
HARVEST_SMOKE_BASE_URL=https://app.example npx playwright test --config playwright.smoke.config.ts
```

Without the three signed-in settings only the signed-out checks run.
