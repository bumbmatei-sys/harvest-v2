<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

UI uses shadcn components only (npx shadcn add ...); do not build from scratch anything shadcn provides.

## Harvest shared UI architecture

Studio Admin is the founder-approved primary visual reference for the entire application (shell, pages, tables, forms, editors, dashboards and Harvest Studio inbox). Follow `docs/plans/studio-admin-adoption.md`. Use Harvest's existing shadcn primitives and shared architecture; verify upstream file licenses before adaptation. Do not use OpenShadcnBlocks or reintroduce its registry aliases.

Theme direction: faithfully match Studio Admin's default colors, typography, spacing and surfaces first, across light/dark modes. Keep existing Harvest gold tokens available for a later optional theme, but do not make gold the default or add the prior palette shortlist as part of this adoption. See `docs/plans/studio-admin-adoption.md`.

Before UI work, read [the master design-system specification](docs/design-system.md), [the foundation/adoption plan](docs/plans/design-system-foundation.md), `CLAUDE.md`, the relevant module PRD and current acceptance evidence. The specification is a target, not a claim that shared engines already exist.

Search the component registry before generating UI. Until `docs/component-registry.md` is established, search `src/components`, `src/lib/theme-registry.ts`, `src/app/globals.css` and `docs/design/`; record reusable components in the first foundation pass. Extend the existing AppShell, theme tokens and CRM patterns rather than duplicating them. Keep domain permissions, consent and lifecycle rules in their owning services.

Use concise labels and useful placeholders. Do not add routine descriptions below every field (including welcome heading/message); reserve help text for consequential constraints, consent/privacy notices and actionable validation. The planned CRM filter trigger is icon-only, with an accessible “Filters” name/tooltip; its ReUI reference and behavior are recorded in `docs/plans/hc-06.md`.

Adapt external UI sources to Harvest's tokens and shadcn primitives, and record source/license evidence. Do not treat this architectural specification as authorization to enable integrations, payment processing, production intake or invitation delivery, or to merge/deploy.
