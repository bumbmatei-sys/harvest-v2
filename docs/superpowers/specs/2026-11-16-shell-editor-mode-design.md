# Shell editor mode (slice 3): addendum to the three-mode shell spec

Status: Design approved by the founder on 16 Nov 2026; implementation slices need their own PRs, reviews and acceptance; this approves no deployment or production activation. Documentation only; nothing here is built. Addendum to `2026-11-16-three-mode-shell-design.md` (merged, PR #100); it does not change that spec's decisions.

## Summary (10 lines)

1. Direction (founder, 16 Nov): when a user creates or edits an item (community, course/product, campaign, link in bio, website, newsletter, form), the main sidebar is replaced by that item's own sidebar.
2. That sidebar has: a back link (for example "Products"), the item name with a Draft/Live badge, numbered steps with done check marks, and an "Open page" link at the bottom.
3. The content area becomes form | permanent live preview (phone-shaped public page, with tabs, desktop/phone toggle and "Open in browser"). The step list no longer takes room inside the page.
4. The assistant or any other pane can still open at the far right on wide screens.
5. Representation: pages provide an `editor` context (title, status, steps with state, back href, open-page href, optional preview); `AppShell` renders the sidebar in "editing" state while a context is registered, otherwise "navigation". The mode (Operations/Public/Assistant) is kept, not changed.
6. Built on what exists: `EditorShell`, `Stepper` (`nav` layout), `StickySaveBar`, the community editor, the registry and modes. Today the steps and a 22rem preview column sit inside the page (`xl`); this moves the steps into the sidebar.
7. Preview contract: draft data only, no sends, sandboxed, same render path as the public page where possible.
8. Breakpoints: preview column from 1280px; below that a Preview toggle/tab; steps collapse into a top sheet on phone and tablet; 44px targets.
9. Slices: 3a editor context + AppShell state + community editor migrated (static preview slot); 3b preview column + device toggle; then one PR per module (community, campaign wizard CW-02+, courses/products, link in bio, newsletter, website, forms).
10. Approved refinements (section 10a): switcher stays visible; below 1600px preview and pane never both open; phone-first; three step states and a Publish checklist; autosave by default; real public component as preview with visitor/member switch and click-to-field; editor mode only for long-lived items; assistant proposes drafts, never auto-applies. Decisions are in section 11; unverified assumptions in section 13.

## 1. Goal and non-goals

Goal: give every create/edit flow one shared full-height layout: item sidebar, form, permanent preview. Reuse the shared systems; no per-module shell.

Non-goals: new routes or URL renames (editors keep their routes under `/workspaces/[tenantId]/...`); building any module that does not exist; changing permissions, audiences or the mode set; the AI runtime; payments or provider calls; replacing `WizardLayout` for short linear flows (it stays for them); real data in previews.

Design source: Eden reference screens (layout and information architecture only), read again for this addendum: `05-communities/comm-057` (item sidebar with Offer, Basics, Joining, Channels, Messages, People, Products, Page, Publish; header with title, Draft badge and actions; form; phone preview with Live preview / Page / Welcome tabs and "Open in browser"; Save draft and Publish at the bottom of the form; assistant pane at the far right) and `10-products/products-034` (same frame, different steps, "Preview as client", "Share preview", "Test checkout"). `products-041` and `11-link-in-bio/bio-005` were not re-opened (see section 12). Style is Studio Admin through the shared shadcn components (floating sidebar, tokens). No Eden visuals, branding, copy or images are reproduced or copied.

## 2. Today (verified in the checkout at main be84132)

- `src/components/editor/editor-shell.tsx`: header (breadcrumb, title, status, actions) and a grid `13rem | form | 22rem` (steps from `lg`, preview from `xl`; below `xl` a "Preview" button opens a right `Sheet`). Steps are the shared `Stepper layout="nav"`.
- `src/components/stepper.tsx`: `StepperStep = { id, label, done?, disabled?, badge? }`, layouts `wizard`/`nav`, `compact="phone"`.
- `src/components/wizard-layout.tsx` (`WizardLayout`) and `src/components/sticky-save-bar.tsx` (`StickySaveBar`, with a leave guard option; the community editor passes `guard={false}`).
- `src/components/communities/community-editor.tsx`: the only `EditorShell` consumer I found; steps offer, basics, joining, channels, messages, people, page, publish (from its step ids and checklist), preview tabs inside the preview slot.
- `AppShell` renders only the navigation sidebar from the registry; there is no editor state. (The mode switcher and the `mode` registry field are slices 1 and 2 of the three-mode spec; PR #102 is described to me as in review and was not read.)

## 3. Two sidebar states

- **Navigation** (today): mode switcher, grouped registry entries, profile menu.
- **Editing this item**: replaces the sidebar body (not the footer). Structure, top to bottom:
  1. Back link: `href` and label from the editor context (for example "Products"). A real link, `aria-label` includes the destination.
  2. Item block: item name (truncated, full name in a tooltip) and a status badge (Draft/Live), plus a one-line type label (for example "Community").
  3. Steps: an ordered list, each with number or done check, label, optional badge and a disabled state. The current step has `aria-current="step"`.
  4. Footer area (above the profile row): "Open page" link (only when the item has a public URL, opens a new tab with `rel="noopener"`), and optional secondary facts (member count).
- Brand row, profile menu (ministry switcher), theme toggle and collapse trigger remain, so the user is never trapped.
- Mode switcher while editing: stays visible (approved, section 10a); only the entry list swaps for the item block. The mode is kept; the back link returns to the item's list in the same mode, and the command palette remains. Shortcuts from the main spec still work and respect the leave guard (section 7).
- Collapsed icon rail while editing: shows numbered step icons with tooltips and the back arrow; labels in tooltips. Recommended default: when an editor mounts, the sidebar keeps its current open/collapsed state (the cookie), it does not force it.

## 4. Representation in the registry and AppShell

The editor sidebar is page-provided state, not a registry entry (items are dynamic and have ids). The registry's role stays: it supplies the mode and the list/back targets.

Proposed context (indicative types):

```
EditorContext = {
  title: string; typeLabel?: string; status: { kind: "draft" | "live" | "other"; label: string };
  back: { href: string; label: string };
  steps: { id: string; label: string; state: "todo" | "current" | "done" | "disabled"; badge?: string }[];
  onStep: (id: string) => void;          // step state stays with the page (query param or local state)
  openPage?: { href: string; label: string };
  dirty?: boolean;                        // drives the leave guard
  preview?: { slot: ReactNode; label: string; tabs?: ... } // see section 6
}
```

- Mechanism: a client `EditorProvider` inside the workspace layout (so `AppShell` and pages share it) plus a `useEditorContext(value)` hook the page calls; it registers on mount and clears on unmount. `AppShell` reads the context: present means editing sidebar and the three-column content frame; absent means navigation. Server components pass serialisable data only; callbacks live in the client editor component (the community editor is already a client component).
- Step identity stays with the page (today `setStep`). Recommended: step in the URL as a query param (`?step=basics`) so reload and Back work, using `replace` for step changes and no new route. Default for the first slice: keep local state as today, add the query param in 3b or when a module asks.
- `EditorShell` keeps its public API for the transition and becomes a thin frame: header and form column only; the steps prop moves to the context. During slice 3a both can coexist (an `EditorShell` without a provider falls back to the in-page stepper), so unmigrated consumers are not broken.
- Permissions: the registry and `can(...)` still gate who reaches the route; the context only describes UI. A viewer (read-only) sees the steps and preview but no save/publish (as the community editor does with `writable`).
- Nothing in this changes `navigation.ts` entries, routes, `match` or breadcrumb behaviour; `sectionLabel` still resolves the section for the breadcrumb.

## 5. Content frame (three columns) and breakpoints

Content area while editing: `form | preview`, plus the optional far-right pane.

| Width | Layout |
| --- | --- |
| >=1600px | sidebar, form (at least 28rem), preview (24rem) and pane (up to 28rem) may all be open side by side |
| 1280 to 1599px | sidebar, form, preview column. The pane and the preview are never both open: the most recently opened wins and the other becomes a toggle or sheet |
| 1024 to 1279px | sidebar, form; a "Preview" button in the header opens the preview as a right sheet; the pane is an overlay sheet, also exclusive with the preview sheet |
| <1024px (tablet and phone) | no sidebar column; "Step n of m" top bar and list sheet (section 8), full-screen Preview toggle, Back/Next bottom bar; the pane is a full sheet |

Width rule: the form column keeps at least 28rem and the preview at least 20rem; nothing squeezes them. The preview column is `position: sticky` within the main scroll area; the form scrolls; the header with actions stays visible. Drafts autosave (section 7); Save draft sits at the bottom of the form (`StickySaveBar`) only for forms that need a manual save, and Publish is always at the bottom of the form, disabled with the reason listed in the Publish step checklist (section 10a) until the required items are done.

Header actions (design direction): title, status badge, "Test"/"Preview as viewer", "Share preview", overflow. These are slots the module fills; each action is a real, permissioned control or it is absent (no dead buttons). "Share preview" is a later slice (it implies a signed preview link, which this spec does not define; see questions).

## 6. Preview contract

- Component per module, rendered in a fixed frame owned by the shell (phone-shaped by default, desktop/phone toggle, optional tabs such as Live preview, Page, Welcome, "Open in browser").
- Input: `{ draft, device: "phone" | "desktop", tab, tenantId }`. `draft` is the unsaved form state serialised (plain data, no functions, no secrets, no access tokens). Nothing is fetched with the viewer's privileges beyond what the editor already loaded.
- No side effects: the preview renders from data; buttons inside are inert (`pointer-events` and `aria-disabled`, or handlers stubbed); no checkout, no email, no webhook, no analytics event, no real recipient list. Checkout shown as "off in preview". No real member, contact or donor data appears; sample placeholders are used where the page would show people.
- Same render path as the public page where possible: the public page component (for example under `src/app/communities/[slug]`) is split into a pure presentational view fed by a `PublicPageData` shape; the preview feeds it the draft, the public route feeds it the published snapshot. Where a public page is server-rendered and cannot be mounted client-side, the module provides a client presentational twin with a test that both render the same fixture identically (snapshot test). This is the main cost and risk of the feature.
- Sandboxing: the preview is rendered in the same document (not an iframe) inside a container with `inert`-like behaviour for links and forms, so there is no second origin, no cookie issue and no CSP change. "Open in browser" opens the real public URL when the item is published, or a draft preview only if a signed preview link exists (not defined here). If a module later needs hard isolation (user-supplied HTML, custom code in the website builder), use an iframe with `sandbox` and `srcdoc` and no same-origin; that decision is deferred to that module's spec.
- Accessibility of the preview: landmark `aside` with an accessible name; the phone frame content is not a tab stop; the toggle is a real button group; the preview is excluded from the page's heading outline (`aria-hidden` is not used on content that is informational; the form remains the source of truth for assistive tech; decision to confirm in review).
- Performance: debounce draft updates (about 150ms), render the preview lazily, and do not mount it while the preview is hidden (sheet closed or tab inactive).

## 7. Unsaved-changes guard

- Drafts autosave by default (section 10a); "dirty" means unsaved or unsynced changes, supplied by the page. The guard fires only then. While dirty: browser `beforeunload` prompt for reload and tab close; an in-app confirm dialog (the shared `ConfirmDialog`) for the back link, sidebar navigation, mode switches, ministry switching, opening the pane's "full page" and shortcut navigation.
- Next.js App Router has no built-in route-change blocker; the guard intercepts clicks on shell links through the same context (`editor.dirty` makes shell links ask first) rather than patching the router. Browser Back/Forward is handled best-effort by a `popstate` guard (limitation recorded in risks).
- `StickySaveBar` already has a `guard` option; the community editor currently passes `guard={false}`. This spec's guard replaces that local arrangement for editors; reconcile in 3a so there is one guard, not two.
- Step changes inside the editor never prompt (state is kept in the form). A failed save keeps the editor dirty and shows the error; discard resets to the last saved data.

## 8. Keyboard, a11y, phone and tablet

- Landmarks: the editing sidebar stays `role="complementary"` named "Editing {item}"; steps are a `nav` named "Steps" containing an `ol`; the form is `main`; the preview is `aside` named "Preview". Only one `main`, one `nav` per purpose, skip link goes to `#main-content`, plus a second skip link "Skip to preview" is not added (the preview is not a task area).
- Step list semantics: ordered list; each step is a link or button with the number visible and "done"/"current" as text for assistive tech, not colour alone; `aria-current="step"`; disabled steps use `aria-disabled` and stay in the order. Arrow keys move between steps (roving tabindex is not required; Tab works through the list, per the shared `Stepper`).
- Focus: on entering editor mode focus goes to the page heading (not the sidebar); on step change focus moves to the step's form heading; after closing a sheet focus returns to its trigger. Leaving restores focus to the originating list row when possible.
- Phone and tablet (<1024px), designed before the desktop layout: no sidebar column. A "Step n of m" top bar opens a list sheet showing steps with their states (done, needs attention, not started), plus the back link and Open page. The preview is a full-screen toggle button (the device toggle is hidden: the frame is the viewport). Back and Next sit in a bottom bar above the safe area, with Save draft only when the form needs manual save and Publish on the last step. Targets are at least 44px; no horizontal page scroll; full-width layouts.
- Reduced motion: no sliding of the sidebar swap.

## 9. Module adoption order

1. **Community editor** (exists: `community-editor.tsx`): first migration, static preview slot (the current preview tabs), proves the context.
2. **Campaign wizard** (CW-02+, planned; CW-01 campaigns exist): steps as editor steps; preview of the Connect landing/QR page where it exists (the landing editor and shared guest preview exist, PR #32).
3. **Courses and products** (planned; checkout provider undecided: preview shows checkout as off).
4. **Link in bio** (not started).
5. **Newsletter** (planned) and **forms/questionnaires** (exist per campaign; a standalone builder is planned).
6. **Website builder** (not started; may need iframe isolation, see section 6).

Each module's PR names the shared systems reused, the two-consumer rule applies before the context API is called universal (community plus the second module), and records light/dark and responsive evidence.

## 10. Migration plan (small, independently reviewable PRs; each with its own review and acceptance)

Depends on three-mode slices 1 and 2 (registry `mode`, switcher UI). No migration, route or permission change in any slice.

- **3a. Editor context and AppShell state, community editor migrated, static preview slot.** `EditorProvider`, `useEditorContext`, editing sidebar state in `AppShell`, steps moved out of `EditorShell` (kept as fallback), leave guard through the context, community editor registers its context; the preview stays as today's static slot in a right column at `xl`.
  - Acceptance: with no editor context the sidebar is pixel-identical to before; opening a community editor swaps the sidebar to back link, name and badge, numbered steps with done marks, Open page (only when published); step changes work; the mode is unchanged and the back link returns to the list; dirty edits prompt on every leave path in section 7; viewer role has no save/publish; no route, permission or API change.
  - Tests: unit (context registration and cleanup, step state mapping, guard decision table, serialisable-context type test); e2e at 360, 390, 768, 1280, 1440 in light and dark (swap in and out, steps, back link, guard dialog, rail state, phone step bar and sheet); axe on each; 44px target assertions; no horizontal scroll; screenshots viewed.
- **3b. Preview column and device toggle.** Shell-owned preview frame, tabs, phone/desktop toggle, "Open in browser", the preview contract wrapper, width budget with the pane, sheet fallback below 1280px.
  - Acceptance: the preview shows draft data without a save; toggling device changes the frame only; no network request is made by interacting with the preview (test asserts no fetch/mutation); the pane opening never squeezes form or preview below the minimums; preview hidden means unmounted.
  - Tests: unit (debounce, contract type, inert behaviour); e2e at all five widths plus pane open/closed, axe, light/dark, a snapshot proving the community preview and the public page render the same fixture.
- **3c..3n. One PR per module** (section 9), each adding its steps, preview component and tests.
- **Cleanup.** Remove the in-page stepper fallback from `EditorShell` once all consumers migrated; update `docs/design-system.md`, the component registry and acceptance records.
- Rollback: 3a behind a flag so the navigation sidebar is always used until the founder accepts it.

## 10a. Refinements (approved by the founder on 16 Nov 2026)

These rules win over any earlier wording; sections 3, 5, 7 and 8 have been edited to match.

1. **Mode switcher stays visible in editor mode.** Only the list of entries swaps for the item sidebar (back link, name and badge, steps, Open page). The back link and the command palette remain. The mode is kept.
2. **Space rule.** The preview column appears from 1280px. Below 1600px the assistant/pane and the preview never both open: the most recently opened wins and the other becomes a toggle or sheet. From 1600px both may be side by side (form keeps at least 28rem). Replaces the width-budget table's pane rows where they differ.
3. **Phone first.** Steps become a "Step n of m" top bar that opens a list sheet; the preview is a full-screen toggle button; Back and Next sit in a bottom bar; every target is at least 44px. The phone layout is designed and accepted before the desktop layout in each slice.
4. **Three step states:** done, needs attention, not started (plus current and disabled as today). The Publish step is a checklist of what is missing and blocks publishing until the required items are done; each missing item links to its step. State is text plus icon, never colour alone.
5. **Autosave by default.** Drafts autosave and resume, reusing the campaign wizard's planned autosave/resume and idempotency approach (that wizard, CW-02+, is not built; the exact mechanism must be taken from its plan, not invented here). `StickySaveBar` is used only for forms that need a manual save. The leave guard (section 7) fires only when there are unsaved or unsynced changes; a status line shows Saved / Saving / Not synced.
6. **Real preview, bidirectional.** The preview renders the real public page component from draft data (same render path), with a "view as visitor / as member" switch (sample data only, never real members). Clicking an element in the preview scrolls to and focuses the matching form field, and focusing a field highlights the matching preview element. Keyboard alternative: a "Show in preview" / "Go to field" control per field group and a focusable list of preview regions, so the feature does not depend on a pointer.
7. **Scope of editor mode.** Only long-lived items with a public page and several steps: community, course, product, campaign, link in bio, website, newsletter, form. Short flows stay dialogs, sheets or `WizardLayout`.
8. **Assistant in editor mode.** The assistant offers "Improve this section" and "Write this for me" on a section. It proposes changes as a draft shown as a diff or side-by-side; the user approves or discards; nothing is auto-applied or autosaved before approval. Context passed follows the assistant frame rules (ids and the section's draft text only with the user's consent; permissions and approval as in the main spec). This spec defines the frame only, not the AI runtime.

Added acceptance criteria (in addition to section 10):
- **3a:** designed and checked on phone first (360 and 390): "Step n of m" bar and list sheet, Back/Next bottom bar, 44px targets, then 768, 1280, 1440. Mode switcher visible and working while editing; entry list swapped; command palette still opens. Step states done/needs attention/not started render with text and icon. Publish step lists missing items and Publish is disabled until required items are done. Autosave status line and a leave guard that fires only with unsaved or unsynced changes (autosave mechanism: reuse the campaign wizard's approach if it exists by then; otherwise 3a keeps the current manual save and records the gap).
- **3b:** phone preview as a full-screen toggle; preview column from 1280px; below 1600px opening the pane closes or converts the preview to a toggle and vice versa (most recent wins), with a test at 1280, 1440 and 1600; preview renders the real public component (snapshot equality with the public page on the same fixture); visitor/member switch uses sample data only; click-to-field and field-to-preview highlight work, with the keyboard alternative covered by e2e and axe; no network request from preview interaction; the assistant draft proposal (if the frame exists by then) never applies without approval.

## 11. Decisions (founder, 16 Nov 2026)

1. Step state in the URL (`?step=`): yes, from 3b (replace, no new route).
2. The mode switcher is NOT hidden while editing; only the entry list swaps. Back link and command palette remain.
3. The editing sidebar keeps the user's open/collapsed state; it does not force-expand.
4. "Share preview" (signed, expiring link, privacy decision): omitted until separately specified.
5. "Test checkout" / "Preview as buyer": omitted; checkout shown as "off in preview" (payment providers undecided).
6. Header actions: the shell provides slots only; modules supply them.
7. Preview isolation: same document and inert; iframe only for the website builder if user HTML is allowed.
8. Preview column: 24rem from 1600px, 22rem from 1280px (confirm with a prototype).
9. Space rule: below 1600px the pane and the preview never both open; the most recently opened wins and the other becomes a toggle or sheet.
10. Short flows (create dialogs, first-run wizard) keep dialogs, sheets or `WizardLayout`; editor mode is for long-lived items with a public page and several steps.
11. All eight items of section 10a approved, including autosave by default and the assistant proposing drafts that the user approves.

### Livestream note

A Live section for communities (a YouTube embed with live comments, prayer requests and moderation; donations later) will be specified separately. It must fit editor mode as a community step (a step in the community's step list with its own state and preview tab), not as a separate shell.

## 12. Risks

- Same-render-path for previews is the largest effort; a divergent twin would mislead users about the published page (mitigated by the shared presentational view and snapshot tests).
- Leave guard in the App Router is best-effort for Back/Forward and external navigation.
- Moving steps into the sidebar changes where users look; the collapsed rail must stay usable (tooltips).
- Width budget with sidebar, form, preview and pane at 1280 to 1440px is tight; the overlay rule protects the form.
- A page-provided context means an editor that fails to unmount would leave a stale sidebar; the hook clears on unmount and a test covers route changes.
- Server pages cannot supply callbacks; editors must be client components (the community editor is).
- Interaction with the three-mode slice 2 (hidden switcher) must be re-checked if that slice changes before this lands.

## 13. Assumptions I could not verify

- `PR #102` (typed registry modes) was not read; this addendum assumes the `mode` field and switcher land as described in the merged spec.
- I did not re-open `products-041` or `bio-005`; the structure for those is inferred from `comm-057` and `products-034` and the founder's description. Only `comm-057` and `products-034` were viewed for this addendum.
- `EditorShell` has one consumer (the community editor) per my search of `src/components`; other consumers elsewhere were not exhaustively searched.
- The public community page's render structure was not inspected, so the feasibility of a shared presentational view is unverified.
- Next.js version-specific behaviour for navigation interception and `beforeunload` in the App Router was not tested.
- The campaign wizard CW-02+ and newsletter/website modules are not built; their steps and previews are placeholders for their own specs.
- No measurements of layout widths, performance or screen-reader behaviour were made; all numbers are proposals.
