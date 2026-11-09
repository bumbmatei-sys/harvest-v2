# Phase 0A continuation 2 — concise QR copy and appearance previews

Stacked on delivery 1 (PR #37, f118842). This is delivery 2 of docs/plans/phase-0a-completion.md, not all Phase 0A or the broader engines.

## Changes and reuse

- Existing Connect LandingEditor fields keep their labels, placeholders, length limits, validation and input state. Routine heading/message helper paragraphs and their aria-describedby references are removed. Internal/public QR descriptions are concise; the public-title personal-details warning and privacy/publication/URL constraints remain.
- Shared ThemePreviews composes existing Card, Input, Button and Badge in scoped static Light/Dark examples. Explicit preview-mode selectors prevent a dark page from overriding the light example. Decorative content is inert/aria-hidden, with noninteractive accessible figure captions and no portals. No global mode, localStorage, workspace or domain write occurs when inspecting a preview.
- A root-mounted ThemeRuntime owns device-mode/storage subscriptions; mobile mode updates no longer depend on a mounted sidebar footer. It reconciles any change between bootstrap and hydration, while controls subscribe only to the existing theme-change event.
- AppearanceMenu and public ThemeControls now offer System/Light/Dark. Legacy Harvest/Studio IDs remain accepted in storage, the bootstrap/resolver and existing settings API. No new palette, schema or migration; no saved preference rewrite. `applyTheme` accepts an explicit System request so it also works with blocked storage.
- AppearanceForm is honest read-only baseline information rather than a one-option radio and unusable save form. Existing server authorization for workspace appearance writes is unchanged and tested via API.

## Boundaries

No auth/tenant/domain-service, draft/publication, consent, immutable snapshot, QR availability or intake activation change. No new dependency or copied third-party source. The canonical semantic registry and existing mode subscription remain the source of truth. Optional palettes, shared filter redesign, HC-06 and wizard/editor/form engines remain separate.

## Validation

Final author browser validation after the root-runtime correction: all nine cases passed (appearance 2, Connect editor 5, populated CRM/consent/permissions/erasure 1, theme/profile persistence 1). The focused preview case measured nested rendered Card/Badge/Button/Input colors under both global modes, validated inert semantics/no writes and captured 360/390/768/1280/1440px in light/dark with clean axe/overflow. Screenshots and CRM/theme axe results are retained in docs/screenshots/appearance-preview; author inspected desktop dark and mobile light captures. Tests cover isolated rendered component colors under both global modes, inert preview semantics, no workspace/preview writes, preserved legacy storage, System following device changes/reload, blocked storage and accessible public mode controls. Existing populated CRM appearance/permission/consent/erasure/isolation and Connect editor/public-resource workflows are rerun. Source review is separate from author runtime evidence.

Final lint/typecheck and all 297 unit tests passed. The root-runtime fix was prompted by a focused System-mode test with the mobile drawer closed; the final nine-case suite was rerun after that correction. The independent reviewer separately exercised 24 applyTheme combinations (storage available/blocked, device light/dark, explicit/system preference and both legacy IDs); browser/build/static evidence remains author-executed.

Final production build passed. Production PWA check passed: Chromium installability, Lighthouse accessibility 100 and best-practices 100, offline fallback, static-only cache and clean offline axe. PWA reports are retained alongside the appearance evidence. No merge or deployment occurred.
