# Volunteer roles and roster

Working migration `0161_volunteer_roster`.

| Route | Contract |
| --- | --- |
| `GET /api/workspaces/{tenantId}/volunteers?from=YYYY-MM-DD&to=YYYY-MM-DD` | Returns roles, dated slots with needed and filled counts, assignments, requests and availability. Members see their own assignments, requests and availability. Owners and admins also see CRM volunteers and staff notes. |
| `POST /api/workspaces/{tenantId}/volunteers` | Staff actions are `role`, `volunteer`, `slot`, `assign`, `remove`, `approve`, `reject` and `reminder`. Members can use `signup`, `availability`, `swap`, `decline` and `withdraw`. |
| `GET /api/workspaces/{tenantId}/volunteers/notifications` | Returns the caller's in-app assignment and change notices and data-only reminders. |
| `POST /api/workspaces/{tenantId}/volunteers/notifications` | Mark the caller's notices read with `{ids:[…]}` or `{ids:"all"}`. |

A slot may link to an event from the same ministry. Dates use the ministry time zone. Assignment and sign-up return `unavailable` and `double_booked` warnings when applicable. The server still accepts the assignment if capacity permits. Staff approve or reject swap and decline requests. Archived roles and their slots are hidden from the member roster. CRM-only assignments contribute to filled counts without exposing the person.

Reminders are in-app records with a due time. There is no installed schedule or email delivery. Hosted Neon and real providers remain unverified. HC-02 activation gates remain **UNAPPROVED**.
