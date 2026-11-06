# Harvest — New Campaign Creation Wizard

**Document ID:** HARVEST-CAMPAIGN-WIZARD-PRD-001  
**Version:** 1.0  
**Status:** Proposed / implementation-ready requirements, subject to product and legal review  
**Date:** 2026-11-06 (Europe/Berlin)  
**Owner:** Harvest product team  
**Source:** Matei chat brief, 2026-11-06 (saved verbatim at `/workspace/harvest-v2/campaign-wizard-spec-matei.md`)  
**Suggested repository path:** `docs/prd/harvest-campaign-wizard.md`  
**Parent specifications:** Harvest Master PRD v2.5; Companion Implementation PRD v2.7; [Harvest Connect PRD](harvest-connect-qr-to-discipleship.md); [Connect slices](harvest-connect-slices.md); [ADR 0011](../decisions/0011-harvest-connect.md)  
**Type:** Standalone companion feature PRD — does not supersede the master roadmap or Connect PRD

---

## Overview

When an administrator clicks **+ Create New Campaign**, Harvest should open a guided, multi-step onboarding wizard.

The purpose is to help users configure a new evangelistic crusade, mission trip, conference, outreach, or custom project without manually setting up every feature.

The wizard should have **8 steps**, with **Back**, **Next**, and **Finish** buttons, a progress indicator, and automatic draft saving.

**Target setup time:** 3–4 minutes for the basic configuration. All settings can be modified afterward.

---

## Step 1 — Campaign Type

**Question:** What type of campaign are you organizing?

The user selects one of the following:

- **Evangelistic Crusade:** Large-scale evangelism, church partnerships, volunteers, fundraising, counseling, and follow-up.
- **Mission Trip:** Mission teams, travel, accommodation, fundraising, field activities, and logistics.
- **Conference:** Speakers, sessions, registration, venues, and event management.
- **Local Outreach:** Street evangelism, smaller outreach events, volunteer coordination, and follow-up.
- **Custom Project:** A blank project with customizable features.

Each selection automatically loads an appropriate campaign template with suggested departments, tasks, and features.

**Button:** Next

---

## Step 2 — Basic Campaign Information

**Question:** Tell us about your campaign.

**Fields:**

1. Campaign Name — Required
2. Campaign Description — Optional
3. Campaign Goal or Mission — Optional
4. Campaign Cover Image or Logo — Optional

**Example:**

- Campaign Name: Bangkok Gospel Crusade 2027
- Description: A five-day evangelistic crusade to share the Gospel and connect new believers with local churches.

Harvest automatically generates the campaign's internal URL and dashboard.

**Buttons:** Back | Next

---

## Step 3 — Location & Dates

**Question:** Where and when will your campaign take place?

**Fields:**

1. Country
2. City / Region
3. Campaign Start Date
4. Campaign End Date
5. Time Zone
6. Campaign Structure:
   - Single location
   - Multiple locations
   - Online / Hybrid

The user can add specific venues and individual crusade nights later.

For multi-location campaigns, the platform should support multiple venues, schedules, and geographical areas under one parent campaign.

**Buttons:** Back | Next

---

## Step 4 — Teams & Leadership

**Question:** Who will organize this campaign?

The administrator creating the campaign automatically becomes the **Campaign Owner**.

The user can optionally invite additional leaders.

**Suggested departments for an Evangelistic Crusade:**

1. Campaign Leadership
2. Church Mobilization
3. Evangelistic Outreach
4. Prayer & Intercession
5. Marketing & Media
6. Logistics & Equipment
7. Finance & Fundraising
8. Volunteers
9. Counseling
10. Discipleship & Follow-Up
11. Worship & Production
12. Security & Medical
13. Transportation & Hospitality

Each department can receive its own:

- Department leader
- Team members
- Kanban board
- Task assignments
- Deadlines and milestones
- Department-specific files
- Budget allocation
- Progress reporting

Campaign leadership should have access to an overall dashboard covering all departments.

**Buttons:** Back | Next

---

## Step 5 — Campaign Features

**Question:** Which tools would you like to enable?

Show a grid of selectable feature cards.

**Available modules:**

- Tasks & Kanban Boards
- Departments & Teams
- Events & Check-In
- Volunteer Management
- Church Partnerships
- Church Location Maps
- Outreach Planning
- Social Media & Marketing
- Budget & Expenses
- Fundraising & Donations
- Registration Forms
- QR Code Response Forms
- Discipleship & Follow-Up
- Campaign Calendar
- Documents & File Management
- Communications
- Campaign Analytics
- AI Campaign Copilot

