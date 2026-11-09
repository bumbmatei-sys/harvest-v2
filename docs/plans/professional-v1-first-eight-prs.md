# Harvest Professional V1 — creator commerce and first eight PRs
**Founder decisions 9 Nov 2026. Documentation-only proposal; no implementation, merge, deployment or production activation.** [Launch scope](../prd/professional-v1-launch-scope.md) prevails over historical sequencing. Preserve all future requirements.

## Audience and six-system interpretation
Target churches, evangelistic organizations, missionary ministries, **individual missionaries and Christian influencers**. One tenant-safe application with creator-owned and organization-owned workspaces; tailored onboarding, terminology and module access, not app forks.

**Communities and Discovery are launch-critical:** Skool-style public discovery of opt-in communities and creators, private/public community spaces, membership/roles, discussions, moderation and long-form native blogs. Communities display storefronts selling **Harvest-native** courses, digital products and paid memberships. Eden-style creation experience means one shared typed wizard/editor and reusable product, checkout and entitlement services across real modules. Do not mix CRM contact, donor, follower, community member and student identities or consent.

**Stripe-first** preferred for platform subscriptions, multi-currency creator commerce and donations, behind provider-neutral payment contracts. **Hard blocker:** Stripe identifies crowdfunding/fundraising and third-party creator commerce platforms as restricted, potentially requiring explicit prior approval; individual donations require charitable purpose, regional eligibility and correct recipient-of-funds. Obtain Stripe's written platform/Connect approval and legal merchant/charity model before live donation, creator payout or marketplace charges. Do not route third-party donations through Harvest's own merchant account as a workaround. Dodo's historical selection is superseded as preferred provider; provider eligibility still needs confirmation. See https://stripe.com/legal/restricted-businesses and https://support.stripe.com/questions/requirements-for-accepting-tips-or-donations .

**Zernio:** priority networks Facebook, Instagram, Threads, TikTok, YouTube (platform count ≠ connected account limit). Include all actually documented and permitted Auto-DM functionality, with per-platform capability gates, consent/opt-out, rate limits and no unsupported cold DM promises. Native community articles can publish/schedule through the Zernio Blogs API to **WordPress, Shopify, Wix, Webflow**; preserve per-destination state, mapping, retries, permissions, SEO and canonical policy. Audit LateWiz and Unified Inbox licensing/dependencies and secure tenant-specific OAuth/account authorization; no vendor secrets in browser. Published API capabilities require sandbox verification.

## Current code evidence / gaps (inventory-level; not runtime-certified)
| System | Existing evidence | Remaining |
|---|---|---|
| CRM | CRM-01..08, contacts/companies/deals/tasks/views/import routes; migrations 0011–0025 | shared filters, HC-06 verified association/source ledger, pilot tests |
| Campaign/Connect | campaigns migration 0021; Connect migrations 0026–0030; campaign pages and QR/landing | full wizard/events/teams, finance integration, HC activation gates |
| Payments/finance | `src/server/payments.ts`, jobs/webhook infrastructure | Stripe eligibility/Connect ADR, donation/commerce ledger, recurring/receipts/budgets |
| Community/discovery | PRD/Connect discovery intent | community models, discovery UI, membership, blog, moderation/storefront |
| Courses/products | prior PRD requirements | product catalog, reusable editor, lessons/progress, checkout, entitlement/delivery |
| Social/inbox/blog | Zernio PRD references | adapter, account linking, scheduler, inbox, Auto-DMs, blog distribution |
| Shared UI | Studio Admin shell, shadcn primitives, CRM list/filter parts | shared filter presentation, typed wizard/editor reused by two real consumers |

**PR #38 is open, not merged; #16 parked.** Previously suggested 34–54 PRs is an unvalidated historical estimate; Discovery/commerce/Blogs/Auto-DMs require re-estimation after architecture and eligibility review.

## First eight proposed implementation PR tickets
**These are future tickets, not opened PRs.** No implementation before planning review. Every PR requires independent review, tests, tenant/permission negative cases, responsive/light-dark/keyboard checks where UI changes, and no merge/deploy without founder approval.

