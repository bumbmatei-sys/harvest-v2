# Kit PR 4 — Forms and wizard primitives: acceptance record

Plan: `docs/plans/shadcnuikit-adoption.md` section 7, row PR 4 ("Done when": the stepper and form helpers have two real consumers; keyboard e2e passes; validation uses the shared resolver; no `@base-ui/react`).

## Founder approval (gate, section 2)

Approved 2026-11-16 ("I approve them"). The founder owns the licence and public-repository consequences (CLAUDE.md). Recorded in `src/lib/ui-provenance.ts` and the table in `docs/ui-sources.md`.

| Piece | Kit item | Tier | Decision | Not chosen |
| --- | --- | --- | --- | --- |
| `Stepper` | `stepper1`, https://shadcnuikit.com/components/stepper | free | Visual reference: numbered, icon and progress-bar indicators | `stepper2`, `stepper4` |
| `WizardLayout` | `form-layout20`, https://shadcnuikit.com/blocks/dashboard-ui/form-layouts#form-layout-20 | premium | Visual reference: three-step wizard with a horizontal stepper | `onboarding-screen9`, `form-layout21` |
| `FormSection` | `form-layout1`, https://shadcnuikit.com/blocks/dashboard-ui/form-layouts#form-layout-1 | premium | Visual reference: titled sections | `form-layout15` |
| `FormSection` fields | `field1`, https://shadcnuikit.com/components/field | free | Showcase example on Harvest's own `Field` | `field2`, `field4` |
| `StickySaveBar` | none | n/a | Hand-written | n/a |

**Kit-derived vs reference-only.** The four registry JSON files were fetched into a scratch directory outside the repository to read them. **No kit code was copied.** `stepper1`, `form-layout20` and `form-layout1` are reference only (their Harvest files carry the provenance header because the provenance test requires it for any listed file); `field1` is a small converted showcase example (`src/components/dev/kit-field-example.tsx`) on Harvest's existing `Field` primitives. The kit stepper depends on `@base-ui/react` and the two form layouts on react-hook-form with zod 3 and a demo schema: none of that, nor any kit sample data, copy, colors or images, is used. `StickySaveBar` is hand-written (the kit's `form-layout1` has a save bar; it was not copied).

## What changed

Shared pieces (`src/components/`, catalogue strings only, theme tokens only):

- `stepper.tsx` (`Stepper`): ordered list with `aria-current="step"`, done / current / upcoming as visible state and as screen-reader text. `wizard` layout: horizontal with connectors from 768px; below that a compact "Step n of m" line with a progress bar (`compact="never"` keeps the whole list, wrapped). `nav` layout: buttons for an editor whose steps can be visited in any order, vertical from 1024px and a scrollable bar below, `aria-disabled` steps with an optional badge, 44px buttons below 1024px. No motion dependency; the bar's width change stops under reduced motion. Pure helpers: `src/lib/stepper.ts`.
- `wizard-layout.tsx` (`WizardLayout`): stepper (optional), step heading, content slot, Back / Next / Finish footer. `validate(stepId)` runs before Next and Finish (async allowed); `busy` and the internal check show the Spinner and `aria-disabled` (focus stays); disabled steps are skipped; Back, Next and Finish put focus on the step heading, while picking a step from a separate list does not move focus. The caller owns the current step and the values.
- `form-section.tsx` (`FormSection`): titled section (region named by its heading, optional actions, optional split layout) or labelled fieldset (legend first, for radio and checkbox groups). The description slot is optional and meant for one short line.
- `sticky-save-bar.tsx` (`StickySaveBar`): exists only while dirty or saving; sticks to the bottom with phone safe-area padding; stops sticking while the on-screen keyboard is open and scrolls a focused control clear of the bar; polite live region ("Unsaved changes", "Saving"); Save and Discard; Save can be a submit button for a form by id; by default it guards leaving a dirty form through the existing `useUnsavedChangesGuard` (`guard={false}` where the page already has its own guard). Helpers: `src/lib/sticky-save-bar.ts`.
- `src/hooks/use-harvest-form.ts` + `src/lib/form.ts` (`useHarvestForm`): react-hook-form with `zodResolver` (zod 4), validation on blur then on change, first invalid field focused, server and network failures mapped to fields and one inline form-level message (a message for an unknown field is never dropped), `dirty` and `submitting` exposed. Schemas are built in the component with catalogue messages.
- Catalogue: `ComponentsStepper`, `ComponentsWizardLayout`, `ComponentsStickySaveBar`, `ComponentsForm`, `ComponentsWorkspaceForm` (two new validation messages) and `UiShowcase.forms`.

Consumers swapped (data, permissions, server contracts and existing labels unchanged; presentation and form plumbing only):

| Consumer | Stepper | WizardLayout | FormSection | StickySaveBar | Form hook |
| --- | --- | --- | --- | --- | --- |
| Community editor (`community-editor.tsx` on `EditorShell`) | yes, through EditorShell (`nav` layout) | yes (step frame, `stepper={false}`; Back and Next skip the "coming soon" steps) | yes (Visibility and Admission fieldsets) | yes (replaces the header "Save draft"; Discard resets fields; own guard kept) | |
| Ministry settings (`ministry-settings-form.tsx`) | | | | yes (submit button for the form, Discard, new leave guard; baseline moves after a save) | |
| Ministry creation (`workspace-form.tsx`) | | | | | yes (inline field errors, summary alert; the type stays the shared `AudienceField`) |
| CRM import page (`crm/imports/[importId]/page.tsx`) | yes (`wizard` layout, `compact="never"`, replaces the hand-rolled list) | | | | |
| Account profile (`account-profile-form.tsx`) | | | yes (first-step fieldset in onboarding) | | |

