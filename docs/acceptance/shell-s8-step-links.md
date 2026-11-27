# Shell slice S8: `?step=` links to an editor step (acceptance record)

Roadmap: Phase 0, "S8: ?step= link to a specific step". Spec context: `docs/superpowers/specs/2026-11-16-shell-editor-mode-design.md` (editor mode). Founder approved parallel work on 26 Nov 2026. No migration, route, permission, API or dependency change; no kit item. Status: draft PR, not reviewed, not merged, nothing deployed.

## Behaviour

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `...?step=<id>` opens that step when it exists and is not locked, through the editor's own step handler (the same path as picking it in the step list). | BUILT | `tests/unit/step-param.test.ts`; `tests/e2e/editor-step-link.spec.ts` (community editor `joining`, `publish`; campaign wizard `leaders`) |
| 2 | Unknown, locked (coming soon), wrongly cased, padded or over-long values fall back to the editor's own step and are removed from the address; other parameters and the hash stay. | BUILT | unit (`fallback` cases, `withStepParam`); e2e (`messages`, `nope`, `JOINING` with `&from=test`; campaign `unknown`) |
| 3 | The address follows every step change (step list, Back/Next, Edit this, checklist links) with `history.replaceState`, so no history entry is added and Back still leaves the editor. | BUILT | e2e (`?step=channels`, `history.length` unchanged; campaign Back writes `?step=place`) |
| 4 | An editor opened without the parameter keeps its plain address until the step changes. | BUILT | e2e (`search` is empty after load); existing specs that assert `...$` addresses still pass |
| 5 | The step opened from the address is marked current (`aria-current="step"`) and its heading takes focus (WizardLayout's `data-slot="wizard-heading"`; the editor title, now `tabIndex=-1`, when the step has no heading). | BUILT | e2e (`toBeFocused`, one `aria-current="step"`); axe clean at 1440 |
| 6 | Works with the editing sidebar (hosted, shell modes on), with the in-page step list (flag off) and on phones (step bar shows "Step n of m"). | BUILT | e2e at 1440 and 390 (`Step 9 of 9`); flag-off path shares the same hook |

## Where it lives

- `src/lib/step-param.ts` (pure): `resolveStepParam(steps, raw)` returns `none`, `open` or `fallback`; `withStepParam(href, id)`.
- `src/hooks/use-step-param.ts`: reads the address once on mount, then writes on step changes. Writes use `history.replaceState(null, "", url)`, the same pattern as the settings dialog (`settings-host.tsx`); Next keeps `useSearchParams` in step.
- `src/components/editor/editor-shell.tsx`: calls the hook for every consumer; `stepParam={false}` opts an editor out. Consumers are unchanged: campaign wizard, community editor, catalog editor, event form, link in bio, ad wizard, newsletter campaign and automation editors.

## Reuse and exceptions

- One hook in the shared `EditorShell`, no per-module code. `WizardLayout` outside `EditorShell` is used only by the `/dev/ui` showcase, so it has no link of its own.
- "Allowed" means the same as the step list: a step marked `disabled` (coming soon, not applicable to the ad mode, Publish before a catalog item exists) is never opened from the address.

## Known limits

- The step opens right after hydration (the editors own their step state), so the first paint can show the default step for one frame.
- The leave guard's fallback for browsers without the Navigation API remembers the address from when the editor opened; if it restores the editor after Back, the address can show the older `?step=` until the next step change. Browsers with the Navigation API (Chromium) are not affected.
