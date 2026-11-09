# ADR 0012 — Separate Harvest SaaS subscriptions from creator commerce and donations

**Status:** Founder-confirmed billing separation, 2026-11-09. **No new payment processor approved for commerce or donations.** Supersedes blanket Stripe-first language in PR #40 documentation without rewriting history.

## Decision
| Financial flow | Provider status | Customer/recipient | Required contracts |
| --- | --- | --- | --- |
| **Harvest platform subscriptions** | **Dodo Payments — confirmed** | Harvest bills tenant/workspace for SaaS access | Dodo subscription, billing lifecycle, webhook idempotency, workspace plan/entitlement |
| **Harvest-native creator commerce** | **Undecided**; Stripe is a candidate | Creator/organization sells course, download or community membership to customer | Merchant/marketplace model, country eligibility, creator onboarding/payouts, refunds, taxes, access entitlements |
| **Donations / fundraising** | **Undecided**; Stripe is a candidate | Church, ministry or missionary receives donor funds | Donation processor eligibility, charity vs individual fundraiser distinction, legal recipient, receipts, recurring gifts, refunds, fund segregation |

Founder clarified that earlier “shop” meant **Whop**; concern about religious-organization donations referred to **Whop**, not Dodo. Do not assert a verified Whop policy without checking current provider terms. Do not conflate Dodo's SaaS subscription suitability with eligibility to collect donations for third parties.

## Architecture
- Three distinct payment domains and financial records; a provider-neutral payment boundary where useful, **without pretending providers share the same funds-flow/merchant semantics**.
- Dodo SaaS subscription webhooks affect Harvest workspace plan/feature entitlement **only**; never create donor receipts or creator purchases.
- Creator purchase webhooks affect order, payout and product/community/course entitlement; donation webhooks affect gift, donor receipt, designated fund/campaign and finance ledger. All are signed, idempotent, scoped, auditable and replay-safe.
- UI never receives secret API keys; tenant authorization on each checkout/webhook reconciliation; currency and tax/receipt rules per transaction/recipient.
- No third-party money processing, charity receipting or payout routing before legal entity, geography, terms and written provider/platform approval are validated.

## Changes to first eight PRs
- **PR-04** becomes **payments separation and provider eligibility**: document Dodo SaaS contracts and actual existing implementation, creator/donation rail alternatives, provider-neutral event model, decision gates. Implement only Dodo subscription sandbox tests where already eligible; **no speculative Stripe checkout or donation flows**.
- **PR-05** may define provider-agnostic product catalog/pricing/entitlement models, with no live checkout.
- **PR-07** creator storefront can implement browse and free entitlement first; paid sandbox checkout only **after** a provider and merchant/payout model are approved.
- Campaign fundraising/donation processing stays gated until donation provider approved; no false launch-complete claim.

## Open decisions
1. Creator commerce processor and merchant-of-record/marketplace architecture, currencies, countries and payout handling.
2. Donations processor(s) for registered charities **and** individual missionaries, recurring giving, charitable receipt and funds designation.
3. Whether one approved provider can support both rails or separate providers are needed.
4. Dodo subscription implementation and webhook/entitlement readiness must be audited; confirmed provider choice is not proof of complete code.

No merge/deployment/real payments authorized by this ADR.
