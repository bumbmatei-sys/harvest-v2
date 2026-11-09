# Harvest V2 — CircleCI Free setup and operating guide

**Status (2026-11-09):** CircleCI GitHub App connected to only `bumbmatei-sys/harvest-v2` in the `Harvest` organization. PR #43 remains open and unmerged. Initial routine run passed at `1188a514700546efdf65b2d7ad3179a785109799`; complete final review is still pending. No deployment has been initiated. No credit card, paid plan, GitHub upgrade, deployment or real outbound operation authorized.

## What changed
- Keep **GitHub** (`bumbmatei-sys/harvest-v2`) for private code, PRs, branches and Claude/Codex; keep **Vercel linked to GitHub**. No repository or host migration.
- Add [`.circleci/config.yml`](../.circleci/config.yml) with:
  - **Routine/fast** CI on code-changing PRs and `main`: one Node 24 + disposable Postgres 17 Docker job for `npm ci`, lint/source checks, TypeScript, unit, apply + reapply migrations, RLS integration tests, and production build.
  - **Full final review**, manually triggered only with `full_review=true` and exact `expected_sha`: Playwright Chromium, axe/browser, production build, PWA/Lighthouse/offline, then a second job for **isolated Neon CI migrations + cleanup**. It does **not** omit any pre-existing test category.
  - The routine job checks changed paths before `npm ci` and halts for documentation-only changes; ambiguous shallow history runs tests, rather than skipping.
  - The full workflow refuses an empty/stale SHA or the `main` branch. Reviewers also compare the result with GitHub's **current PR HEAD** manually.
- Remove the always-running GitHub Actions `.github/workflows/ci.yml` from the new branch. Its historical content remains in Git history. **Do not merge open PR #42** (older GitHub-hosted optimization), which would restore GitHub Actions. PR #42 remains open for now.
- Adapt `scripts/neon-ci.ts` to use CircleCI `CIRCLE_WORKFLOW_ID` / `CIRCLE_BUILD_NUM` and `BASH_ENV`, while preserving GitHub `GITHUB_RUN_ID` / `GITHUB_ENV` compatibility. Never print database URI/Neon API key.

## Set up CircleCI Free (founder must connect his own account)

