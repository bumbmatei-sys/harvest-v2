# PRD draft: payments to ministries through Stripe Connect

Drafted 27 Nov 2026. **Status: DRAFT for founder review.** Founder direction (27 Nov, G5): build toward Stripe Connect; ministries connect their own Stripe account and money goes straight to them; this needs Stripe's platform approval; Dodo stays for Harvest SaaS billing ([decisions log](../decisions/founder-decisions-2026-11.md#founder-decisions-27-nov-launch-gates)).

This PRD approves no code, migration, provider account, live key, real payment, deployment or activation. It does not settle the HC-02 gates. Nothing here is legal or tax advice.

Read first: [ADR 0012, payment separation](../decisions/0012-payment-provider-separation.md), [ADR 0005, Dodo placeholder](../decisions/0005-dodo-placeholder.md), [launch scope](professional-v1-launch-scope.md), [first eight PRs, Stripe blocker](../plans/professional-v1-first-eight-prs.md), [Connect PRD finance sections](harvest-connect-qr-to-discipleship.md), [pledges](../acceptance/cw-pledges.md), [Ways to give](../acceptance/cw-giving.md), [give page](../acceptance/give-page.md), [free courses and products](../acceptance/free-courses-products.md).

## 1. Goals and non-goals

**Goals**
- A ministry connects its own Stripe account in a few steps.
- Donors give one-time and monthly gifts on the ministry's give page; the money lands in the ministry's own Stripe balance.
- Later, learners buy courses and products from the ministry the same way.
- Gifts flow into the existing giving ledger as provider-confirmed entries, beside the hand-recorded ones.

**Non-goals**
- Harvest never holds or routes donor money through its own merchant account (ADR 0012; first eight PRs blocker).
- No change to Harvest SaaS billing. Dodo stays the provider for ministries paying Harvest.
- No paid courses or products before the founder opens the LLC (founder, 16 Nov: everything is free until then). Product checkout is designed here but ships later.
- No crypto, no cash handling, no in-person card readers in V1.

## 2. Three payment domains (unchanged rule)

| Domain | Provider | Merchant | Adapter | Ledger | Webhook identity |
| --- | --- | --- | --- | --- | --- |
| Harvest SaaS subscriptions | Dodo Payments | Harvest (via Dodo) | `src/server/payments.ts` (contract only today) | SaaS plan and entitlement records | Dodo endpoint and signing secret |
| Donations to ministries | Stripe Connect | The ministry | New `donations` adapter | `giving_ledger_entries` (extended) | Stripe Connect endpoint and its own signing secret |
| Course and product sales | Stripe Connect | The ministry | New `commerce` adapter | New orders ledger | Same Stripe Connect endpoint, separate handlers and idempotency scope |

A Dodo event never creates a gift or an order. A Stripe event never changes a Harvest plan.

## 3. Account type recommendation

Stripe's account types (Standard, Express, Custom) are now also described by "controller properties" (who pays fees, who bears losses, which dashboard). The trade-offs:

| | Standard | Express | Custom |
| --- | --- | --- | --- |
| Who owns the account | The ministry, full Stripe dashboard | Stripe-hosted, light dashboard; platform has more control | Platform builds everything |
| Merchant of record | The ministry | Usually the platform's charges (destination charges) | Platform |
| Losses from refunds and disputes | The ministry (with direct charges) | Platform is liable by default | Platform |
| Stripe fees | Paid by the ministry | Platform pays per-account Connect fees | Platform |
| Onboarding | Stripe-hosted; the ministry may already have an account | Stripe-hosted, short | Built by Harvest |
| Harvest's compliance load | Lowest | Medium | Highest |
| Fit with "money goes straight to them" | Best | Possible, but money flows through the platform | Poor |

**Recommendation: Standard accounts with direct charges.** The ministry is the seller and the recipient of each gift. Funds settle in its own balance. It handles refunds and disputes in its own dashboard. Harvest is never in the funds flow. Many churches already have a Stripe account and can connect it. **Founder decision (27 Nov): Standard accounts with direct charges.** Express is considered again only if Stripe requires it during platform review, with a new founder decision.

## 4. Onboarding

1. Owner or admin with Giving manage opens Operations > Giving > Payments and chooses "Connect payments".
2. Harvest creates a Stripe account link (or OAuth for an existing account). The ministry signs in at Stripe; Harvest never sees bank details or identity documents.
3. On return, Harvest reads the account's `charges_enabled`, `payouts_enabled`, country, default currency and requirements, and stores only those plus the account id.
4. Status shown: not connected, needs information, ready, restricted, disconnected. Product copy stays provider-neutral ("payments account").
5. Disconnect: the ministry can disconnect at any time; give pages fall back to Ways to give.
6. Every connect, status change and disconnect is audited. Only owners and admins can connect or disconnect (sensitive action).

