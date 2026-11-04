# Harvest v2

PR 01a foundation: Next.js App Router, strict TypeScript, Tailwind/shadcn, Drizzle/PostgreSQL, Better Auth email codes, workspaces, roles, append-only audit and transaction-scoped RLS.

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

See [architecture](docs/architecture.md), [workflow states](docs/acceptance/pr01a.md), [UI provenance](docs/ui-sources.md) and [license inventory](docs/third-party-licenses.md). Contacts, dashboard shell, light/dark and brand switching belong to PR 01b.
