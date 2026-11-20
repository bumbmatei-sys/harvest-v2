> **Approved execution update — 9 November 2026:** Professional V1 launches for churches, ministries/nonprofits, and evangelists/missionaries on the same architecture. Creator-specific audiences/onboarding, public Discovery, native articles, community storefronts and external blog distribution are **Post-launch**, preserving their specifications for later. Core courses/digital products, checkout/delivery and community/group workflows remain Launch V1 [checkout and paid access deferred per the 16 Nov exception: all courses and products are free until the founder opens an LLC]. **Zernio is the API provider only: do not reuse or adapt its frontend implementations.** Build original, polished Harvest scheduler/inbox UI with Studio Admin, shared shadcn components and a Harvest-owned integration layer. Shared CRM filters are the authorized first implementation slice, followed by HC-06 in separate PRs. PR #43 and its independent security review are a separate infrastructure task and do not block authorized product work on separate branches. No merge, deployment or production activation is authorized. Dodo SaaS billing and undecided commerce/donation providers remain unchanged. See [approved delivery plan](../plans/professional-v1-audit-proposal.md). **Superseded in part by the 16 Nov 2026 scope exception in this file:** email/calendar/files, newsletter, link in bio, website builder, native blog articles and blog distribution, documents/spreadsheets and the AI assistant are now in launch scope; each still needs its own PRD and review. The 16 Nov exception approves no deployment, activation, provider contract or HC-02 decision.

# Harvest V2 — Professional V1 launch contract (founder-approved, 2026-11-09)

> **Founder payment clarification (2026-11-09; supersedes Stripe-first language elsewhere in this file):** Harvest **SaaS subscriptions = Dodo Payments (confirmed)**. Harvest-native **creator product/paid community sales = provider undecided**. **Donations/fundraising for churches, ministries and missionaries = provider undecided**. The latter two may use the same or different providers. Stripe is a candidate, not selected; verify platform fundraising/Connect, recipient country and legal eligibility before integration. Earlier 'shop' referred to **Whop**, not Dodo; do not treat the founder's Whop donation concern as a Dodo restriction. Keep three distinct financial flows and shared provider-neutral interfaces. See [payment decision ADR](../decisions/0012-payment-provider-separation.md).

> **Founder addendum (2026-11-09):** Launch audiences also include **individual missionaries and Christian influencers/creators**. Communities include **Skool-style public Discovery**, native articles, and embedded storefronts for **Harvest-created courses/digital products/memberships** using shared Eden-style creation and entitlement components. Preferred payment provider is **Stripe-first**, conditional on written approval of the platform's creator-commerce and nonprofit fundraising/Connect model, country eligibility and funds flow. Social priorities are Facebook, Instagram, Threads, TikTok, YouTube; support all documented eligible Zernio Auto-DMs. Zernio Blogs distribution targets WordPress, Shopify, Wix and Webflow. Five platforms do not imply five account slots. Full traceability, blockers and first eight PRs: [`../plans/professional-v1-first-eight-prs.md`](../plans/professional-v1-first-eight-prs.md). This addendum supersedes narrower audience/communities/social descriptions below, without adding a seventh system.

**Status:** Approved product boundary; NOT evidence of completed implementation or approval to deploy. **Authority:** This document governs initial paid launch scope when older PRDs conflict on release timing. Older requirements remain valid for later phases unless explicitly superseded. Craft roadmap carries the same decision.

## Audiences and product shape
Launch for **churches**, **ministries/nonprofits**, and **evangelists/missionaries**. One multi-tenant application, shared domain systems, reusable UI, tailored organization onboarding, terminology and module visibility. Studio Admin is the visual baseline; floating sidebar. Do not fork the app per audience.

## Six and only six launch systems