## 5. Donations

- **Where:** the `/give/<slug>` page and a give block on link in bio. Ways to give stays beside it.
- **Checkout:** Stripe-hosted Checkout in `payment` mode (one-time) or `subscription` mode (monthly), created on the connected account (direct charge). No card fields in Harvest.
- **Amounts:** suggested amounts plus a custom amount, in the fundraiser's currency (the existing 16-currency allowlist, integer cents).
- **Donor details:** name and email only as Stripe requires for a receipt; an optional "add me to the ministry's contacts" box, unchecked, recorded as a consent with its notice version. No newsletter or follow-up permission is inferred.
- **Cover the fee:** optional donor choice to add the processing fee (open question 1).
- **Anonymous giving:** the donor can hide their name from public totals (the give page never shows donor names anyway).
- **Recurring gifts:** the donor manages or cancels through a Stripe customer portal link in the receipt.
- **Raised total:** the existing rule stays: the amount shows only once 5 known supporters have given (founder, 26 Nov).

## 5a. Individual missionaries (founder, 27 Nov)

- Individual missionaries can connect their own Stripe account for donations from day one.
- Their give page and checkout show a fixed notice: gifts are personal support for the missionary and are not tax-deductible.
- The notice cannot be edited or hidden, and the receipt email repeats it.
- The ministry type comes from the existing audience setting (`0033_workspace_audience`). The notice is shown for the missionary audience.
- Stripe may still refuse or limit personal fundraising accounts. If it does, Ways to give stays the fallback.

## 6. Course and product checkout (after the LLC)

- Same connected account; Checkout `payment` mode with line items from the canonical catalog (never a second product model).
- Entitlement is granted only from a verified `checkout.session.completed` with `payment_status = paid`, matched to a checkout session Harvest created. Never from the return URL.
- Refund or lost dispute removes the entitlement for that purchase only, never unrelated grants (Communities PRD).
- Community paid tiers (C17, C18) reuse this once unparked.

## 7. Fees

- **Stripe's fees** are charged to the ministry's account (Standard, direct charges). Check Stripe's current pricing for each country; this PRD states no numbers.
- **Harvest platform fee (founder, 27 Nov):** Stripe supports an application fee on direct charges.
  - Donations: **0% Harvest fee.** No application fee is set on donation charges.
  - Course and product sales: **3% Harvest fee**, set as the application fee on each sale, on top of Stripe's own fee. Rounding: whole cents, rounded down (proposed). Refunds: the application fee is refunded in proportion (proposed). Starts only with paid sales, after the LLC.
  - The 3% application fee lands in Harvest's platform balance. It is Harvest revenue and is kept in its own platform-fee records, never in a ministry's giving or orders ledger, and never mixed with Dodo SaaS billing.
- Show the ministry, before it connects, who charges what.

## 8. Refunds and disputes

- The ministry refunds from Harvest (calls the Stripe refund API on its account) or from its own Stripe dashboard. Both arrive as webhooks.
- A refund writes a `reversal` row in the giving ledger that points to the original gift (the existing correction rules: one reversal per gift, exact amount or a partial-refund reason, to extend).
- Disputes: `charge.dispute.created` marks the gift "disputed" (not removed from totals until lost); `charge.dispute.closed` with `lost` writes a reversal. The ministry answers disputes in Stripe; Harvest shows status only.
- Staff can never mark a provider gift as refunded by hand.

## 9. Payouts

- Stripe pays out to the ministry's bank on the ministry's own schedule. Harvest does not set or hold payouts.
- Harvest shows payout status read-only (optional, later).

## 10. Webhooks

