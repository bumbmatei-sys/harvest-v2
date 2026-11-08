# Phase 0A — Studio Admin foundation

Baseline: main `32ebe7d32d9d482bcc2aa8011bbba515a2ed601f` (PRs 34/35). Scope: existing AppShell, floating Sidebar, header/gutters and central neutral theme tokens. No new framework, packages, schema, services or domain workflow changes.

Source audit and license mapping: [UI sources](../ui-sources.md#phase-0a--studio-admin-shell-baseline). [Reusable inventory](../component-registry.md). Real consumers are CRM People/Organizations/detail/tasks and Campaigns/Connect administration. Public pages inherit semantic tokens but keep their separate PublicFrame and resource/consent boundaries.

Saved preference IDs and API/database constraints are preserved. Both existing IDs now use the approved baseline; legacy palettes are archived, not offered as new selectable themes. No 12 optional themes added. Neutral OKLCH source values are rounded to sRGB for the existing hex contrast tooling. Domain success/warning/destructive colors retain Harvest’s accessible semantics.

The shared sidebar uses the existing desktop floating/icon variant and mobile Sheet. Its existing responsive breakpoint remains 1024px (tablet drawer), avoiding a second sidebar/state system. Header toggle is available in both desktop and mobile. No upstream app, RBAC, mock data, telemetry or provider integrations copied.

Validation in progress: lint, typecheck, unit suite, production build, responsive shell and Connect editor browser regressions. Final results will be recorded before delivery. Source review is separate from author runtime evidence.

Remaining Phase 0A work: internal component showcase, typed navigation registry, broader shared control sizing, concise QR field-copy cleanup and richer theme previews. Phase 0B/C wizard/editor/form engines and HC-06 are not delivered by this PR.

Compatibility note: the account menu and public theme controls still recognize the historical Harvest/Studio aliases for existing local preferences. Both use the same neutral baseline; Appearance settings offers one baseline preview. The richer picker is deferred. This temporary presentation is not a claim of two distinct new palettes.

Accessibility adaptation: light muted text uses a slightly darker neutral than upstream to pass AA on secondary surfaces; dark secondary uses the upstream neutral level. The mobile Sheet explicitly restores focus to its connected opener after closing. The existing layout regression contract now accounts for the header toggle and 24px top gutter.
