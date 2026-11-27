# Ministry ownership transfer

Working migration `0150_ownership_transfer`.

| Route | Contract |
| --- | --- |
| `GET /api/workspaces/{tenantId}/ownership-transfer` | The caller's pending offer, or `null`. Supply `?offerId=` to read the status of an earlier offer as one of its participants. |
| `POST /api/workspaces/{tenantId}/ownership-transfer` | `{action:"offer",recipientUserId}` creates one pending offer for an active admin. `{action:"accept"\|"decline"\|"cancel",offerId}` acts on that offer. A 409 includes the conflict code. |
| `GET /api/workspaces/{tenantId}/ownership-transfer/notifications` | The caller's in-app notices about the transfer, including the offer ID and unread count. |
| `POST /api/workspaces/{tenantId}/ownership-transfer/notifications` | Marks the caller's notices read with `{ids:[…]}` or `{ids:"all"}`. |
| `GET /api/account/delete` | Returns the blocking ministries and their transfer endpoints. The same details are included with a blocked deletion response. |

A ministry can have multiple owners under the existing model. This operation promotes the accepting admin and makes the offering owner an admin in the same transaction. Other owners retain their roles. A membership revision changes on every write, so canceling a role change later cannot resurrect an offer. Expiry is 14 days. Concurrent decisions are serialized and a second acceptance sees a closed offer.

Transfer history stores IDs, dates and outcomes. The audit ledger contains IDs and an outcome. In-app notifications use the existing ministry notification store, with a transfer target and recipient-only reads. No mail is sent.

Acceptance covers separate ministries, ineligible participants, duplicate offers, expiry, cancellation, decline, role changes, concurrent acceptance, audit, notifications and deletion before and after acceptance. Hosted Neon, real DNS, and the real email provider remain unverified. HC-02 activation gates remain **UNAPPROVED**.