- **One Connect webhook endpoint** for events from connected accounts, separate from any Stripe platform endpoint and entirely separate from Dodo. Proposed path: `/api/payments/stripe/connect-webhook`.
- Its own signing secret in the secret store; signature checked with Stripe's scheme and a 5-minute tolerance; the raw body is read before parsing.
- Idempotency: unique `(provider, event_id)`; replays answer 200 without effect.
- Events used: `account.updated`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `invoice.paid` (recurring), `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `account.application.deauthorized`.
- Each event's `account` must match a connected account Harvest has for that ministry; otherwise it is ignored and logged by code only.
- Runs through the worker role; fixed log event names, no payment details in logs.
- Hard-off by a code literal until activation, like the email senders.

## 11. Ledgers

- **Donations:** extend `giving_ledger_entries` (`drizzle/0117_fundraising_pledges.sql`) with a source (`manual` or `provider`), provider name, provider payment id and event id, unique per provider. Provider rows are written only by the webhook definer, never by staff; manual rows keep the "confirmed by the ministry" rule. Raised = net of both, as today.
- **Commerce:** a new append-only orders ledger with order, line, amount, currency, provider ids, status and reversals. No shared table with donations.
- **SaaS:** untouched.
- Money stays in integer minor units with an explicit currency.

## 12. Tax and receipts

- Harvest sends a plain payment receipt email (through the chosen email sender) with ministry name, amount, date and reference.
- **Tax-deductible receipts are the ministry's responsibility.** Rules differ by country (for example the German Zuwendungsbestätigung, UK Gift Aid declarations, US written acknowledgements). V1 lets a ministry add its own receipt wording and charity number; it does not claim a receipt is tax-valid.
- Gift Aid needs a separate declaration from the donor; out of scope for V1 (open question 6).
- Product sales: with direct charges the ministry is the seller and is responsible for VAT or sales tax. Stripe Tax can be turned on by the ministry in its own account; Harvest does not calculate tax in V1.

## 13. Stripe platform approval and restricted businesses

Before any live charge:
1. Apply to Stripe as a platform. Describe Harvest as software for churches and ministries, with Standard accounts and direct charges, where each ministry is the merchant.
2. Check Stripe's current restricted and prohibited businesses list and its rules for donations at application time. Earlier research in this repository noted that crowdfunding and fundraising platforms and third-party creator commerce can need explicit prior approval (`docs/plans/professional-v1-first-eight-prs.md`). We do not claim what the current terms say.
3. Expect questions about: registered charities versus churches without registration, **individual missionaries** receiving personal donations (allowed from day one by founder decision; see §5a), countries, and how Harvest prevents impersonation (the existing takedown tool helps).
4. Get the approval in writing and record it in this file and ADR 0012 before building live paths.
5. Each ministry still passes Stripe's own checks when it connects.

## 14. GoFundMe and Donorbox

Per the 26 Nov decision, GoFundMe and Donorbox are temporary Ways to give kinds. **The PR that ships live Stripe donations removes them**, with founder sign-off on that PR:
- delete them from `givingPlatformHosts` in `src/lib/ways-to-give.ts` and from the messages;
- a new migration turns off or migrates existing rows first, then removes them from the kind check and `giving_url_allowed`;
- their logos go with them (`src/components/giving/giving-logos.tsx`).
All other Ways to give kinds stay.

## 15. Privacy

- The ministry is the controller for donor data; Harvest is its processor; Stripe is a separate controller for payment data it collects (check Stripe's terms) or Harvest's sub-processor for what it does for Harvest.
- Donor data is owner/admin only (as pledges and gifts are today).
- Giving history is never visible to community moderators (Communities PRD).
- Retention: statutory accounting periods apply to gift records; the period is a ministry setting with a default to choose (open question 7).
- International transfers: see `docs/decisions/hc-02-policy-pack.md` §10.

## 16. Slices (proposed)

1. **SP-01** Decision record update (ADR 0012) after written Stripe approval. Docs only.
2. **SP-02** Connected account onboarding and status, hard-off, test mode only.
3. **SP-03** Connect webhook endpoint, signature, idempotency, account matching, test-mode fixtures.
4. **SP-04** One-time donations on the give page; ledger provider rows.
5. **SP-05** Monthly gifts, customer portal link, receipts.
6. **SP-06** Refunds and disputes in the ledger.
7. **SP-07** Remove GoFundMe and Donorbox (with founder sign-off).
8. **SP-08** Course and product checkout (after the LLC).

Each slice: independent review, acceptance record, no live keys until activation approval.

## 17. Founder answers (27 Nov) and open questions

Answered on 27 Nov ([decisions log](../decisions/founder-decisions-2026-11.md#founder-decisions-27-nov-launch-gates)):
- Account type: **Standard accounts with direct charges.**
- Harvest fee on donations: **0%.**
- Harvest fee on course and product sales: **3%**, on top of Stripe's own fee (after the LLC).
- Individual missionaries: **can connect for donations from day one**; their give page says gifts are personal support and not tax-deductible.

Still open:
1. Offer donors "cover the processing fee": yes or no?
2. Gift Aid (UK) and other tax-receipt helpers: later?
3. Default retention for gift records: 10 years, or the ministry chooses?
4. Launch countries for payments: US first (matching the US-first email decision), then EU and UK?