Why these: each had an ad-hoc version of the same thing (hand-rolled step list, header Save button with no discard, legend and fieldset by hand, hand-rolled validation message). The landing editor and other forms were left alone (no rewrite of working modules).

Behaviour notes (visible): the community editor's step panel has a Back / Next footer; "Save draft" moves from the header to the bottom bar and appears only with unsaved changes; ministry settings gets Discard and a leave warning; ministry creation shows "Enter a ministry name." and "Choose a ministry type." beside the fields plus one summary alert instead of a single alert; the create form has no native browser validation bubbles (`noValidate`).

**Deviation from "each shared piece needs two real uses".** `Stepper` (3 uses: EditorShell, CRM import, WizardLayout), `FormSection` (2 files), `StickySaveBar` (2) and the form hook (1 form) are used; **`WizardLayout` has one real consumer** (community editor) and the form hook has **one** (ministry creation). No other existing flow is a guided wizard or a validated multi-field form that could take them without changing behaviour. The second consumer of both is the campaign wizard (plan PR 8); see decisions below.

## Dependencies

`react-hook-form` ^7.92.0 and `@hookform/resolvers` ^7.0.6 (both MIT; the resolvers version declares zod `^3.25.0 || ^4.0.0`; the repository uses zod 4.6.7). One new transitive package, `@standard-schema/utils` 0.3.0 (MIT). `package-lock.json` gains exactly those three entries plus a re-hoisting of `ajv` (the resolvers package declares `ajv` as an optional peer, so npm moves the existing `ajv` 8.20.0 to the top level and nests the existing `ajv` 6.15.0 under `eslint` and `@eslint/eslintrc`); no existing package changed version. `npm ci --dry-run` is in sync. No `@base-ui/react`, TanStack, motion or vaul. Recorded in `docs/third-party-licenses.md`.

## Tests

- Unit: new `tests/unit/form-parts.test.ts` (25 tests: step helpers, failure mapping, the zod 4 resolver against the ministry-creation schema, save-bar helpers, Stepper wizard and nav markup, FormSection region and fieldset, StickySaveBar clean, dirty, busy and submit-form states, WizardLayout first, middle, last, hidden stepper, error and busy). Full unit project after the last change: 61 files, 872 tests pass. Provenance, token-leak, showcase-registry and copy-rule tests pass unchanged. The form hook itself is exercised in the browser (static markup cannot run submit).
- E2E added, none weakened: `tests/e2e/ui-showcase.spec.ts` "forms and steps" (stepper states as text and one `aria-current`; wizard Next validation with field error and alert, Back and Next focus on the heading, keyboard Tab and Enter, Finish and restart; sections as region and group; save bar hidden, dirty, busy, Discard, a focused field kept clear of the bar at 390px; then 360/390/768/1280/1440 in light and dark: compact steps below 768px, no horizontal overflow, 44px controls below 1024px, axe wcag2a/2aa/21aa with an explicit wait for fonts and two frames before each run). The first showcase test also expects the four new records and the new group. `tests/e2e/community-editor.spec.ts`: save bar absent while clean, present while dirty, Discard restores; Next and Back move focus to the step heading and the step list follows. `tests/e2e/ministry-audience.spec.ts`: empty creation shows both field messages and the summary alert; Discard in settings restores the saved type and hides the bar.
- Ran locally (Chromium, one worker, 16 Nov 2026, against the final code; `HARVEST_UI_SHOWCASE=1`, local PostgreSQL through `TEST_DATABASE_URL`): `ministry-audience`, `community-editor`, `ui-showcase` (all three tests), `account-onboarding`, `crm06` (import steps), `community-forum`, `community-applications`, `community-notifications`, `community-moderation`, `community-joining`, `studio-foundation`, `layout`: 14 tests, all pass. **Not run:** the other e2e specs (CRM, Connect, files, offline, and so on; none render a swapped piece), and no CI.
- `npx tsc --noEmit`, `npx tsx scripts/check-source.ts`, eslint on every changed `.ts`/`.tsx` file (not the whole repository) and `npm run build` pass. Next 16's build output lists no per-route first-load JS, so no before and after figure is recorded; `react-hook-form` and the resolver load only on the ministry creation route (`/workspaces`), and no new heavy library is added. Measuring it with the bundle analyzer is a follow-up.
- Screenshot evidence: `docs/screenshots/kit-pr4/` (showcase "Forms and steps" at 360 and 1280, light and dark). The existing screenshots rewritten by the e2e runs were reverted.

## Not done

- No choice cards (the plan row lists them; not in this approval) and no icon or progress-bar indicator variants beyond the compact phone bar.
- `useHarvestForm` is not applied to other forms; the landing editor, contact form, CRM forms and dialogs keep their own state.
- The stepper in `wizard` layout is not clickable (Back and Next drive it); revisiting completed steps by click is a later option.
- No campaign wizard, draft or resume (plan PR 8).
- No CI run is claimed; no merge, deployment or production activation.

## Follow-ups and decisions

- Confirm the second consumers for `WizardLayout` and `useHarvestForm` can wait for PR 8 and the first validated forms (ministry settings is a single radio; contact form and others are candidates).
- The sticky bar is a bar inside the content flow (`sticky bottom-2`), not a fixed footer; confirm that is the wanted look on phones.