| System | Minimum customer-completable V1 workflows | Exit evidence |
| --- | --- | --- |
| 1. CRM / contacts / members / follow-ups | Tenant-safe create/import/search/segment contacts, profiles, tags, history, assign and complete follow-ups; link campaign decisions and donor records without conflating consent | Import + dedupe + assigned follow-up E2E; tenant/permission and consent tests |
| 2. Donations / fundraising / finances | One-time and recurring gifts, donor history, campaign goals, receipts, reconciled payment statuses, basic income/expenses and budgets, campaign-linked finance | Successful/failed/refunded payment webhook and ledger/receipt E2E; tenant isolation |
| 3. Evangelistic campaigns / events / outreach | Multi-step campaign creation, draft/review, events, locations, team/participant roles, decision intake, explicit-purpose CRM follow-up, campaign budgets and fundraising | Organizer creates and runs campaign, captures consent-aware decision, assigns follow-up, sees budget; production intake activation separately gated |
| 4. Communities / groups / discipleship | Create/manage groups, membership and roles, posts/discussions, moderation, consent-aware follow-up connections | Create/join/post/moderate E2E with cross-tenant and role checks |
| 5. Courses / training / digital products | Create/publish courses and lessons, enroll and track learners, free/paid access, digital product checkout and delivery [checkout and paid access deferred per the 16 Nov exception: all courses and products are free until the founder opens an LLC] | Author publish, student enroll/pay/consume/progress E2E; entitlement/refund tests |
| 6. Social media / unified social inbox | Connect accounts, compose with media, schedule/publish, calendar/queue, platform-specific options, status/error recovery, **Auto-DMs where provider-supported**, supported conversations/comments, replies and filters | Realistic sandbox integration tests for connection, scheduled publish, failure, inbox reply, Auto-DM eligibility; per-platform support matrix |

The above is **minimum proposed workflow detail** to validate against existing PRDs and pilot customers; it does not silently approve a new data model or override privacy gates. Narrow to the smallest safe customer-completable implementation where needed.

