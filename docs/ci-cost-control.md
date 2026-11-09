# Harvest CI cost controls and required merge gate

**Introduced:** 2026-11-09. This controls GitHub Actions runner usage without removing pre-merge test obligations. **It does not unblock a depleted GitHub Actions budget or authorize merges/deploys.**

## Why the previous checks blocked
Old `.github/workflows/ci.yml` started **seven Ubuntu jobs on every code/doc PR push**: four quality matrix runners, Postgres/RLS, Playwright/PWA, and Neon migration integration. Each job installed Node dependencies separately; browser evidence artifacts could be ~100 MB. GitHub Actions budget was visibly at **$10/$10, usage blocked**. After 2026-11-09 00:50 UTC multiple workflows (even on `main` and docs-only changes) failed with **zero steps and zero runner minutes**, so that failure does **not** prove source defects. The last PR #38 run at `2f4b176` could not validate its UI changes.

## New workflow contract

| Workflow | When it runs | Checks (unchanged final requirements) | Cost control |
| --- | --- | --- | --- |
| **PR Fast CI** (`.github/workflows/ci.yml`) | Code-changing PR opened/updated/reopened/marked ready; code-changing push to main | lint/source policy, TypeScript, unit tests, idempotent local Postgres migrations, RLS/integration tests, production build | **one** Ubuntu job, **one** `npm ci`; cancel superseded runs; no workflow for docs-only changes |
| **Final Review CI** (`.github/workflows/final-review.yml`) | On explicit `ci:full` PR label, while labeled on subsequent pushes, or manual branch+PR-number dispatch | Complete Chromium Playwright browser/axe suite, production build + PWA/offline check, then **Neon CI migration branch** and cleanup | Expensive suite only on near-merge changes; Neon starts **after** browser passes; artifacts saved **on failure only**, 3-day retention |

Original commands are retained, not mocked, skipped, replaced with "test not run", or marked green by hand. The fast workflow's `paths-ignore` recognizes *documentation-only* PRs; mixed docs+code changes still test. A docs-only change to CI workflow YAML itself is a code change and still triggers checks.

### Running the full suite before approval

**Option A — easy trigger after creating the optional `ci:full` label once.**
1. In GitHub repository **Issues → Labels**, create exactly `ci:full` (if not already defined). Only trusted maintainers should set it.
2. When a code PR is ready for final review, add `ci:full` in the PR sidebar. That triggers **Final Review CI**.
3. Leave the label attached for review: on each new commit, `synchronize` will rerun the full checks. Other label changes do not launch unnecessary full runs.
4. Remove the label while doing heavy iteration if you want to avoid repeatedly spending minutes, then add it again immediately before review.

**Option B — manual, needs no label.**
1. Open **Actions → Final Review CI → Run workflow**.
2. Select the **current PR head branch** (not `main`). Enter the numeric PR number and run.
3. Workflow preflight checks the PR is open, targets `main`, is in this same repository, and **exactly matches** the selected branch + commit SHA; otherwise it stops. GitHub CLI validates with read-only token.
4. The full run must pass against the exact current PR head. A later code push invalidates the previous evidence; rerun.

**After this CI PR merges:** synchronize outstanding older PRs (notably #38) with the new `main` so they pick up the new workflow files, then run the full suite on the reconciled head. Do not silently rewrite/force-push those branches. #16 remains parked.

### Non-negotiable merge checklist (maintainer-owned)
- [ ] PR's **latest code head** has green **PR Fast CI**, unless the PR is strictly documentation-only (inspect changed paths).
- [ ] PR's **latest code head** has green **Final Review CI**, covering browser/accessibility/PWA and Neon; inspect exact ref/commit and test logs. Label or manual dispatch alone is not evidence of completion.
- [ ] Separate independent reviewer checks security, permissions, migrations and UX and leaves explicit review evidence.
- [ ] Founder explicitly approves merge. No automatic deployment / production intake / real outbound communications is implied.
- [ ] If GitHub Actions budget is blocked or tests cannot run, **leave PR open**. Missing CI is never a pass.

**Enforcement limitation:** current private repo's GitHub Free connection returned HTTP 403 for repository rulesets ("Upgrade to GitHub Pro or make this repository public"). Therefore the above is a mandatory **human review gate**, not a claim that GitHub enforces branch protection on this plan. Do not relax the checklist for expediency.

## Why this lowers costs (not a cost guarantee)
- One fast runner instead of four quality runners plus the database runner on every commit.
- `npm ci` only once for all fast checks; expensive browser/Neon jobs only when requested for review.
- No duplicate heavy run from every routine edit or docs-only PR. Neon does not run if browser/PWA failed.
- Stop uploading ~100 MB browser artifacts after successful runs; retain small failure traces briefly.
- Fast checks still run on changes merged into main (not on docs-only changes).
- Reduced GitHub-hosted usage **does not restore a fully exhausted monthly budget**; follow GitHub billing page for reset, plan/payment or optional self-hosted execution.

## Optional completely GitHub-hosted-minute-free path
GitHub states self-hosted runners are not billed for GitHub-hosted compute usage, but the owner pays for the machine, electricity, maintenance and security. A self-hosted Linux runner can eventually replace `runs-on: ubuntu-latest` once provisioned **and securely isolated** (prefer short-lived ephemeral runner on dedicated VM; never a personal workstation holding secrets). Keep `NEON_API_KEY` separate from untrusted PR code and use least-privilege tokens. Never attach a persistent general-purpose runner to untrusted public forks. GitHub repository **Settings → Actions → Runners → New self-hosted runner** provides the current install commands. Do not switch these workflows to self-hosted until the runner actually exists and is reviewed: otherwise jobs queue forever. See https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners and https://docs.github.com/en/actions/concepts/billing-and-usage .

## Testing/limitations of this change
This PR edits **GitHub Actions workflows and docs only**. It has no application code, migrations, or runtime side effects. Configuration can be reviewed statically; **GitHub-hosted CI execution remains blocked until the account's Actions budget permits runners**. After unblocking, validate fast run, then final full run on a real PR and verify old expensive runs are not triggered by docs-only changes. Only after that is the optimization operationally verified.
