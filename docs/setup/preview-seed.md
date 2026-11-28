# QA preview seed

Run `npm run qa:preview-seed` after applying the repository migrations to a disposable QA database. Pass `HARVEST_ENV=test` for a loopback `harvest_test` database, or `preview` or `staging` for the corresponding allowlisted database. Set `DATABASE_URL` to that database's `harvest_app` connection in your environment. The command refuses production and databases containing accounts outside the QA domains. It prints counters and fixed error identifiers.

Sign in to **QA Preview Church** for the new examples. Its prayer circle has levels, points, an active challenge, and a forum post with a feeling, location and linked course. The same ministry has volunteer roles, shifts and a pending swap, a published profile with two locations, a disconnected synthetic payment account, a course with a landing page, sale and two reviews, disabled PayPal and bank-transfer methods, a link-in-bio draft, and two newsletter campaigns. The two other QA ministries still contain their original fixtures.

Supply the target app's synthetic `HARVEST_CONNECT_TEST_KEY` to seed the in-memory provider's social connection and external blog destination. For a QA app backed by a local fake S3 endpoint, set `QA_PREVIEW_MEDIA=1` and supply the same `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. The seed accepts only a loopback HTTP storage endpoint on `127.0.0.1`. It uploads local PNG fixtures through the regular media services, then publishes the link-in-bio page with a gallery and countdown. Without fake storage, the forum post has its text and linked course, and the link-in-bio page stays a draft. Keep the fake store running for the app to serve the images.

Rerunning the command preserves the fixture records and their original dates. The existing account bootstrap is still the only direct insert because accounts normally come from the Better Auth sign-in flow.

Set `QA_PREVIEW_NEWSLETTER_WORKER_URL` to the `harvest_worker` connection on the same database and provide the target app's `HARVEST_NEWSLETTER_SUPPRESSION_KEYS` to populate campaign statistics. The July newsletter sends to six synthetic subscribers via the in-memory provider, and the volunteer update stays editable as a draft. The worker claims only the seeded campaign. Without the worker connection, both campaigns stay drafts. Migration 0230 allows the reserved `example.invalid` domain through the synthetic sender checks.

Church directory and staff-assisted Connect fixtures depend on PR 351 and PR 357. Their services and tables are still pending on main.
