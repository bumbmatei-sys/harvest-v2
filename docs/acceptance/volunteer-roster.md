# Volunteer roles and roster

Working migration `0161_volunteer_roster`.

| Route | Contract |
| --- | --- |
| `GET /api/workspaces/{tenantId}/volunteers?from=YYYY-MM-DD&to=YYYY-MM-DD` | Returns roles, dated slots with needed and filled counts, assignments, requests and availability. Members see their own assignments, requests and availability. Owners and admins also see CRM volunteers and staff notes. |
| `POST /api/workspaces/{tenantId}/volunteers` | Staff actions are `role`, `volunteer`, `slot`, `assign`, `remove`, `approve`, `reject` and `reminder`. Members can use `signup`, `availability`, `swap`, `decline` and `withdraw`. The named replacement answers a swap with `accept_swap` or `decline_swap` and a `requestId`. |
| `GET /api/workspaces/{tenantId}/volunteers/notifications` | Returns the caller's in-app assignment, change and swap-request notices and data-only reminders. |
| `POST /api/workspaces/{tenantId}/volunteers/notifications` | Mark the caller's notices read with `{ids:[…]}` or `{ids:"all"}`. |

A slot may link to an event from the same ministry. Dates use the ministry time zone. Assignment and sign-up return `unavailable` and `double_booked` warnings when applicable. The server still accepts the assignment if capacity permits. Staff approve or reject swap and decline requests; a swap needs the replacement's acceptance first (below). Archived roles and their slots are hidden from the member roster. CRM-only assignments contribute to filled counts without exposing the person.

Reminders are in-app records with a due time. There is no installed schedule or email delivery. Hosted Neon and real providers remain unverified. HC-02 activation gates remain **UNAPPROVED**.

## Swaps: the replacement accepts first (founder decision 27 Nov)

Previously, approving a swap assigned the named replacement at once and only sent them a `volunteer_assigned` notice. Now:

1. A swap request stays `pending` and sends the named replacement a `volunteer_swap_requested` notice. The replacement sees the request in their roster (`requests`, with `replacementAcceptedAt`) and answers with `accept_swap` or `decline_swap`.
2. **Chosen order: the replacement must accept before staff can approve.** Approving an unanswered swap returns 409 `awaiting_replacement`. Staff can still reject it at any time, and the requester can withdraw it.
3. If the replacement declines, the request closes as `declined`, the requester gets a `volunteer_changed` notice and the original assignment stays.
4. Only the named replacement can answer. The requester, staff, or any other member get the neutral 404.
5. The swap happens only when staff approve an accepted request. Membership, active role, same-slot conflict, capacity (counted without the requester's place) and the unavailable and double-booked warnings are all checked again at that moment.

All writes stay in the `volunteer_change` definer under its transaction-tied grant and advisory lock. The new notice kind is added inside the migration's existing `crm_notifications` constraint drop and re-add, and `volunteer_notice_guard` is unchanged. This PR has no roster screen, so Accept and Decline are API actions only.
