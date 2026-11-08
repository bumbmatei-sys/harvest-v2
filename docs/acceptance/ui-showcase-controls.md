# Phase 0A continuation 1 — showcase and control contracts

Baseline main: d651bbe (PR #36). Implements delivery 1 of docs/plans/phase-0a-completion.md. No new dependency, database schema, authorization grant or domain service change.

## Reused systems and real consumers

The route `/dev/ui` composes the existing AppShell and canonical shadcn controls. A small typed metadata index references real source and consumers; direct examples demonstrate actions, fields, overlays and feedback with synthetic local state. There is no generic form/page renderer, alternate shell or claimed universal engine. Business compositions remain linked inventory entries rather than mock production implementations.

The new `responsive` text Button size is 44px below 1024px and 36px desktop. It is used by shared People/Organizations toolbar filter/sort/columns and saved-view actions. Search group height matches. Connect admin actions retain existing 44px heights; shell icon actions retain PR #36's shared variant. Compact chips, filter-panel actions, menu rows and dense grids retain their contextual sizes. This is not an all-controls migration.

## Exposure boundary

`uiShowcaseEnabled` accepts only development plus `HARVEST_UI_SHOWCASE=1`. The server page checks it before session lookup/rendering; production and disabled development requests return 404. Enabled development requires the normal authenticated session. No production navigation link, fixture API, CRM/Connect record read, upload, provider send or domain write. The only user information used is the existing session email for the real AppShell.

## Evidence

Author validation: lint/typecheck passed; all 297 unit tests passed; production build passed with HARVEST_UI_SHOWCASE=1. Fresh HTTP requests to the production server returned 404 with the flag enabled and disabled. The disabled development browser case passed, including an authenticated request. Enabled showcase and populated CRM03 filter/custom-field/saved-view regression passed 2/2. The existing responsive shell regression also passed. Browser coverage includes fixture actions/validation/search/category selection, overlay focus return, mobile open-overlay bounds/axe, no API writes from examples, five widths in light/dark and 44/36px example/CRM toolbar geometry. Final capture rerun results are recorded in the PR. Unit guards do not substitute for actual HTTP/browser checks.

Source and license: existing canonical shadcn primitives under the repository MIT notice; original Harvest compositions/metadata. No external block imported. See docs/component-registry.md for actual coverage and deliberate exceptions.

QR copy and richer appearance previews are delivery 2. Optional palettes, shared filter redesign, HC-06, wizard/editor/form engines and production activation remain separate. No merge/deployment authorized.