Recommended modules should be automatically selected based on the chosen campaign type.

All modules can be enabled or disabled later in Campaign Settings.

**Buttons:** Back | Next

---

## Step 6 — Budget & Fundraising

**Question:** What is your campaign's estimated budget?

**Fields:**

1. Preferred Currency
2. Estimated Total Budget
3. Enable Campaign Fundraising — Yes / No
4. Fundraising Goal — Optional
5. Allow Online Donations — Yes / No

When fundraising is enabled, Harvest creates a dedicated fundraising workspace inside the campaign.

This should include:

- Fundraising campaigns
- Donation forms and pages
- Donation QR codes
- One-time and recurring donations
- Donor management
- Sponsorships and pledges
- Campaign expenses
- Budget categories
- Budget-versus-actual reporting
- Financial approval workflows
- Fundraising progress
- Financial reports

**Important:** General platform fundraising and crusade-specific fundraising must remain separate.

Donations assigned to a particular crusade should automatically appear in that crusade's budget dashboard after payment confirmation.

Payment integration and public donation pages must be reviewed before activation.

**Buttons:** Back | Next

---

## Step 7 — Registration, Evangelistic Response & Follow-Up

**Question:** How would you like participants to connect with your campaign?

The administrator can enable:

1. **Public Campaign Registration** — Create a registration form for attendees, guests, and participants.
2. **Evangelistic Response Form** — Generate a QR code that can be displayed on the crusade screen. Someone attending the crusade can scan the code and open a mobile-friendly form.
3. **Free Harvest Account Invitations** — After submitting the form, participants can optionally create free Harvest accounts.
4. **Community Discovery** — After registration, users can explore free Christian communities in a Skool/Eden-inspired community directory.
5. **Discipleship Follow-Up** — People can voluntarily request contact from an authorized pastor or counselor.
6. **Church Referrals** — Participants can find participating churches based on location and request an introduction.

### Evangelistic follow-up journey

1. Someone attends the crusade.
2. They scan the QR code displayed on the screen.
3. They complete a short response form, if they choose.
4. They receive immediate access to free Christian resources.
5. They are invited to create a free Harvest account.
6. They discover free Christian communities.
7. They choose a community to join.
8. They can enroll in discipleship courses.
9. If they request personal follow-up, an authorized pastor or counselor is assigned.
10. Their discipleship journey continues through Harvest.

Participation is voluntary. Contact permissions, religious-response information, and church referrals require appropriate privacy protections and consent mechanisms.

**Buttons:** Back | Next

---

## Step 8 — Review & Create

**Question:** Is everything ready?

Display a summary of the configuration:

- Campaign name and type
- Description
- Location and dates
- Campaign owner
- Departments
- Enabled modules
- Budget and currency
- Fundraising configuration
- Registration options
- QR response form
- Discipleship and follow-up settings

The user can return to any step and make changes.

**Final Button:** Finish — Create Campaign

---

## What Happens After Clicking Finish?

Harvest automatically creates the campaign workspace with its selected tools.

Depending on the campaign template, the platform initializes:

1. **Campaign Dashboard:** Overview of progress, events, funding, teams, tasks, and readiness.
2. **Project Management:** Default Kanban boards, task categories, milestones, and timelines.
3. **Departments:** Team structures and recommended responsibilities.
4. **Budget:** Expense categories, financial dashboards, and budget tracking.
5. **Fundraising:** Campaign-specific donation infrastructure and draft fundraising pages.
6. **Events:** Event planning and registration configuration.
7. **Volunteers:** Volunteer recruitment and team assignment tools.
8. **Marketing:** Campaign-specific content calendar and promotional planning.
9. **Response Forms:** Draft registration forms and QR code destinations.
10. **Follow-Up:** A restricted CRM follow-up pipeline and pastor assignment system.
11. **Analytics:** Campaign-specific operational dashboards.
12. **AI Assistant:** Optional campaign-aware assistant with access only to authorized tools and information.

Public forms, donation pages, invitations, and external communications must remain **unpublished until reviewed and explicitly activated**.

---

## Additional UX Requirements

### Automatic Draft Saving

Users should be able to close the wizard and resume later without losing their answers.

### Conditional Questions

The wizard should adapt to the chosen campaign type.

For example, a small local outreach may not need travel planning or a large fundraising department.

### AI-Assisted Campaign Setup