### 01 — Shared CRM list filters
Depends on merged CRM foundations/Studio Admin; reconcile open #38 separately. Extend `src/components/crm/list-page.tsx`, `list-toolbar.tsx`, `filter-builder.tsx`, not a second engine. **Accept:** People/Organizations shared compact accessible filter trigger; authorized field search; staged apply/cancel/clear; saved view/URL persistence; count/export agree; mobile 44px, keyboard, axe, light/dark.

### 02 — HC-06 verified claim → CRM association and provenance
Depends on 01 and existing HC/CRM; follow `docs/plans/hc-06.md`. **Accept:** idempotent verified claim creates/reuses originating tenant contact, account-only path, no new consent prompt, provenance campaign/QR/form/date, source filtering, independent follow-up/newsletter permissions, erasure/withdrawal/RLS tests. Synthetic only; five HC activation decisions still unapproved. Split into smaller PRs if necessary.

### 03 — Creator/organization workspace + community/discovery foundation
Depends on auth/tenancy, Studio Admin. **Accept:** individual creator onboarding without fictitious organization; organization onboarding unchanged; owner/roles; draft community and opt-in public Discovery listing; hidden/private/suspended listings never leak, tenant/RLS/moderation tests; no CRM religious-response exposure. No payment flow.

### 04 — Stripe eligibility and payments/ledger contract
Depends on written Stripe eligibility/Connect/merchant/charity model for actual money flows. **Accept:** decision record for platform subscription vs creator sale vs charitable donation, legal recipients, countries/currencies, refund/chargeback, receipts/tax; provider-neutral adapter and idempotent signed sandbox webhook tests only **after approval**. If approval pending, this PR is **ADR-only** and must not claim payment readiness.

### 05 — Shared creation wizard/editor + Harvest-native product model
Depends on 03 and 04 interface contracts (not live money). Reuse CW-01 patterns, shadcn, Studio Admin. **Accept:** shared Basics→Appearance→Access/Pricing→Review wizard with draft/resume, validation, safe retries, responsive UX and two genuine consumers (community and product); product draft/edit for course, digital download, paid membership; no fake checkout.

### 06 — Community discussions + native article authoring
Depends on 03,05. **Accept:** membership/role-gated posts, moderation, discussion, article drafts/publishing with media/SEO, discoverability and private access; audit/tenant/security tests. Native article is canonical source for future blog distribution.

### 07 — Community storefront and product entitlements (sandbox)
Depends on 04,05,06 and approved payment model. **Accept:** community lists Harvest-created products; sandbox purchase/failed/refunded flows grant/revoke proper entitlements, distinguish membership from product access, protect tenants; creator/student UX tests. Full course progress and donation ledger remain later slices.

### 08 — Zernio capability matrix and secure adapter contracts
Research can run parallel to 01; integration contracts depend on 03 creator tenancy and 06 article model. **Accept:** verified platform-by-feature matrix (five social channels, every eligible Auto-DM trigger, four blog providers), OAuth/secret/permission threat model, quota/pricing and connected-account plan assumptions, LateWiz/Unified Inbox pinned license review, provider-neutral adapter interfaces, mocked webhook/retry tests. No real posts/messages or assumed channel parity.

## Reusable-system architecture and later dependency chain
Shared AppShell/floating sidebar → list/filter engine → owner/role-aware wizard/editor → product catalog/entitlements → Stripe sandbox checkout → community storefront. CRM claim→provenance is a separate consent-safe vertical. Zernio adapter plugs into shared media, publishing jobs and article model; never duplicate article editors or tenant auth. After these eight: complete course lessons/progress, donation finance, campaign events, social scheduler/inbox/Auto-DMs/Blogs API, cross-system pilots, billing and hardening.

## Unresolved approvals
1. Stripe written approval for Harvest **as platform** (creator commerce plus nonprofit fundraising), entity/country, Connect payout flow and donation eligibility; avoid treating Stripe support for a single charity as approval for a crowdfunding platform.
2. Connected-account allowances per subscription tier; five named platforms are not five slots.
3. Specific pilot organizations/individual missionaries/influencers and acceptance criteria.
4. HC-02 activation decisions, real communications, live payments, production security and deployment; no implicit approvals.
