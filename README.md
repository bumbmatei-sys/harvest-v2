# Harvest v2

PR 01a / 01b: Next.js App Router, strict TypeScript, Tailwind/shadcn, Drizzle/PostgreSQL, Better Auth email codes, workspaces, roles, append-only audit and transaction-scoped RLS.

Use Node.js 24 and `npm ci`. Copy `.env.example` to an ignored `.env.local` and configure names privately; see [Neon setup](docs/setup/neon.md). Never put secrets in commits or logs.

```sh
npm run lint
npm run typecheck
npm test
npm run test:rls
npx playwright install chromium
npm run test:e2e
npm run build
```

Local tests provision disposable PostgreSQL automatically. CI also tests migrations with a PostgreSQL 17 service. Resend is mocked in integration and browser tests; they send no real emails. `npm run test:rls:neon` explicitly verifies the configured harvest-v2 dev branch and leaves clearly labelled synthetic seed rows there.

For the app, run `npm run dev` after configuring dev credentials. Sign-in requires `RESEND_API_KEY` and `EMAIL_FROM` from the existing verified sending domain. Do not exercise delivery without authorization. No OAuth, passwords, payments integration or deployment is included.

See [architecture](docs/architecture.md), [workflow states](docs/acceptance/pr01a.md), [UI provenance](docs/ui-sources.md) and [license inventory](docs/third-party-licenses.md). PR 01b adds the responsive shadcn shell, searchable/paginated contacts with detail editing and consent evidence, Harvest/Studio brand switching, and independent light/dark mode. Workspace owners/admins can save a default under Appearance; the toolbar offers a local override. Private screens use shared-domain workspace paths. See [PR 01b workflows and evidence](docs/acceptance/pr01b.md) and [screenshots](docs/screenshots/pr01b/README.md).

CRM-01/02 adds People and Companies under `/workspaces/:tenantId/crm/...`: explicit person–company links, normalized tenant-unique domains, inline editing with optimistic versions, URL-backed search, filters and sorting, and audit-backed activity. See [ADR 0007](docs/decisions/0007-crm-companies-and-links.md), [acceptance](docs/acceptance/crm-01-02.md), [screenshots](docs/screenshots/crm/README.md) and the [Twenty/v1 reference notes](docs/research/twenty-crm-reference.md).