Optionally, users can describe their campaign in natural language.

**Example:**

> We're organizing a five-day evangelistic crusade in Bangkok, expecting 20,000 attendees, with 100 volunteers and 30 partner churches.

The AI can propose:

- Campaign structure
- Departments
- Task lists
- Milestones
- Timeline
- Volunteer requirements
- Budget categories
- Recommended features

The administrator reviews the suggestions before accepting them.

### Post-Creation Checklist

After campaign creation, Harvest should display a setup checklist showing important unfinished tasks.

**Examples:**

- Assign department leaders
- Confirm venues
- Define budget
- Connect payment processing
- Publish registration forms
- Configure the QR response page
- Assign counseling leaders
- Invite partner churches
- Create initial outreach events

---

## Technical Requirements

Use the existing Harvest architecture:

- Next.js and TypeScript
- shadcn/ui wizard components
- Neon PostgreSQL
- Shared CRM records
- Workspace-based permissions
- Campaign-scoped resources
- Reusable campaign templates
- Secure, idempotent campaign creation
- Backend validation and audit logging

Campaigns should share Harvest's core infrastructure rather than creating duplicate CRM, finance, calendar, or community systems.

**Core principle:** A campaign is its own operational workspace, connected to the larger Harvest platform, with dedicated tasks, teams, finances, events, volunteers, communications, and follow-up systems.

The goal is to let an administrator configure a substantial ministry campaign in minutes, while preserving the flexibility to manage complex operations afterward.

---

## Implementation notes (Lead)

Analysis only. Scope of this PR: docs. Repo facts below are `origin/main` @ `3e38d45` unless noted. Matei's product wording above is preserved; this section is Lead build analysis.

### What already exists vs new

