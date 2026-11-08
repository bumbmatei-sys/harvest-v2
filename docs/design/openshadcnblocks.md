# OpenShadcnBlocks — Harvest UI source

Harvest uses **[OpenShadcnBlocks](https://openshadcnblocks.pages.dev/)** as a selected source of reusable UI patterns and blocks. shadcn/ui remains the foundational component system. Search existing Harvest components first, then this catalog; adapt imports to Harvest tokens, translations, accessibility and domain contracts.

## Installation

OpenShadcnBlocks supplies editable source via a shadcn registry, not a runtime package. The repository installs shadcn CLI as a pinned development dependency and configures these project-local registry aliases in `components.json`:

| Alias | Registry item |
| --- | --- |
| `@openshadcnblocks/<name>` | Component |
| `@openshadcnblocks-blocks/<name>` | Block |

```sh
npm run ui:add -- @openshadcnblocks/empty-search-2
npm run ui:add -- @openshadcnblocks-blocks/hero231
```

These are install examples, not an instruction to add a marketing hero to the authenticated app. Inspect an item's source/dependencies and record its exact license before importing. Never overwrite existing shadcn primitives or global styles blindly. No API key, paid plan, analytics script, external font or remote runtime dependency is needed by this integration.

## Current verification status

The public documentation supplies `/r/component/empty-search-2` and `/r/block/hero231` installation URLs. Registry aliases are configured against those documented patterns. Direct registry retrieval returned HTTP 403 in this execution environment; web retrieval also failed. Therefore actual upstream block source installation and its exact license are not yet verified. The integration must not be described as an installed/working visual block until a successful import is recorded. Do not substitute unverified third-party code or label a local imitation as an upstream import.

The actual `npm run ui:add -- @openshadcnblocks/empty-search-2 --yes` attempt resolved the configured URL but ended with the CLI's “Request was cancelled” error. It added no block or primitive files. The dev dependency, lockfile and registry command are installed; upstream block adoption remains blocked on successful retrieval and exact-source/license inspection.

The homepage advertises public/free source, but its GitHub link resolved to github.com rather than a specific repository during inspection. Record the exact source and license when a selected item can be retrieved; marketing copy alone is not a verified license manifest.

Author checks for this setup: lint, typecheck and production build passed; pinned CLI/lockfile/script/registry-pattern checks passed. A newly created non-author source-review session returned bounded MERGE-OK for the tooling/configuration/documentation delta, with no blocking findings. That reviewer did not execute runtime/browser suites or certify upstream source/license retrieval. The lockfile adds CLI development dependencies and three Babel development patch updates; application runtime dependency declarations are unchanged. No application component, database or global theme CSS was modified.

## Next bounded delivery — Phase 0A

1. Finish the existing-component registry with actual source paths, typed interfaces, states, consumers and licenses.
2. Resolve registry access and inspect/import a small relevant block, such as the filtered-empty state, without replacing existing primitives. Register provenance and connect it to a real consumer or internal showcase before claiming visual adoption.
3. Establish the internal/dev component showcase and shared field/list/editor composition patterns using existing CRM and Connect consumers.
4. Remove routine QR-editor helper paragraphs; use labels/placeholders by default, preserving necessary notices and validation.
5. Preview the requested theme palettes through the current registry; keep the official Harvest default undecided.
6. Validate representative CRM/Connect journeys, both themes, mobile/tablet/desktop, keyboard, axe and overflow. Obtain fresh non-author source review for code changes.
7. Continue HC-06 with the shared icon-only filter popover and existing domain plan. Larger wizard/form/pricing engines remain subsequent bounded slices.

See [master specification](../design-system.md), [foundation plan](../plans/design-system-foundation.md), [theme shortlist](theme-candidates.md) and [HC-06 plan](../plans/hc-06.md). This setup enables no production intake, invitations, payment processing, merge or deployment.
