# Phase 0A — Studio Admin foundation

Baseline: main `32ebe7d32d9d482bcc2aa8011bbba515a2ed601f` (PRs 34/35). Scope: existing AppShell, floating Sidebar, header/gutters and central neutral theme tokens. No new framework, packages, schema, services or domain workflow changes.

Source audit and license mapping: [UI sources](../ui-sources.md#phase-0a--studio-admin-shell-baseline). [Reusable inventory](../component-registry.md). Real consumers are CRM People/Organizations/detail/tasks and Campaigns/Connect administration. Public pages inherit semantic tokens but keep their separate PublicFrame and resource/consent boundaries.

Saved preference IDs and API/database constraints are preserved. Both existing IDs now use the approved baseline; legacy palettes are archived, not offered as new selectable themes. No 12 optional themes added. Neutral OKLCH source values are rounded to sRGB for the existing hex contrast tooling. Domain success/warning/destructive colors retain Harvest’s accessible semantics.

The shared sidebar uses the existing desktop floating/icon variant and mobile Sheet. Its existing responsive breakpoint remains 1024px (tablet drawer), avoiding a second sidebar/state system. Header toggle is available in both desktop and mobile. No upstream app, RBAC, mock data, telemetry or provider integrations copied.

Author validation: lint, typecheck, all 290 unit tests and production build passed. The added secondary-surface contrast assertion also passed in the targeted theme rerun. All 7 browser cases passed: five Connect editor workflows, the existing full-width layout case, and the new responsive shell case. The shell case checks CRM/Connect at 360/390/768/1280/1440px in light/dark (20 captures and axe scans), no document overflow, desktop collapse/expand and mobile Escape/focus restoration. Captures are in `docs/screenshots/studio-foundation/`; the layout case also refreshes its existing captures. Author visually inspected mobile Connect light/dark and desktop CRM light. This is not physical-device or full populated-CRM certification. Source review is separate from author runtime evidence.

Remaining Phase 0A work: internal component showcase, typed navigation registry, broader shared control sizing, concise QR field-copy cleanup and richer theme previews. Phase 0B/C wizard/editor/form engines and HC-06 are not delivered by this PR.

Compatibility note: the account menu and public theme controls still recognize the historical Harvest/Studio aliases for existing local preferences. Both use the same neutral baseline; Appearance settings offers one baseline preview. The richer picker is deferred. This temporary presentation is not a claim of two distinct new palettes.

Accessibility adaptation: light muted text uses a slightly darker neutral than upstream to pass AA on secondary surfaces; dark secondary uses the upstream neutral level. The mobile Sheet explicitly restores focus to its connected opener after closing. The existing layout regression contract now accounts for the header toggle and 24px top gutter.

## Independent button and regression follow-up

A newly created reviewer inspected delivery `5651f817cade55c107387d5ab9cac9dccd8d2ea6` and independently measured shell actions in Chromium. It confirmed inconsistent peer sizes (account/theme/header toggle 44px versus adjacent footer toggle/notifications 32px). The correction adds one canonical shadcn Button `icon-responsive` size: 44px below 1024px, 36px on desktop, used by all five shell actions. SidebarTrigger now respects its size prop without a conflicting class override.

The reviewer independently verified all five controls at 36×36px expanded/collapsed at 1280/1440px, and 44×44px at 360/390/768px. No collapsed clipping was found. Probe/source/geometry/screenshots: `docs/screenshots/studio-foundation/button-review/`. This bounded review does not certify every application control or workflow bug-free.

The historical PR01b regression has been updated for Geist, neutral surfaces, floating shell, visible desktop header toggle and single-baseline appearance, retaining persisted legacy preference/API, consent, tenant isolation and erasure checks. Its rerun found selected-background avatar initials below AA (4.15:1); shared AvatarFallback now uses foreground text so both People and Organizations inherit the correction. The reviewer source-checked this fix. Permanent responsive action-size assertions cover expanded, collapsed and drawer-open states.
