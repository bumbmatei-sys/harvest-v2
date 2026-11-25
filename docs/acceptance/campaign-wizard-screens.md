# Campaign wizard screens: PRD checklist (CW-02 to CW-09)

Status: **plan, nothing in this document is built yet.** Written 25 Nov 2026 before any UI code is merged. Every row quotes `docs/prd/harvest-campaign-wizard.md` ("PRD"), names the screen or component that will satisfy it, and has an Evidence cell that is filled with a test or screenshot when the row is done. A row with no evidence at the end is listed under "Not built".

Server already merged (#224, `a1408ee`, migration 0092): drafts, autosave with version check (409), idempotent create, finish, discard, activate. Read `docs/acceptance/campaign-wizard-server.md`. There is no separate CW-02 acceptance doc: CW-01 (`docs/acceptance/cw-01.md`) is the only earlier campaign acceptance record, and CW-02 is the shell this work delivers.

Rules for this work: no step, field or copy that the PRD does not contain; where the PRD is silent or conflicts with a founder decision the row says **OPEN** and links to a question below. Style is Studio Admin through the shared shell, `EditorShell`, `WizardLayout`, `Stepper`, `Field`, `FormSection`, `ConfirmDialog`. Kit items approved 25 Nov 2026 (to be recorded in `docs/ui-sources.md` and `src/lib/ui-provenance.ts` with the first PR that copies from them): `stepper1`, `form-layout1`, `form-layout11`, `tables9`, `switch-card1`, `todo-app6`, plus stat cards and charts as in CRM reports.

## Proposed PRs, in CW order

| PR | Roadmap slice | Delivers | Needs server change |
| --- | --- | --- | --- |
| 1 | CW-02, CW-03, CW-04 | Wizard shell on `EditorShell` (steps 5 to 8 listed but disabled), start page, drafts list, autosave with Saved state, resume, conflict message, steps 1 to 3, activate on the campaign page | No (the Activate row needs none) |
| 2 | CW-05 | Steps 4 and 5: departments, leaders and team members with invitations they must accept, tool cards | **Yes**: invitation model (new migration), see Q2 |
| 3 | CW-06 | Step 8 review and Finish, finish-once, post-creation checklist | **Yes**: finish permission, see Q1 |
| 4 | CW-07 | Campaign dashboard | Maybe: read of finished-draft configuration, see Q6 |
| 5 | CW-08 | Step 7 | No (configuration only), see Q7 |
| 6 | CW-09 | Step 6 | No |

Migration numbering follows the journal on `main` at the time each PR is opened.

## CW-02 and CW-03: shell, autosave, resume

| # | PRD requirement | Screen / component | Evidence |
| --- | --- | --- | --- |
| 1 | Overview: "Harvest should open a guided, multi-step onboarding wizard" when an administrator clicks "+ Create New Campaign" | **New campaign** button on `/workspaces/:id/campaigns` leading to `/campaigns/new` | |
| 2 | "The wizard should have **8 steps**, with **Back**, **Next**, and **Finish** buttons, a progress indicator" | `EditorShell` + `WizardLayout` (Back/Next/Finish) + kit `stepper1` look via shared `Stepper`: steps in the shell editing sidebar from 1024px, "Step n of 8" bar below | |
| 3 | "automatic draft saving" and "Users should be able to close the wizard and resume later without losing their answers" | Autosave per step, **Saved** state next to the title, resume at the furthest step reached, Drafts list (`/campaigns/drafts`, the way back in) | |
| 4 | Technical: "Secure, idempotent campaign creation" | Draft create sends an `Idempotency-Key`; double click makes one draft | |
| 5 | Technical: "Backend validation and audit logging" | Screens use the server `issues`; no client-only rule is the authority | |
| 6 | Decision 6 Nov: draft saving is "persisted"; changed elsewhere must not overwrite | 409 shows "changed elsewhere, reload"; fields lock until reload | |
| 7 | Technical: "Workspace-based permissions" | Viewer sees no New campaign, no drafts; member sees own drafts; owner/admin see all and may discard | |
| 8 | Founder default 25 Nov: any Campaigns access can finish | **OPEN Q1** (server is creator-only) | |
| 9 | Activation: "Public forms, donation pages, invitations, and external communications must remain **unpublished until reviewed and explicitly activated**" | Activate / Return to draft on the campaign page for owners and admins, with the line "Nothing is published yet." | |
| 10 | Discard a draft (PRD silent; server supports it) | Discard with confirm in the Drafts list and the wizard | |

## CW-04: steps 1 to 3

| # | PRD requirement | Screen / component | Evidence |
| --- | --- | --- | --- |
| 11 | Step 1: "What type of campaign are you organizing?" five types with the PRD descriptions (Evangelistic Crusade, Mission Trip, Conference, Local Outreach, Custom Project) | Type cards (radio group) using the PRD wording for each description. The earlier prototype's descriptions are replaced by the PRD's | |
| 12 | Step 1: "Each selection automatically loads an appropriate campaign template with suggested departments, tasks, and features." | Server template on pick; screen says that a type change reloads departments and tools | |
| 13 | Step 2 fields: Campaign Name (Required), Description (Optional), Goal or Mission (Optional) | `form-layout1`/`form-layout11` shaped form: name, description, goal or mission | |
| 14 | Step 2: "Campaign Cover Image or Logo — Optional" | **OPEN Q3**: the server has no cover field. Not built unless a field is added | |
| 15 | Step 2: "Harvest automatically generates the campaign's internal URL and dashboard." | Campaign id URL and dashboard already exist; no field shown | |
| 16 | Step 3 fields: Country, City / Region, Start Date, End Date, Time Zone | Place form; time zone select (no combobox exists on main) | |
| 17 | Step 3: Campaign Structure "Single location / Multiple locations / Online / Hybrid" | Three radio cards with those names | |
| 18 | Step 3: "The user can add specific venues and individual crusade nights later." and multi-location venues/schedules | **Not built** (post-wizard; no venue field exists). The earlier prototype's country/city/venue idea is dropped | |
| 19 | End date not before start date; time zone valid | Client check with the server schema; message "End date is before the start date" | |
| 20 | "Conditional Questions: The wizard should adapt to the chosen campaign type." | **OPEN Q5** | |

## CW-05: steps 4 and 5

| # | PRD requirement | Screen / component | Evidence |
| --- | --- | --- | --- |
| 21 | Step 4: "The administrator creating the campaign automatically becomes the **Campaign Owner**." | Owner row shown (the creator) | |
| 22 | Step 4: "The user can optionally invite additional leaders." with the 13 suggested departments for a crusade | Department cards from the template; add or remove departments; leader and member per department | |
| 23 | Founder 25 Nov: leaders and team members receive invitations they must accept | **OPEN Q2**: needs a server model; delivery stays synthetic and hard-off. Member list from kit `tables9` plus an invite dialog | |
| 24 | Step 4: each department "can receive its own": leader, team members, Kanban board, task assignments, deadlines and milestones, files, budget allocation, progress reporting | Leader and team members only. Kanban, tasks, milestones, files, budget allocation, reporting are **not built** (CW-06 materialisation does not exist on the server) | |
| 25 | Step 4: "Campaign leadership should have access to an overall dashboard covering all departments." | CW-07 | |
| 26 | Step 5: grid of selectable feature cards, the 18 modules by name | Tool cards with `switch-card1` shape, PRD names only, no invented descriptions | |
| 27 | Step 5: "Recommended modules should be automatically selected based on the chosen campaign type." | Template preselection; Recommended badge | |
| 28 | Step 5: "All modules can be enabled or disabled later in Campaign Settings." | **Not built** (no Campaign Settings screen in PRD scope); noted | |
| 29 | AI Campaign Copilot is a module (AI setup deferred, CW-12) | Card visible, off by default, no setup behaviour; label is **OPEN Q4** | |

## CW-06: step 8, Finish, checklist

| # | PRD requirement | Screen / component | Evidence |
| --- | --- | --- | --- |
| 30 | Step 8: "Display a summary of the configuration" (name and type, description, location and dates, owner, departments, enabled modules, budget and currency, fundraising, registration options, QR response form, discipleship and follow-up) | Summary card with every listed item | |
| 31 | "The user can return to any step and make changes." | Edit link on each section; issues list with a link to the step | |
| 32 | "**Final Button:** Finish — Create Campaign" | Finish button, label as in the PRD | |
| 33 | Finish is idempotent ("One campaign per idempotency key") | Double click or retry opens the same campaign | |
| 34 | Missing required fields are blocked with reasons | Server `issues` listed, each with a link back | |
| 35 | After Finish, items 1 to 12 ("Campaign Dashboard", "Project Management", ... "AI Assistant") are initialised | **Not built**: the server creates the campaign row only; materialisation of boards, budget, events, forms and the rest does not exist (CW-06 server part is later) | |
| 36 | "Post-Creation Checklist ... setup checklist showing important unfinished tasks" with the nine example items | `todo-app6`-shaped checklist on the campaign page, derived from known state. Persistent completion is **OPEN Q8** | |

## CW-07: dashboard

| # | PRD requirement | Screen / component | Evidence |
| --- | --- | --- | --- |
| 37 | "Campaign Dashboard: Overview of progress, events, funding, teams, tasks, and readiness" | Stat cards in the style of CRM reports on the campaign page. Only what exists is real; progress, events, funding, tasks are shown as not available, not invented. **OPEN Q6** | |
| 38 | Slice plan: "Manager sees operational overview without Connect metrics or donor PII" | No donor or response data on the page | |

## CW-08: step 7

| # | PRD requirement | Screen / component | Evidence |
| --- | --- | --- | --- |
| 39 | Step 7 options 1 to 6: Public Campaign Registration, Evangelistic Response Form (QR), Free Harvest Account Invitations, Community Discovery, Discipleship Follow-Up, Church Referrals | Six `switch-card1` cards with the PRD names | |
| 40 | Server rules: follow-up, invitations and referrals need registration or the response QR; discovery needs invitations | Dependent cards disabled with the reason | |
| 41 | "Wizard writes configuration + draft unpublished sources" | Configuration only. Draft sources are **not built**, see Q7 | |
| 42 | "Participation is voluntary ... require appropriate privacy protections and consent mechanisms"; opt-ins start unchecked | All six start off; line "Nothing is published or sent yet" | |
| 43 | Tool/step consistency (QR on needs the QR tool, registration needs its tool, fundraising needs its tool) | Review issues with links to the Tools step | |

## CW-09: step 6

| # | PRD requirement | Screen / component | Evidence |
| --- | --- | --- | --- |
| 44 | Step 6 fields: Preferred Currency, Estimated Total Budget, Enable Campaign Fundraising (Yes/No), Fundraising Goal (Optional), Allow Online Donations (Yes/No) | Exactly those five fields. **The earlier prototype's budget category rows and the server `categories` change are removed**: the PRD lists categories only as something the fundraising workspace includes after Finish | |
| 45 | "Allow Online Donations" requires fundraising on; goal only with fundraising | Controls disabled with the reason | |
| 46 | Decision 6 Nov: "Config-only in v1" ; "Payment integration and public donation pages must be reviewed before activation." | Copy says nothing is collected; no provider call | |
| 47 | "General platform fundraising and crusade-specific fundraising must remain separate." | No shared screen or data | |

## Open questions (founder)

1. **Who finishes.** The 25 Nov decision is that anyone with Campaigns access can finish. The merged server lets only the draft's creator finish (and edit). Proposed change in PR 3: finish allowed with `campaigns:write` for any open draft, the campaign owner stays the person who started the draft, version check unchanged. Should others also edit someone else's draft, or only finish it?
2. **Invitations to accept.** PRD step 4 says "optionally invite additional leaders"; the server only places existing ministry members. Needed from you: who can be invited (an email address of someone with no account, or an existing member only), what happens on accept (ministry membership, with which role), expiry, and whether the owner sees pending versus accepted per department. Needs a new table and migration. Delivery stays synthetic and hard-off.
3. **Cover image or logo** (step 2, optional): add a field and use the files module, or defer?
4. **AI Campaign Copilot card label.** The PRD lists it as a module and defers AI setup. Show it as a normal toggle, or with a "later" label?
5. **Conditional questions.** The PRD says the wizard adapts to the type (example: a small local outreach needs no travel planning or large fundraising department). Today only departments and tools adapt. Hide or skip steps for some types, or leave as is?
6. **Dashboard data.** Finished-draft configuration (budget, tools, step 7) is stored on the draft, not on the campaign, and there is no read route from a campaign to it. Add one, or build the dashboard from campaign fields only?
7. **Draft sources in step 7.** "Draft unpublished sources" means creating QR link and form drafts at Finish. Not in the server today; separate slice with Connect, or part of CW-08?
8. **Checklist persistence.** Derive from state only, or store completion per item?

## Not built (so far)

Cover image (Q3), venues and multiple locations (PRD says later), per-department boards, tasks, files and budget allocation, Finish materialisation (items 1 to 12), Campaign Settings module toggles, draft Connect sources, persistent checklist. Reasons are in the rows above.
