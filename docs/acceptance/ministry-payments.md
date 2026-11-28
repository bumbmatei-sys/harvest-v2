# Ministry payments foundation

Migration `0146_ministry_payments`. Standard connected accounts are the merchant for direct charges. The fake provider works only with the explicit non-production fixture switch. Live processing and the Connect webhook stay hard-off.

| Route | Contract |
| --- | --- |
| `GET /api/workspaces/{tenantId}/payments` | Owners and admins see account readiness and conservative payment settings. `canManageAccount` is true only for the owner, so a screen hides the connect, sync and disconnect actions from admins. |
| `POST /api/workspaces/{tenantId}/payments` | Only the owner can request an onboarding link with a request key, sync status or disconnect. Owners and admins can set a synthetic price for an existing course or product. |
| `POST /api/public/ministries/{tenantId}/payments/checkout` | Signed-in fixture checkout. Send a request key and a one-time or monthly donation amount, or a course or product ID for server pricing. |
| `GET /api/workspaces/{tenantId}/payments/ledger` | Owners and admins read a ministry's append-only provider facts. Refund, fee and dispute records can arrive before the related charge and reconcile by payment or charge reference when the charge arrives. |
| `GET /api/account/donation-receipts` | The donor's own receipts with amount, currency, date, ministry legal name and the missionary tax notice flag. |
| `POST /api/account/donation-receipts/{receiptId}/manage` | Request-key-protected synthetic management link for the donor's monthly gift. |
| `POST /api/payments/stripe/connect-webhook` | Dedicated Connect identity and signing secret. The live route returns 404. Synthetic verification exercises signature age, tampering, event replay and idempotent append. The event inbox stores only IDs and fixed outcomes. |

The central fee table sets donations to 0% and sales to 3%. Fees round down to an integer minor unit. The receipt is data only. The provider ledger records synthetic payment facts separately from hand-recorded fundraising totals. Checkout does not change entitlements, public giving totals or SaaS billing. Applying verified donations to public fundraising totals and creating purchase entitlements require their own reviewed integration with the existing domain rules. Monthly gifts are included because the PRD calls for them.

| Open founder decision | Current behavior |
| --- | --- |
| Donor covers processing fees | Off. |
| Gift Aid and tax-receipt helpers | Off. |
| Supported payment countries | Empty live allowlist. Synthetic country values only. |
| Application fee rounding | Round down within the minor unit. |
| Refund policy and application fee refunds | Refund initiation off. Record only verified provider reports. Proportional fee refunds need a decision. |
| Who reads the breach log | Access off. |
| Gift record retention | Still to decide before live records. |

Hosted Neon, the live provider contract, live payment methods and the recurring provider event mapping remain unverified. Paid sales also depend on the LLC. No real funds, messages, webhook deliveries or provider calls were used. HC-02 activation gates remain **UNAPPROVED**.

## Payout account write path (founder decision 27 Nov)

The independent review found that the app role had INSERT and UPDATE on every column of `ministry_payment_accounts` under an owner-or-admin policy, so an app session could rewrite where money goes (`account_id`, `provider`) or claim provider status (`charges_enabled`, `payouts_enabled`, `requirements_due`, `disconnected_at`). Changed:

- The app role has no INSERT or UPDATE on `ministry_payment_accounts` or `ministry_payment_onboarding`. Connect, sync and disconnect run through `ministry_payment_account_change`, a SECURITY DEFINER with a pinned search path, the explicit `app.*` clear list (`blog_scope_clear` and `account_self_reset`) with saved and restored settings, the per-ministry advisory lock and a transaction-tied grant.
- Founder decision 27 Nov: **only the owner** can connect, sync or disconnect the payout account. The definer checks the owner membership itself, and the server route returns the neutral 404 for admins. Admins keep read access to account readiness and the ledger, and can still set prices.
- `account_id` and `provider` are set only at creation. A guard trigger refuses any change to them (or to `tenant_id`), even from the table owner. A reconnect must use the same provider and account ID.
- Status columns are written only by that definer or by `ministry_payment_record_event`. The definer accepts a synced status only for the synthetic provider; a live provider's status will arrive only as a verified event.
- Prices: the app may insert a row and change only `amount_minor` and `currency` (column grants). A guard trigger keeps `tenant_id` and `item_id` fixed.
- `ministry_payment_record_event` now refuses any session user other than `harvest_worker`, matching the blog worker functions.

This PR has no payment screens, so there is no visible control to hide yet; the first screen must use `canManageAccount`.
