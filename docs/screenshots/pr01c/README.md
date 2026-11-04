# PR 01c — shadcn auth UI evidence

Captured 2026-11-04 from the passing Chromium Playwright run, using disposable local PostgreSQL and the development-only mocked Resend provider. Addresses and codes in these screenshots belong to local test fixtures. No outbound email was sent.

- [Sign-in code step, desktop (1280 × 720)](sign-in-code.png)
- [Sign-in code step, mobile (390 × 844)](sign-in-code-mobile.png)
- [Rejected code with accessible error feedback](sign-in-code-error.png)

Installed the official New York v4 `input-otp`, `field`, `empty`, and `button-group` components (including their `separator` dependency) with `npx shadcn@latest add input-otp field empty button-group --yes`, using CLI 4.23.0. Kept the existing Button and Label files, used the existing local `cn` helper, and retained individual Radix imports. Sources, adaptations, and dependency licenses are recorded in [the UI source register](../../ui-sources.md) and [the license inventory](../../third-party-licenses.md).

The `src/` audit replaced manually composed form fields with Field/FieldGroup, sign-in status text with Alert, the sign-in action row with ButtonGroup, and the workspace empty state with Empty. Existing controls, cards, and error boundaries already use shadcn primitives. Remaining native elements provide document structure, form submission, list semantics, and typography. The standing shadcn rule is recorded in `AGENTS.md`.

The six-slot code field accepts numeric input and native paste, supports `autocomplete="one-time-code"`, and has an associated label, linked status/error messages, and invalid-state feedback. Submission remains explicit and is disabled until six digits are present. Server/auth behavior, API routes, schema, migrations, and delivery configuration are unchanged by this follow-up. The companion PRD and its founder overrides were read from remote `main`, where that document was added after this branch's base.

Validation:

- `npm run lint`: passed with zero warnings.
- `npm run typecheck`: passed.
- `NEXT_TELEMETRY_DISABLED=1 npm run build`: passed.
- `npm test`: 6 unit tests passed.
- `npm run test:rls`: 27 integration tests passed, using the real local `harvest_app` role and mocked email delivery.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/harvest-playwright npm run test:e2e`: 2 Chromium journeys passed. Covers label focus, numeric filtering, maximum length, incomplete-code submission, backspace/clearing, rejected-code feedback, native clipboard paste, resend cooldown, change-email reset, session creation, workspace persistence, and logout. Axe reported zero violations on the initial sign-in, desktop/mobile code entry, code error, and populated workspace screens; mobile screenshots have no horizontal overflow.
- React component review: stable hook ordering, direct imports, semantic labels, explicit busy/invalid states, and no server-only imports into the UI.

No merge, deployment, live database migration, or outbound email was performed.