| Area | Exists today | Needed for Campaign Wizard |
| --- | --- | --- |
| Workspaces / tenancy | `src/db/schema.ts` (`workspaces`, `workspace_members`), [ADR 0003](../decisions/0003-rls-tenancy.md), routes under `/workspaces/[tenantId]/…` | Nothing new for tenancy: campaigns are **tenant-scoped rows**, not new workspaces |
| Auth | Better Auth email OTP ([ADR 0002](../decisions/0002-better-auth-email-code.md)) | Reuse; no campaign-specific auth |
| Files / R2 | [ADR 0006](../decisions/0006-files-storage.md), `files` table | Reuse for cover image / department files |
| Jobs / outbox | `jobs`, `outbox_events` in `src/db/schema.ts` | Reuse for async activation / invitations |
| CRM on main (CRM-01…04) | contacts, companies, fields/views, pipelines/deals ([ADR 0007](../decisions/0007-crm-companies-and-links.md)–[0009](../decisions/0009-crm-pipelines-and-deals.md); `docs/acceptance/crm-01-02.md`–`crm-04.md`) | Shared contact identity for later follow-up; not required for wizard shell |
| CRM-05 tasks / notes / timeline | Draft [PR #15](https://github.com/bumbmatei-sys/harvest-v2/pull/15), ADR 0010 on `feat/crm-05-tasks-activity` (`crm_tasks`, `crm_notes`, `crm_notifications`; links = person / company / deal **only**) | No `campaignId` / department link today — do not silently reuse as department boards |
| Payments | [ADR 0005](../decisions/0005-dodo-placeholder.md) Dodo placeholder (`DODO_PAYMENTS_API_KEY` reserved; adapter throws). Founder: Stripe closed; Dodo is **platform billing**. No live checkout or donations | Campaign **gift** provider still undecided (open decision 1) |
| Harvest Connect | [Connect PRD](harvest-connect-qr-to-discipleship.md) (PR #17), [ADR 0011](../decisions/0011-harvest-connect.md), [HC-01…20 slices](harvest-connect-slices.md), HC-FIN finance slices, [threat model](../security/harvest-connect-threat-model.md); HC-01 docs merged (#18 @ `3e38d45`) | Wizard **configures** Connect; must not reimplement HC-03–HC-14 / HC-17–HC-18 |
| Campaigns module | **Planned, not implemented.** ADR 0011 lists Campaigns as a canonical planned owner. No `campaigns` table in `drizzle/` on main (migrations through `0017_crm_deal_restore_guard.sql`) | New: `campaigns`, wizard drafts, templates, department records |
| Departments / team boards | None in schema | New campaign-scoped structure (or later CRM extension — open decision 2) |
| Fundraising / donations | None (`fundraising_drives` etc. only conceptual in Connect §21) | Step 6 maps to Connect campaign finance / HC-FIN — not a parallel money engine |
| Companion outreach (§13) | Illustrative only (`outreach_campaigns`, `/ministry/outreach/new`) — **not built** | Do **not** start an `outreach_*` stack; converge on workspace-scoped `campaigns` |
| UI / stack | shadcn only; Next.js App Router; Neon + Drizzle; `AGENTS.md` | Reuse |

**Ownership model (locked by Connect ADR 0011):** workspace → campaign → response sources, using `tenant_id` columns (PRD “workspace_id” names the same boundary). Matei's phrase *“a campaign is its own operational workspace”* means an **operational UX layer** under the parent Harvest workspace — **not** a second `workspaces` row or tenant.

### Overlaps with Connect HC / HC-FIN

| Wizard step | Connect / finance owner | Rule |
| --- | --- | --- |
| Step 5 modules: QR Code Response Forms, Discipleship & Follow-Up, Church Location Maps, Fundraising & Donations | Feature flags / capability toggles that later activate Connect or finance surfaces | Toggle only; no duplicate public intake |
| **Step 6 Budget & Fundraising** | Connect PRD §21 + HC-FIN-01… slices | Campaign-scoped finance, **separate** from General Fundraising; draft drives/pages only; **unpublished** until explicit activation; donation never grants religious-response or follow-up permission |
| **Step 7 Registration / Response / Follow-Up** | HC-03 QR admin, HC-04 landing, HC-05 forms/consent, HC-07–08 accounts, HC-09–12 communities, HC-13 follow-up, HC-17–18 church referral | Wizard writes **configuration + draft unpublished sources**; implementation stays in those HC PRs |
| Post-create “Follow-Up” / “Response Forms” / “Fundraising” init | Same as above | Create **draft / disabled** artifacts only |

ADR 0011: settle Campaigns/Forms contracts before HC-02; **never create a second campaign system**. This wizard PRD is the Campaigns module creation UX that Connect depends on.

### CRM dependencies

- **Not blocked for early CW slices:** wizard shell, drafts, templates, Steps 1–5 capture, idempotent create of campaign + departments + campaign-local task boards.
- **CRM-05 (PR #15)** must merge before treating CRM tasks as the department Kanban (and only after an ADR 0010 amendment if campaign/department links are added). Until then, campaign-local boards are preferred over forcing `crm_tasks`.
- **Connect follow-up → CRM association (HC-06 / HC-13)** waits for verified CRM-05+ identity/erasure and Connect intake — wizard Step 7 must not invent contacts from configuration alone.
- Idempotent Finish must not create CRM contacts, consents, or cases by itself.

### Privacy / consent / unpublished-by-default

Aligned with ADR 0011 and `docs/security/harvest-connect-threat-model.md`:

- Religious-response and pastoral-contact data are purpose-scoped / special-category. Opt-ins start **unchecked** and are separate from account, community, newsletter, and donation choices.
- A scan or draft QR creates **no** contact, subscription, membership, or belief label.
- Public forms, donation pages, invitations, and external communications stay **unpublished** until reviewed and explicitly activated (Matei Finish section + Connect §18 defaults).
- New campaign-scoped tables use FORCE RLS + tenant-composite keys (ADR 0003 pattern).
- Finance permissions and pastoral/response permissions are independent sets (Connect §21.2).

### Architecture conflicts to resolve before coding

1. **“Campaign workspace” wording vs single-tenant workspaces.** Spec UX language vs `workspaces` table. Lead: one parent workspace; campaign is a scoped operational surface (`/workspaces/[tenantId]/campaigns/[id]/…`).
2. **Route / naming:** companion PRD `/ministry/outreach` vs Connect `/w/…/campaigns/[id]`. Lead recommendation: `/workspaces/[tenantId]/campaigns/...` to match Connect ADR 0011 and existing app routes.
3. **Departments vs CRM-05 tasks:** CRM tasks link person/company/deal only (`feat/crm-05-tasks-activity`). Department Kanban needs new campaign-scoped entities **or** an explicit CRM extension — do not invent silent FK hacks.
4. **Donation provider:** platform billing (Dodo placeholder) ≠ campaign gifts; Stripe closed; no live donations exist.
5. **AI Campaign Copilot:** [AI-assistant-architecture.md](AI-assistant-architecture.md) exists; no campaign copilot code. Keep out of first create path.

### Proposed slice plan (CW-01…CW-12)

CW numbering is independent of HC. **“Before CRM done?”** means the slice can start without CRM-05 merged (CRM-01…04 on main are enough). Each CW = one small PR.

| ID | Scope | Depends on | Before CRM done? | Done when |
| --- | --- | --- | --- | --- |
| **CW-01** | Campaigns core schema + RLS under workspace (`campaigns`, draft status, owner, type, location/dates columns); list + empty dashboard shell | ADR 0003 patterns; no Connect runtime | **Yes** | Two-tenant tests; campaign rows isolated; no public routes |
| **CW-02** | Wizard shell at `/workspaces/[tenantId]/campaigns/new` — 8 steps, Back/Next/Finish chrome, progress, shadcn only | CW-01 | **Yes** | All steps navigable; in-memory/local draft state only |
| **CW-03** | Automatic draft saving + resume + create idempotency key | CW-02 | **Yes** | Close/reopen restores answers; Finish with same key is idempotent |
| **CW-04** | Templates catalog + **Steps 1–3** (type, basic info, location/dates) with conditional defaults | CW-03 | **Yes** | Template apply fills draft; Steps 1–3 validate and persist |
| **CW-05** | **Steps 4–5** — departments/leadership invites (memberships only) + feature module toggles | CW-03 | **Yes** | Departments recorded as campaign-scoped structure; modules stored as flags; no Connect/finance side effects |
| **CW-06** | **Step 8 Finish** — idempotent create of campaign + departments + campaign-local boards/tasks/milestones + post-create checklist; everything **unpublished** | CW-04–05; open decision 2 | **Yes** | One campaign per idempotency key; checklist rendered; no public forms/donations live |
| **CW-07** | Campaign dashboard readiness (aggregate shell, department progress placeholders) + acceptance doc for CW-01…06 | CW-06 | **Yes** | Manager sees operational overview without Connect metrics or donor PII |
| **CW-08** | **Step 7** Connect configuration — draft unpublished QR/registration/follow-up/community/referral flags; wires to HC contracts | CW-06; HC-01; Campaigns contract settled for HC-02+ | **No** (also needs Connect HC-02/03 progress for real QR) | Step 7 writes config only; activation remains explicit; no duplicate intake code |
| **CW-09** | **Step 6** budget estimate + fundraising toggles + draft budget categories (no provider calls) | CW-06; Connect §21 policy | **Partial / No for live money** — estimates/categories can follow CW-06; **online donations wait** | Config persisted; donation pages remain unpublished; no checkout |
| **CW-10** | Live campaign fundraising / donations (HC-FIN path) | CW-09; **open decision 1**; HC-FIN-01+ | **No** | Provider webhook reconciles a test gift into campaign ledger only; never into general fundraising by default |
| **CW-11** | Restricted CRM follow-up pipeline wiring for campaign (pastor assignment / cases) | CW-08; CRM-05+; HC-13 | **No** | Cases scoped; no campaign-wide roster; erasure/outbox scrub aligned with CRM-05 B1 lesson |
| **CW-12** | AI-assisted campaign setup (optional NL → draft suggestions) | CW-04; [AI-assistant-architecture.md](AI-assistant-architecture.md); open decision 3 | **No** | Suggestions require human accept; never auto-publish |

**Start now (parallel to finishing CRM-05 / early Connect):** CW-01…CW-07.  
**Wait:** CW-08 (Connect), CW-09 live-donation half + CW-10 (payments), CW-11 (CRM follow-up), CW-12 (AI).

### Top open product decisions for Matei

1. **Campaign gift payment provider** — Dodo platform billing is a placeholder ([ADR 0005](../decisions/0005-dodo-placeholder.md)); Stripe is closed. Use Dodo for donations too, pick another processor, or ship v1 with **budget/fundraising config only** (no live checkout)?
2. **Departments** — new campaign-scoped teams/boards/tasks now (CW-05/06), or wait and extend CRM-05 `crm_tasks` with campaign/department links (requires ADR 0010 change)?
3. **AI-assisted setup** — include a thin CW-12 in the first release train, or keep AI out until after wizard + Connect pilot (Lead default: **later**)?

### Non-goals for this PRD PR

- Docs only: adds `docs/prd/harvest-campaign-wizard.md`. **No app code, migrations, routes, Craft, or ClickUp edits.**
- No second campaign system, no `outreach_*` parallel stack, no second `workspaces` tenant.
- No live payments, no published public pages, no Connect reimplementation, no CRM-06 import/merge work.

