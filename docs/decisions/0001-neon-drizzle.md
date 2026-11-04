# ADR 0001: Neon PostgreSQL and Drizzle

Accepted 2026-11-04. Use a dedicated harvest-v2 Neon project with dev/staging/prod branches and checked-in Drizzle schema, SQL migrations and journal. Use pooled app-role traffic and direct owner migrations. Runtime connections support interactive transactions, including over Neon's WebSocket transport. CI migrates disposable databases/branches; the metadata-checked dev exception is explicitly authorized for initial verification. No app startup migrations, schema push, staging deployment, or unrelated-project mutation.
