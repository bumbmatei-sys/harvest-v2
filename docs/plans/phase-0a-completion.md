# Phase 0A continuation — showcase, controls and appearance

Planning only. Baseline: merged PR #36, main `d651bbe8b907d7a3f4afbcade444b384a590da97`. Follow the master design-system specification, Studio Admin adoption plan, component registry and existing acceptance records. This plan continues those systems; it introduces no competing shell or application architecture.

## Outcome

Give developers and agents a reliable place to inspect existing UI and its states, prevent mismatched controls within action groups, and simplify QR/appearance presentation before shared page/filter work for HC-06. Do not declare all Phase 0A or Phase 0 complete from these two PRs: typed module navigation and other remaining foundation work retain their own scope.

## Delivery 1 — internal showcase and control contracts

### Access and data boundary

- Proposed route: `/dev/ui`, explicitly enabled with `HARVEST_UI_SHOWCASE=1` and unavailable when `NODE_ENV=production`, regardless of the flag. Apply the guard server-side before rendering fixtures. No production navigation entry.
- Require an existing authenticated session; unauthorized development requests use the existing sign-in flow. The route is development tooling, not a new application role or production admin feature.
- Use fixed synthetic fixtures. No reads of CRM/Connect personal records, production providers, uploads, sends or domain writes. A demo interaction may change local fixture state only and must be identified as a component example.
- Reuse the existing AppShell where shell context is shown; never create a separate demo sidebar. Keep fixture configuration isolated from production navigation/services.

### Initial coverage

| Group | Existing components/patterns | States to demonstrate |
| --- | --- | --- |
| Actions | Button, ButtonGroup, Tooltip | Primary/secondary/outline/ghost/destructive; text/icon; idle/busy/disabled; same-row sizing |
| Fields | Field, Input, Textarea, Select/NativeSelect, Checkbox, RadioGroup | Label, optional description, placeholder, required/invalid/read-only/disabled; error association |
| Overlays | Dialog, AlertDialog, Sheet, Popover, Command/menu | Open/close, Escape, initial focus, focus return, viewport bounds |
| Feedback | Alert, Empty, Skeleton, Badge, Avatar | Loading, no records, no search results, permission denied, error/retry, success, selected-background contrast |
| Existing compositions | CRM list/toolbar/detail and Connect draft/preview state patterns | Representative synthetic content; no copied business workflow or claimed universal engine |

- Use the same registry identifiers in docs and showcase entries. A small typed metadata index contains ID, category, source path, description and consumer links; component examples remain direct typed imports. Avoid a schema-driven renderer for arbitrary JSX.
- Provide category navigation and simple client-side search over metadata. Do not add a new search service, package or Storybook application.
- Start with these high-use components; label inventory-only entries honestly. Do not imply all 35 primitives have interactive coverage if they do not.

### Control contract

- Retain the merged `icon-responsive` contract: 44×44px below 1024px, 36×36px desktop for shell icon actions.
- Document text-action, icon-action, field and compact-table exceptions. Controls that are peers in the same row must have aligned heights, icon sizes and vertical alignment; unrelated controls need not all have identical dimensions.
- Use existing Button variants first. Add a shared responsive text-action variant only where at least two real consumers need it. Do not blanket-enlarge every desktop button or shrink mobile controls.
- First production consumers: shared CRM People/Organizations toolbar and Connect administration action rows. Preserve established Connect 44px actions, primary/secondary hierarchy and domain behavior. Decide each mismatch from measured geometry, not class-name counts alone.
- No global override that silently changes calendar cells, pagination, menu items, dense grid actions or disabled controls. Record intentional exceptions and check target spacing/keyboard access.
- Extend the registry with actual consumers and supported states. Describe implemented contracts, not future engines.

### Acceptance

