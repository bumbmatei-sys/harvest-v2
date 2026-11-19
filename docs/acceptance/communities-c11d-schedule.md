# C11d deletion worker schedule and alerts

The worker timer template runs the existing 30-day channel and DM sweep daily at 03:00 UTC. A missed invocation runs after the timer restarts. The service requires `HARVEST_CHAT_PURGE_WORKER_ENABLED=1` and a development, test, or Preview environment; either production environment marker stops execution before the pool opens. It uses `WORKER_DATABASE_URL` and verifies the unprivileged `harvest_worker` login on the connection.

The worker journal records a metadata-only `community_chat_purge_alert` with reason `failed` or `backlog`. Backlog means a lane used its complete batch budget without observing an empty batch and may have more work. Either alert returns a nonzero exit code. The database retains the existing failure record when available, and successful batches commit even when a backlog alert is recorded. No outbound notification is configured.

The templates use a dedicated `harvest` system account, a checkout under `/srv/harvest`,, a Node installation with `npm` on the service path, and an operator-managed `/etc/harvest/chat-purge.env`. Review these settings and provision persistent journal storage for the non-production runner before enabling the timer. Inspect records with `journalctl -u harvest-chat-purge.service`.

No migration. The timer has not been installed or enabled, and no remote worker database was contacted. All five HC-02 gates remain **UNAPPROVED**.
