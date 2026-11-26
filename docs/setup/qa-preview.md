# QA preview: fake data and test sign-in (QA-1, QA-2)

Fake data and a test-only sign-in for a preview or staging copy of the app. Synthetic data only: every account is
`<uuid>@example.invalid` (a reserved, undeliverable domain), every name is invented, nothing is sent anywhere. Nothing
here approves any HC-02 gate, a deployment or production use. The earlier Vercel-preview seed (`npm run qa:seed`,
[acceptance](../acceptance/qa-preview-seed-and-sign-in.md)) is unchanged.

## QA-1: seed fake data

```
HARVEST_ENV=staging DATABASE_URL='<harvest_app connection string>' npm run qa:preview-seed
```

What it creates, in three fake ministries (church, nonprofit, evangelist), each with an owner, admin, member and viewer
(12 people, `Avery Sample 01` to `Parker Sample 12`):

| Area | Records |
| --- | --- |
| CRM | 6 contacts per ministry, 4 with newsletter email consent |
| Communities | 2 published, unlisted communities (not in Discover), 5 members each, 4 discussions with 2 replies each, 6 chat messages, 1 private message |
| Campaigns | 2 campaigns from the wizard (budget and fundraising settings), 4 board tasks and 1 milestone each, 1 published event linked to each |
| Fundraising | 1 open fundraiser per campaign, 3 pledges and 2 recorded gifts |
| Newsletter | 1 audience and list per ministry, 4 subscribed contacts |
| Social | 1 test account and 2 drafts in the church ministry, only when `HARVEST_CONNECT_TEST_KEY` is set to the target app's synthetic key; otherwise reported as `"social":"skipped"` |

How it behaves:

- **Real services.** Every record is created by the app's own server functions acting as the fake user, so permissions,
  row-level security, audit rows and rate limits apply as in real use. The one direct write is the account row, which
  sign-in would otherwise create.
- **Repeatable.** Fixed names and derived ids; each step looks for its record first. A rerun prints the same counts and
  writes nothing, not even an audit row.
- **Fails closed.** It refuses unless `HARVEST_ENV` is `test`, `preview` or `staging`, `NODE_ENV`/`VERCEL_ENV` are not
  `production`, the login is `harvest_app` (no owner, superuser or row-security bypass) and the host and database are on
  the committed list in `src/server/qa-preview-gate.ts` (`test`: a local `harvest_test*` database only). It also refuses a
  database holding any account outside `example.invalid`, `qa.harvest.invalid` or `example.test`.
- **Output.** Counts as JSON, or one error identifier (`QA_SEED_ENV_REFUSED`, `QA_SEED_TARGET_REFUSED`,
  `QA_SEED_ROLE_REFUSED`, `QA_SEED_NON_SYNTHETIC_USERS`, ...). Never a connection string, name or address.
- It reads only `HARVEST_ENV`, `DATABASE_URL` and the optional `HARVEST_CONNECT_TEST_KEY`, never `.env` files.

### Seeding the Cloudflare staging copy

Done by the coordinator, not by a building session.

1. Add the `cf-staging` Neon endpoint host to `qaSeedDatabases` (`stage: "staging"`, database `harvest`) in a reviewed
   change. Until then the seed refuses staging, by design: the host is not recorded in this repository.
2. Use the `harvest_app` connection string for that endpoint (the one Hyperdrive uses), never the owner's.
3. Check the branch is at the current migration (the seed uses tables up to the latest merged migration).
4. Run the command above. Run it again to confirm the counts do not change.

Seeded people can then sign in on staging through the normal sign-in form; their codes go to the synthetic mailbox
helper (`tests/cf07/run-staging.ts` shows how to read one). Look up an address with the owner's read-only query, for
example `select email from users where name = 'Avery Sample 01'`.

## QA-2: test sign-in shortcut

`POST /api/qa/sign-in` with header `x-qa-preview-token: <token>` and body `{"email":"<uuid>@example.invalid"}` signs that
seeded account in and returns `204` with the session cookie. Nothing is emailed.

```
curl -i -X POST "$ORIGIN/api/qa/sign-in" -H "x-qa-preview-token: $QA_PREVIEW_TOKEN" \
  -H 'content-type: application/json' -d '{"email":"<uuid>@example.invalid"}'
```

In Playwright, `page.request.post("/api/qa/sign-in", { headers: { "x-qa-preview-token": token }, data: { email } })` puts
the cookie in the browser context (see `tests/e2e/qa-shortcut.spec.ts`).

Where it is open:

| Runtime | Open when |
| --- | --- |
| Cloudflare Worker | `HARVEST_ENV=preview` (or `local`) and the Worker secret `QA_PREVIEW_TOKEN` is set |
| Local Node server | `HARVEST_ENV=test`, a loopback `BETTER_AUTH_URL`, a local `harvest_test*` database and `QA_PREVIEW_TOKEN` (the browser test server sets all four) |

Everywhere else it answers `404`. On a `staging` or `production` Worker the `QA_PREVIEW_TOKEN` secret makes the whole
Worker refuse to start (`worker_configuration_invalid`, `503`), so it cannot be switched on there by mistake. Whether the
permanent staging site may carry the shortcut is an open founder decision; today it cannot.

Rules it keeps:

- The token is at least 32 characters, distinct from every other secret, compared in constant time, set only as a Worker
  secret (`wrangler secret put QA_PREVIEW_TOKEN`) and never in the repository, CI, Worker config or `.env.example` (a
  source guard enforces this).
- It goes through the normal OTP endpoints: per-IP limits, the 60-second address cooldown, hourly and daily caps, a
  hashed single-use code, a normal session and the `auth.sign_in` audit row, marked `qa_test_sign_in: "shortcut"`.
  A second attempt for the same address within a minute gets `429`.
- It refuses (`422`) any address outside `@example.invalid` and any address with no account. It never creates accounts.
- Responses are `no-store` and `noindex`. Logs say `qa_shortcut_sign_in` or `qa_shortcut_refused`, never an address.
- It is never reachable on the production origin: the request origin must equal the Worker's own origin, and a preview
  Worker's origin can never be the production one.