- Production guard returns 404 with the development flag both absent and present; disabled development route also returns 404. Enabled route requires authentication. Test guard behavior without broadening authentication or adding a public fixture API.
- Showcase examples use canonical imports, semantic tokens and localized user-facing copy. No literal color palette or new dependency.
- Every demonstrated interactive example works locally and has appropriate accessible name/state. No fake production action or success message.
- Geometry assertions cover peer controls, shell expanded/collapsed/mobile drawer, CRM and Connect real consumers. Verify widths 360/390/768/1280/1440 in light/dark; no document overflow. Menus/dialogs must fit and return focus.
- Exercise populated, selected, invalid and disabled states as well as empty pages. Include the avatar/secondary-surface contrast regression found during PR #36 review.

## Delivery 2 — QR copy and useful appearance previews

### Concise QR copy

- Edit the existing next-intl catalogue and existing Field compositions; do not add a form engine or wrapper solely to delete descriptions.
- Remove routine helper paragraphs below welcome heading and welcome message, including obsolete aria-describedby references. Keep useful placeholders and existing server/client length limits.
- Shorten internal-name/public-title descriptions where needed. Preserve public/private distinction, meaningful URL constraints, privacy/consent notices, independent choices and actionable validation.
- Do not change saved content, immutable published snapshots/notices, validation contracts, publication permissions, draft protection, QR lifecycle or intake activation.

### Appearance

- Replace abstract skeleton-only previews with small examples of existing card/text/button/field/status styles. These are static visual previews with no focusable decorative controls or portal overlays.
- Show the approved Studio Admin baseline in light and dark. Reuse existing theme-registry values and theme mechanics; do not add palettes, theme IDs, DB migrations or persistence changes.
- Keep preview selection independent from saving a workspace default or changing a user's preference. A preview must not mutate the document theme, localStorage or workspace merely on hover/focus.
- Align the account/public appearance controls with the single available visual baseline. Keep accepting persisted Harvest/Studio IDs internally; avoid presenting identical aliases as distinct new visual themes. Preserve system/default mode behavior and saved legacy preferences.
- Keep light/dark switching available and functional. Avoid an enabled save action that cannot produce a change; retain API permission checks even where the presentation becomes read-only baseline information.
- Remove obsolete warm/gold/two-palette claims. The 12 approved future palettes and optional Gold remain deferred.

### Acceptance

- Keyboard and screen-reader checks for labels, descriptions, error association and preview controls. No dangling IDs after copy removal.
- Preview tokens match actual application components in both modes; decorative examples do not enter the tab order. Test storage blocked/invalid preference, system mode, reload and workspace/user preference precedence.
- Existing owner/admin/viewer API authorization remains enforced. No accidental setting writes while previewing or mounting.
- QR editor save/publish/conflict/unsaved navigation and guest resource behavior pass. Purpose choices remain independent and unselected; real collection/delivery stay disabled.

## Validation and review for each PR

1. Run lint, typecheck, unit checks relevant to touched contracts, production build and generated offline checks when token/source generation changes.
2. Run targeted Playwright journeys for the real consumers. Delivery 1 includes responsive shell/control/overlay checks; Delivery 2 includes appearance preference and Connect editor/public-resource regressions. Use disposable database and mock delivery only.
3. Save realistic screenshots and geometry/axe results in a dedicated evidence directory; preserve historical evidence. Inspect captures, rather than treating file creation as visual approval.
4. Use a newly created independent review session at the exact application head. Ask explicitly for sizing, populated/selected-state contrast, keyboard/focus, production exposure and domain regressions. Separate independently executed evidence from author tests.
5. Record reused systems, two real consumers for any new abstraction, deliberate exceptions and remaining work in acceptance/registry docs. CI must pass before requesting merge. Merge and deployment require separate authorization.

## Next after these deliveries

Reconcile remaining Phase 0A gaps, then deliver shared resource-list/filter presentation as a separate bounded slice: icon-only Filters trigger, searchable fields, staged Apply/Cancel, compact active rules and existing saved views. Use existing server predicates for rows/count/export; do not implement HC-06 source provenance in a cosmetic filter change. HC-06 follows its own domain plan once its required shared UI is ready. Wizard, EditorShell, form engines, inbox integration and optional theme rollout remain separate consumer-led workstreams.
