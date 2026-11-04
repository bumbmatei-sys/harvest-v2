# PR 01b workflow contracts and evidence

Date: 2026-11-04. Draft PR targets `feat/pr01a-foundation`. No merge, deployment, real email, Vercel environment edit, or v1 mutation is part of this work.

| Flow | Success | Error | Empty | Unauthorized |
| --- | --- | --- | --- | --- |
| Shell / workspace selection | Verified memberships populate the picker; navigation uses shared-domain workspace paths; mobile sidebar traps focus and closes after navigation | Workspace load boundary offers retry; sign-out errors appear as alerts | First-workspace form; no fabricated contacts/counts | Missing session redirects to sign-in; foreign workspace shows access denied |
| Brand and color mode | User override > workspace default > Harvest; independent light/dark; both axes initialized in head before body paint and reapplied during client navigation | Invalid values ignored; denied storage falls back safely and permits transient choices | New workspaces default to Harvest; unset mode follows system | Preferences grant no access; only authenticated membership can supply a workspace default |
| Save workspace appearance | Owner/admin saves Harvest or Studio; preview cards show both; audit commits with setting | Invalid brand, API/network/DB/audit failure surfaces safe error and does not claim success | Harvest default without an override | Member/viewer can read; default editor is disabled; API returns 403 |
| List / search / page contacts | Server filters by tenant and name/identifier; total and stable 20-row pages come from PostgreSQL | Invalid search/page shows alert; unexpected load failure uses retry boundary | Original split illustration for first contact; separate no-results and out-of-range states | Missing session redirects/401; foreign workspace denied/403; viewer gets read-only UI |
| Create contact | Validated name and optional identifiers/notes persist with audit; opens detail | Normalized duplicate returns 409 without merge; strict payload, phone/handle validation and network error surface alerts; retry available | Labelled blank form; no consent inferred | Viewer writes denied; cross-origin and client-injected tenant fields rejected |
| Read / update contact | Tenant-qualified detail, identifiers and notes survive reload; updates atomically audit | Invalid/missing/foreign contact shows not-found state; duplicate/audit failure rolls back details and identifiers | Missing identifiers/notes and consent are explicitly labelled | Foreign workspace denied; foreign ID never reveals whether it exists elsewhere; viewer edit controls absent and API denies writes |
| Record consent | Channel, explicit status, source, evidence and server-recorded timestamp append to history; latest event summarizes channel; audit shares transaction | Required evidence/source validation; audit failure rolls back ledger write | All channels are “Not recorded” until a choice is recorded | Viewer denied; cross-tenant parent IDs rejected; runtime and owner cannot alter/delete ledger history |

## Validation

Run the standard commands from README. Tests use disposable local PostgreSQL and a mocked Resend module; no real email leaves the test process. Browser seeds are labelled synthetic, and no fixture is exposed in the production app. The database harness applies the checked-in migrations twice. The RLS suite uses `harvest_app`, asserts its restricted privileges, and verifies the same backend PID and zero visible rows after both transaction commit and rollback.

The browser journey covers authenticated create/update/reload, consent recording, network-error retry, identifier conflicts, search, persisted workspace themes and local precedence, viewer denial, a second isolated workspace, missing contacts, mobile navigation, sign-out and signed-out denial. Axe runs on every committed screen, including all four brand/mode combinations of sign-in, workspace, empty/list/detail contacts and the mobile list/detail variants.

Final local output is saved in [pr01b-checks.txt](pr01b-checks.txt). Actual browser screenshots and the machine-readable axe results are under [../screenshots/pr01b/](../screenshots/pr01b/README.md). CI run links and final totals are recorded in the draft PR after validation completes.

## Limits and review gates

The inherited CI workflow migrates its disposable Neon CI branch and removes that branch afterward. This task does not directly create a Neon project/branch or migrate a long-lived environment. Local PostgreSQL checks are not claimed as Neon staging validation. The staging branch, two seeded staging tenants/roles, product-owner review of the Studio white-card choice, and product-owner task sign-off remain release gates. No deployment was performed to obtain screenshots; they are from the local real app connected to disposable PostgreSQL.

The foundation CI upload blocker was resolved on its branch during this session; remote PR checks now run. See the final PR run links rather than historical PR 01a blocker notes.

The managed workspace mounts its original `.git` read-only. To preserve work and push milestones without changing that mount, Git metadata for this session is at `/tmp/harvest-pr01b-git`, using the repository as its working tree. Use `GIT_DIR=/tmp/harvest-pr01b-git git ...` while this workspace persists. The initial files were backed up privately under `/tmp` before syncing. The inherited local `.github/` files were preserved; CI belongs to the PR 01a base, not to the app changes here.