1. Open [CircleCI signup](https://circleci.com/signup/). **Choose Free ($0/month)** and connect GitHub. No payment method should be needed for the Free plan. **Do not start Performance, Scale, paid credits or add a payment card.** Free provides 30,000 monthly credits (up to 6,000 minutes on *small* Docker, but routine and Neon jobs use **medium** (10 credits/minute), and manual browser review uses Gen1 **large** (8 GiB, 20 credits/minute). The monthly allowance is shared, so compute minutes depend on the job mix); the free quota and actual resource prices govern. Free personal builds pause at 0 credits, not a bill.
2. In CircleCI **Projects → Set Up Project**, find **`bumbmatei-sys/harvest-v2`** using the **GitHub App** integration. Grant access only to this repository, not all unrelated repositories. Choose **use existing configuration** at `.circleci/config.yml`. For review before merge, select branch **`ci/circleci-free-harvest-20261109`** as the configuration and checkout source if the UI allows it. If the project-setup UI requires a config on `main`, **do not merge PR #43 just to make it runnable**; finish reviewing this PR first, then connect after separately approving merge.
3. In **Project Settings → Triggers**, configure **one** automatic code-review trigger for pushes to **open pull requests**, plus **default branch `main`** pushes. Depending on whether CircleCI shows GitHub App or legacy GitHub OAuth, the exact trigger names differ; use the setting corresponding to "pushes to open PRs, default branch, and tags" on OAuth (avoid tag builds if unneeded). **Avoid both an all-branch push trigger and a PR-update trigger**, or each change can run twice. Full review is *not* an automatic PR trigger; its parameter defaults to false.
4. In CircleCI Project Settings/Advanced, leave **Pass secrets to builds from forked pull requests OFF**. Leave SSH debugging of secret-scoped jobs disabled. Do not add Neon keys to general project variables or to GitHub PR comments.
5. In **Organization Settings → Contexts**, create context **`harvest-neon-ci`** and put exactly these secrets inside, from your own Neon console (the values stored in GitHub Actions cannot be read back):
   - `NEON_API_KEY` — limited to the Harvest Neon project where possible
   - `NEON_PROJECT_ID` — ID of the `harvest-v2` Neon project
   Restrict the context to this CircleCI project and a trusted owner/admin security group if your integration supports those controls. **The default context often allows all organization members; this is not sufficient if you add untrusted collaborators.** Do not enable secret access to forks. This context is referenced **only by `neon_review`**, not by routine or browser jobs.
6. Confirm **GitHub status/check reporting** is enabled for the CircleCI GitHub integration. Confirm that **Vercel still tracks the GitHub repository** separately; there is no CircleCI deployment job and no changes to your existing Vercel project.

## Validation sequence — never skip before merge
1. Trigger **routine/fast** CI against PR #43 branch. It must report all of **lint/source policy, typecheck, unit, Postgres migration idempotence, RLS and production build** passing. A green CircleCI configuration editor preview is not a test run.
2. For the **full suite**, in CircleCI **Pipelines → Trigger Pipeline**, choose the *open PR's actual head branch* for both config and checkout source (GitHub App flow). Set pipeline parameters:
   - `full_review` (**boolean**) = `true`
   - `expected_sha` (**string**) = the current **40-character lowercase GitHub PR head SHA**, copied from GitHub
   Start the run. The browser job must pass Playwright + axe, build + PWA and offline behavior. Only then does the Neon job create a disposable branch, apply migrations and delete it.
3. After the run, compare the SHA reported by CircleCI with the PR's **current** head SHA in GitHub. If new commits arrived or test results are missing/skipped, **rerun** final review. A passing older commit does not qualify. Need an independent code/security review too.
4. **Do not merge/deploy** until all checks and founder approval. If CircleCI Free credits are exhausted, leave PR open until quota refills or use a separately authorized local/self-hosted test environment. Do not downgrade or omit required pre-merge security tests.

## Existing PRs
- **#43** (this PR): introduce CircleCI; must be validated and separately approved. The old GitHub Actions workflow is removed on this branch and will cease on `main` only **if this PR merges**. It does not erase an existing GitHub balance or automatically turn off Vercel.
- **#42** (GitHub-hosted CI cost optimization): **do not merge** after choosing CircleCI; it overlaps/competes with #43. It can be closed later with founder permission.
- **#38** (appearance/QR): remains **open and unmerged**. Its last code change was unverified due to GitHub Actions account budget. After #43 merges, bring #38 up to date with `main`, run CircleCI fast + manual exact-head full, and address real browser failures if present. Do not merge #38 based on prior review of a different head.
- **#16** remains parked. CRM filters are a separate PR after #38 resolution.

## Safety and operational cost
- Free plan (currently 30,000 credits/month; usage policies can change): [pricing](https://circleci.com/pricing/) and [free credits](https://circleci.com/docs/guides/plans-pricing/credits/). Free personal jobs **pause** when credits run out. Routine and Neon jobs use Medium; the manual browser job uses Gen1 Large. The initial Medium browser run approached 4 GiB (3.94 GiB sampled peak) before its Next development server exited and later tests received connection-refused errors. Large remains available on Free, consumes 20 credits/minute, and does not activate billing. Do not switch to a paid plan if quota is exhausted.
- Configure **Plan → Usage Controls → artifact retention** for a short period (e.g. 1–3 days) if your plan permits. CircleCI Free includes limited storage/network allowance. Browser traces/reports are packaged **only on failed full runs**.
- Never paste Neon keys or full database URLs in PRs, Craft, build logs or ChatGPT. Enable GitHub two-factor authentication and restrict CircleCI access.
- The CI migration does not validate product readiness, permit production campaign intake, or replace existing acceptance/review records. No GitHub Actions billed minutes are needed to use CircleCI; GitHub repository and Vercel continue unchanged.
- If CircleCI is not connected, this is **configuration only**, not an active CI service. The ChatGPT GitHub connection cannot create your CircleCI account or authorize its GitHub App.

## Developer references
- [CircleCI pipelines and manual triggers](https://circleci.com/docs/guides/orchestrate/pipelines/)
- [Pipeline parameters](https://circleci.com/docs/guides/orchestrate/pipeline-variables/)
- [GitHub App integration differences](https://circleci.com/docs/guides/integration/using-the-circleci-github-app-in-an-oauth-org/)
- [Restricted secret contexts](https://circleci.com/docs/guides/security/contexts/)
- [Node 24 image and browser tools](https://circleci.com/developer/images/image/cimg/node)

## Connected setup and initial evidence (2026-11-09)

- CircleCI project UUID: `fcf6c661-6df6-40e9-9608-84f04973ebd0`; organization: `Harvest` (`96a5e63a-c99e-4673-a5c3-5142450b535b`).
- Pipeline definition: `9ac61194-fd60-4e16-baf5-f92d00b1ca5b`; config and checkout both use this repository through the GitHub App.
- One `only-build-prs` trigger is enabled (PR opened/updated, default branch and tag pushes); no overlapping all-push trigger.
- Fork builds and fork secret access are disabled; SSH debugging and unversioned config are disabled; settings writes require an admin; GitHub status reporting is enabled and observed on PR #43.
- Routine pipeline 1 (`44d925bc-f42c-49aa-8d6f-2c0febb58d21`) at `1188a514` passed lint/source policy, TypeScript, 297 unit tests, migration apply/replay, 394 integration/RLS tests, and production build.
- Initial final pipeline 2 (`3ec9787d-c37f-44ba-88e5-38997224ba46`) passed its exact-head guard and 21 browser tests, then lost its test server during CRM-06 with `ERR_CONNECTION_REFUSED`; it did not reach PWA or Neon. Memory pressure is the leading hypothesis based on the samples above; the Large rerun must establish whether it resolves the failure.
- `harvest-neon-ci` is not created or populated yet: automatic approval review blocked context creation pending explicit approval. Never treat this or a browser-only pass as a complete final review. Add `NEON_API_KEY` and `NEON_PROJECT_ID` securely after restricting the context to this project and trusted administrators.
- Account plan and artifact-retention settings were not independently verified through the available API. No billing or plan change was made. Confirm Free and short artifact retention in the CircleCI UI.
