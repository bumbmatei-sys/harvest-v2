# Server feature flags

Flags are read on the server at request time. Merging a slice never activates it; only the founder does.

| Variable | Module | Off when | On when |
|---|---|---|---|
| `HARVEST_COMMUNITIES` | Communities (ADR 0013 §11) | `NODE_ENV=production` and the variable is unset or any other value | `enabled`, or any non-production `NODE_ENV` (local development, tests) |

While Communities are off, the owner pages, the public pages (`/communities/:slug` and the member area: forum, posts, members, about), `/discover` and `/account/communities` return not found, the navigation entry and account links are hidden, and every Communities API (owner, join, Discover, invitations, applications, the applicant's own application, forum posts, replies, likes, moderation, member files, forum categories, reports and the moderation page) returns 404 before authentication. A staging deployment built with `NODE_ENV=production` also needs `HARVEST_COMMUNITIES=enabled` to show them.

## Member uploads (PR 4b)

Forum covers and attachments are released only when the file scanner returns `clean`. Outside production a `skipped` verdict is also released so the feature can be developed and tested. In production, uploads stay quarantined until a real malware scanner is wired: an activation gate for Communities.

The notification bell, its settings and the welcome card (C15a) sit behind the same flag, and their routes under `/api/communities/:slug/notifications` return 404 while it is off. Activation gate: schedule `npm run communities:purge-notifications` daily, next to `communities:purge-applications`, so read notifications are deleted 90 days after they were read. Email (C15b) is backend only and test-mode only: `npm run communities:send-email` refuses to run unless it connects as the dedicated `harvest_worker` role through `WORKER_DATABASE_URL` (`docs/setup/worker-role.md`), `HARVEST_COMMUNITY_EMAIL=test`, `HARVEST_COMMUNITY_TEST_MAILBOX` names a file and the site origin is localhost, and the live sender is hard-disabled in code. Activation gates: provision the worker role, choose and review an email provider, enable the sender in a separate change, schedule the worker every few minutes, and build the unsubscribe page and the frequency control. Until then no community email is sent.