### Zernio contract
Zernio is the selected unified social provider. Integrate via **Harvest-owned adapter**, not vendor calls scattered through UI/domain logic. Audit API docs, supported channels, account OAuth/token handling, quotas, billing economics, webhooks, Auto-DM triggers/consent and message capabilities. Validate licenses and reusable code in [latewiz](https://github.com/zernio-dev/latewiz) and [unified-inbox](https://github.com/zernio-dev/unified-inbox) before copying/adapting. Match Studio Admin and Harvest's permissions; no assumption of cross-platform feature parity. Provider branding stays out of end-user UI. Unsupported Auto-DM or inbox functions require explicit founder decision, not fictional implementation.

## Platform-wide launch gates
- Tenant isolation/RLS, authorization and privacy/consent, auditability and safe retention/deletion; existing HC-02 five activation decisions remain **unapproved**.
- Auth, organization onboarding for all three audiences, roles, billing/subscriptions, reliable payment processing and webhook idempotency.
- Shared AppShell, floating sidebar, Studio Admin tokens, responsive light/dark, reused page/list/editor/wizard/form components proven with actual V1 consumers. Avoid building speculative universal engines.
- Background jobs, retries, logs/alerts, backups/recovery, secure media, accessible keyboard/mobile UX.
- Each approved workflow passes E2E, negative-permission, cross-tenant and failure-state tests; pilot users complete workflows without critical defects.
- No production activation, real outbound communications, migration/deployment, merge, or release without founder's separate approval.

## Explicitly post-launch (preserve in PRDs)
Advanced AI assistants/agents [AI assistant now in launch scope per the 16 Nov 2026 exception; still needs its own PRD/review] and automation builders (remain post-launch); connected email/calendar/files [now in launch scope per the 16 Nov 2026 exception; still needs its own PRD/review] and omnichannel messaging outside approved social inbox (remain post-launch; a single inbox combining email and social is not covered by the 16 Nov exception); ad management; sophisticated social analytics/listening; link-in-bio [now in launch scope per the 16 Nov 2026 exception; still needs its own PRD/review] and funnel/website builders [website builder now in launch scope per the 16 Nov 2026 exception; still needs its own PRD/review] unless validated as a blocking dependency (funnel builders are not covered by the 16 Nov 2026 exception); advanced accounting/payroll; extensive customization and additional product types. Not named above but now in launch scope per the 16 Nov 2026 exception, each still needing its own PRD/review: newsletter, native blog articles and blog distribution, and documents/spreadsheets. The 16 Nov exception approves no deployment, activation, provider contract or HC-02 decision. All 12 selected palettes and Harvest Gold are future selectable themes, not canceled. Other older PRD P0/P1 labels do not override this release contract.

## Scope freeze / exceptions
No seventh launch system. An exception requires documented pilot customer adoption/payment blocker, or security/compliance/reliability/data-integrity necessity, or a missing part of an approved workflow. Record evidence, smallest viable solution, dependency/PR estimate, launch delay and founder approval. A nice-to-have is not sufficient.

## Scope exception, 16 Nov 2026

**Recorded founder direction, not an approval.** This section records the founder's 16 Nov 2026 direction to extend launch scope beyond the six systems above. It approves no deployment, production activation, provider contract, real outbound communication or payment activation, and it does not settle any of the five HC-02 activation decisions, which all remain **UNAPPROVED** (`docs/decisions/hc-02-activation-gates.md`). Each item below still needs its own PRD, review and acceptance record before implementation. Where an item overlaps the "Explicitly post-launch" list above, this direction takes precedence for that item only.

Items added to launch scope:
- **Email, calendars and files** through the Zernio provider layer: Gmail and Outlook mail, Google and Microsoft calendars, Google Drive and OneDrive files. Each admin connects their own mailbox.
- **Newsletter**: provider Amazon SES (founder decision 20 Nov, replaces Plunk); email-only consent purposes already exist. Resend remains for sign-in and community mail.
- **Link in bio** and **website builder**.
- **Native blog articles**, scheduled in the social scheduler and sent via Zernio to WordPress, Wix, Shopify and Webflow.
- **Documents and spreadsheets.**
- **AI assistant**: its own mode and a right-hand pane, deeply integrated with Harvest actions behind permissions, approvals and audit. Plugins via Composio.
- **Social**: composer, calendar planner, unified inbox, and Auto-DM on Instagram and Facebook, all through Zernio.

Commercial and build constraints:
- **No paid features** until the founder opens an LLC. All courses and products are free for now; coupons and checkout come later.
- **Donations**: the workaround will come from the founder. Donation provider remains undecided.
- **Build order**: (1) shell with three modes (Operations, Public, Assistant) plus a pane; (2) finish Operations; (3) Public: social and blog, link in bio, newsletter, free courses and products; (4) website builder; (5) full assistant.

## Dependency-ordered delivery plan (planning estimate, not implementation proof)
0. **Reconcile** main/open PRs and migrations, existing PRDs and Craft. Classify existing work as merged / open / partial / absent; document blockers and release gates. Do not merge parked PR #16 or presume open #38 merged.
1. **Shared release foundation:** finish bounded Phase 0 reusable shell/list/filter/wizard/editor patterns driven by actual consumers; auth/roles/tenant isolation, onboarding, billing, observability.
2. **CRM + campaign integration:** build on merged CRM-01..08 and HC/CW foundations; complete HC-06 and consent/provenance requirements before enabling real intake.
3. **Donations + campaign finance:** payment reconciliation, receipts, recurring gifts, campaign budgets and fundraising.
4. **Communities + courses/products:** share membership, entitlements, wizard/editor/checkout primitives without mixing distinct lifecycles.
5. **Social + inbox via Zernio:** audit provider and frontend reuse first; adapter, account linking, publishing, inbox, eligible Auto-DMs, failure handling.
6. **Hardening + pilots:** cross-system E2E, privacy/security, billing, responsive UX, monitoring, pilot signoff and explicit activation decisions.

Parallelize only after contracts are settled. PR counts and durations must be estimated **after repository gap audit**; do not invent completion percentages.

## Repo reconciliation snapshot (checked 2026-11-09)
- Main at `a59fe1bfb25e6f564474f682f46ceadeb4935cea`; PR #37 merged. Open PR #38 is UI copy/theme preview work, **not merged** at this snapshot; PR #16 is parked.
- Existing CRM foundation, Connect and CW-01 work is documented in `CLAUDE.md` and acceptance records; foundation ≠ full launch-complete module.
- Phase 0 shared engines and multiple approved V1 domain systems remain unverified as complete. This document creates no runtime features.
- Existing PRD-v2.5's creator-first release order and v2.7's wide scope are **historical/future vision** where they conflict with this six-system paid launch.
- Follow `CLAUDE.md` for review, migration, CI, no-merge and no-deploy safeguards.

## Engineering instructions
Before any new implementation PR: read this contract, `CLAUDE.md`, `docs/design-system.md`, relevant PRDs, acceptance and open PRs. Produce a requirements-to-code gap matrix and dependency-ordered PR plan, distinguishing known evidence from assumptions. Present contradictions for founder approval. Do not delete future features or claim scope decisions are completed engineering.

## Scope exception, 20 Nov 2026 (Ads)

**Recorded founder direction, not an approval.** On 20 Nov 2026 the founder asked for paid ads (Meta Ads and Google Ads first, other networks later) inside the Social media system because the social provider exposes them through its API. It is recorded as part of the social system, not a seventh system, and still needs its own PRD review (`docs/prd/public-mode-social-discover-navigation.md` section 5.5), independent review and acceptance records. It approves no deployment, real ad account, spend, provider add-on, outbound communication or payment activation; the five HC-02 decisions stay **UNAPPROVED**. Ministries use their own ad accounts and ad-network billing; Harvest handles no ad payments.
