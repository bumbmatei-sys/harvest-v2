# Server feature flags

Flags are read on the server at request time. Merging a slice never activates it; only the founder does.

| Variable | Module | Off when | On when |
|---|---|---|---|
| `HARVEST_COMMUNITIES` | Communities (ADR 0013 §11) | `NODE_ENV=production` and the variable is unset or any other value | `enabled`, or any non-production `NODE_ENV` (local development, tests) |

While Communities are off, the owner pages, the public pages (`/communities/:slug` and the member area: forum, posts, members, about), `/discover` and `/account/communities` return not found, the navigation entry and account links are hidden, and every Communities API (owner, join, Discover, invitations, applications, the applicant's own application, forum posts, replies, likes, moderation, member files and forum categories) returns 404 before authentication. A staging deployment built with `NODE_ENV=production` also needs `HARVEST_COMMUNITIES=enabled` to show them.

## Member uploads (PR 4b)

Forum covers and attachments are released only when the file scanner returns `clean`. Outside production a `skipped` verdict is also released so the feature can be developed and tested. In production, uploads stay quarantined until a real malware scanner is wired: an activation gate for Communities.
