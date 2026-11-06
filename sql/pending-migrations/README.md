# Pending migrations (staged SQL)

SQL here belongs to a slice whose drizzle migration number is not free yet. It is **not** a drizzle migration: there is no journal entry or snapshot, and `npm run db:migrate` never applies it. The test harness (`tests/database.ts`) applies each `*.sql` file here once, after all real migrations, so integration tests and the Playwright server run against the slice's tables.

- `crm07.sql`: CRM-07 contact associations. It waits for CRM-06 (#21), which takes 0022 and 0023. Once #21 is merged, this file becomes migration 0024: drizzle-kit generates the DDL, and the rest moves into a custom migration rebased onto 0023's `erase_contact` and `merge_contacts`. The file is then deleted.
