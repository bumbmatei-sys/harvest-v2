# Ministry payments foundation

Working migration `0160_ministry_payments`. Standard connected accounts are the merchant for direct charges. The fake provider works only with the explicit non-production fixture switch. Live processing and the Connect webhook stay hard-off.

| Route | Contract |
| --- | --- |
| `GET /api/workspaces/{tenantId}/payments` | Owners and admins see account readiness and conservative payment settings. |
| `POST /api/workspaces/{tenantId}/payments` | Owners and admins can request an onboarding link with a request key, sync status, disconnect, or set a synthetic price for an existing course or product. |
| `POST /api/public/ministries/{tenantId}/payments/checkout` | Signed-in fixture checkout. Send a request key and a one-time or monthly donation amount, or a course or product ID for server pricing. |
| `GET /api/workspaces/{tenantId}/payments/ledger` | Owners and admins read a ministry's append-only provider facts. Refund, fee and dispute records can arrive before the related charge and share its provider payment reference. |
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
