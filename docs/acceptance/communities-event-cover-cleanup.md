# Event cover cleanup worker

## Behavior

The worker consumes only due `events.cover_cleanup` outbox entries. It matches the record to retired metadata in the same ministry and event, obtains the object key from that metadata, and checks the canonical event under a lock. A current cover is never eligible for deletion. A successful storage deletion removes the file row and sets `dispatched_at` in one database transaction. Storage failures leave the row and outbox record for retry. If object deletion succeeds and the database transaction fails, repeating the object deletion is safe.

Pending and uploaded intents older than 24 hours from creation are retired and entered in the same cleanup queue. This exceeds the five-minute signed upload lifetime. An event accepts at most ten unresolved intents across all managers. Confirming an intent as ready or quarantined frees a slot, as does retiring an abandoned intent. The worker leaves ready unattached images and quarantined images outside the abandoned-intent rule. An outbox record with no matching retired metadata stays pending for investigation without a storage operation.

Migration `0068_event_cover_cleanup` adds the upload-cap trigger and worker-only functions. The generic dispatcher leaves all `events.%` records alone. Other Events kinds remain reserved. This PR depends on #152 and #153 and continues the member-profile and catalog migration stack.

## Non-production operation

The CLI requires `HARVEST_EVENT_COVER_CLEANUP_ENABLED=1` and `WORKER_DATABASE_URL` for the unprivileged `harvest_worker` login. It exits before opening a database or storage in production. Configure any permitted non-production storage credentials through the existing `S3_*` environment variables. `check` reports due work without constructing the storage client.

Run `node --import tsx scripts/event-cover-cleanup.ts check` or `node --import tsx scripts/event-cover-cleanup.ts run` in an authorized non-production environment. Each run retires up to 50 abandoned intents and attempts up to 50 cleanup records. Exit 1 and these redacted JSON lines indicate a failure or remaining due work.

```json
{"event":"event_cover_cleanup_alert","reason":"failed"}
{"event":"event_cover_cleanup_alert","reason":"backlog"}
```

No machine configuration, timer or schedule is part of this PR. All five HC-02 gates remain **UNAPPROVED**. Hosted Neon, real object storage and hosted operation are outside verification scope.
