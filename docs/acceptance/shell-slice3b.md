# Shell slice 3b: live preview column (acceptance record)

Spec: `docs/superpowers/specs/2026-11-16-shell-editor-mode-design.md` (section 6 preview contract, section 10a refinements 2, 3 and 6, slice 3b). Builds on slice 3a (`docs/acceptance/shell-slice3a.md`, merged as #111). No migration, route, permission, API or dependency change; no new premium kit item. Status: draft PR, not reviewed, not merged, nothing deployed.

## Flag

`HARVEST_SHELL_MODES` (same flag as slices 2 and 3a). Off: `AppShell` mounts no `EditorProvider`, `useEditorHosted()` is false and the community editor passes its previous static preview (Page and Join tabs, 22rem column from 1280px, `Sheet` below) exactly as before. The `livePreview` prop is passed only when hosted. The public community page now uses the shared view (below) with the same markup as before whatever the flag.

## What changed

- `src/components/communities/community-page-view.tsx` (new): `CommunityPageView`, the presentational landing (name, tagline, description, rules, join card) fed plain data plus a `join` node. The public route `src/app/communities/[slug]/page.tsx` now renders it with the published community and the real `JoinDialog`; the editor preview renders it with the draft and an inert button. With `preview` it adds `data-preview-field` markers, opens the rules and uses a `p` instead of the `h1` (the preview stays out of the heading outline); without it the markup is the previous public markup (unit test: with the preview markers stripped the two renderings are identical).
- `src/components/communities/join-dialog.tsx`: the dialog body fields (questions, rules, rules and 18+ confirmations) extracted as `JoinFormFields`, reused by the preview's Welcome tab for visitors. Dialog behaviour and markup unchanged.
- `src/components/communities/welcome-card.tsx`: card frame extracted as `WelcomeCardView`, reused by the preview's Welcome tab for members. The real card's behaviour and markup are unchanged.
- `src/lib/editor-preview.ts` (new, pure): draft form state to preview data (`communityPreviewData`, trimmed like the saved payload), the join rule shared with the public page (`communityCanJoin`), the field map (`communityFieldTargets`: field to step and control id, `fieldForControl`, `communityPreviewFields` per tab and viewer), the space rule helper (`resolvePreviewSpace`), and `createDebouncer`.
- `src/hooks/use-debounced-value.ts` (new): 150ms trailing debounce over the draft.
- `src/components/editor/preview-panel.tsx` (new, shell-owned, module-neutral): `EditorPreviewPanel` with the "Preview (draft)" label, Page and Welcome tabs, a View as Visitor/Member radio group, a Phone/Desktop width radio group (hidden when the frame is the viewport), "Open page" (only when published; the existing public URL, new tab), an "Edit this" menu, and the frame. The frame is a labelled `region` (one tab stop for keyboard scrolling); everything inside is out of the tab order (a `MutationObserver` keeps `tabindex=-1` on interactive descendants); clicks, submits and summary toggles inside are swallowed; clicking an element with `data-preview-field` goes to its field. Desktop width renders a 64rem page scaled with `zoom` to the room available.
- `src/components/communities/community-preview.tsx` (new): `CommunityLivePreview`, the community's content for the panel (real views above, inert controls with `aria-disabled`), debounced draft, no fetch.
- `src/components/editor/editor-shell.tsx`: new `livePreview(surface, { close })` prop used only when hosted. Mounted only where shown: an `aside` ("Preview") column from 1280px (22rem, 24rem from 1600px, unchanged widths), otherwise a sheet (full-screen below 1024px, `max-w-md` from 1024px) opened from the step bar (phone and tablet) or the header button (1024 to 1279px). The sheet has its own 44px close button, returns focus to the opener on close, and `close(after)` runs `after` once it is closed (used to focus a field).
- `src/components/editor/editor-step-bar.tsx`: optional "Preview" button beside the step trigger (44px).
- `src/components/communities/community-editor.tsx`: tab and viewer state live with the editor (they survive the sheet closing); `goToField` switches step and focuses the control after render (scrolls only when the control is disabled for read-only roles); focusing a form control highlights its preview element (`focusin` listener, only when hosted).
- `messages/en.json`: `EditorMode` preview strings, `CommunityEditor.preview*` strings. Provider-neutral.
- Updated assertions in `tests/e2e/shell-slice3a.spec.ts` (flag on): the preview label is now "Preview (draft)" and the dialog is named "Preview (draft)"; the name appears twice in the preview (title and join card), so `.first()`.

## Acceptance (spec slice 3b)

- Preview shows draft data without a save, with live typing: e2e types into Name and Tagline and sees them in the preview while "Save draft" is still offered.
- Real components: unit test renders `CommunityPageView` in public and preview mode and asserts identical markup after removing the preview markers; e2e publishes and checks the public page and the preview show the same name, tagline, description and host (rules differ only because the public page collapses them).
- Device toggle changes the frame only; view-as changes only what the preview shows (join button vs Open community; Welcome tab join form vs welcome card).
- No network request: e2e records every fetch/xhr and non-GET request while using tabs, view-as, device, clicks in the preview, Edit this and typing, and asserts none.
- Preview hidden means unmounted: the column exists only from 1280px and the sheet content only while open (e2e asserts no `[data-editor-preview-panel]` below 1280px with the sheet closed).
- Space rule: `resolvePreviewSpace` unit-tested at 1100, 1279, 1280, 1440, 1599 and 1600 (exclusive below 1600, most recent wins, both from 1600). The pane does not exist yet, so there is no pane e2e; the form keeps more than 28rem at 1280, 1440 and 1600 (e2e).
- Phone first: Preview in the sticky step bar opens a full-screen sheet; close target at least 44px; targets in the sheet at least 44px at 360, 390 and 768 in light and dark; no horizontal overflow; axe (wcag2a, wcag2aa, wcag21aa) clean at 360, 390, 768, 1280 and 1440 in light and dark.
- a11y: the column is `aside` "Preview"; the frame is a labelled region named "Page preview as a visitor, draft" (tab and viewer in the name); tabs are real tabs; view-as and device are radio groups (arrows move focus; Enter and Space select (native buttons)); the frame is one tab stop and nothing inside is focusable; reduced motion respected (no new animation; smooth scrolling is turned off); no `role=status` live regions added.
- Click-to-field and keyboard alternative: tapping or clicking the name, tagline, description, rules, join card or welcome message scrolls to and focuses the matching control, switching step first (Basics, Joining, People) and moving focus after the step renders. "Edit this" is the keyboard path (lists the fields present in the current tab and viewer). On phones both close the sheet first. Escape returns focus to the Preview button.
- Security: draft text renders through React only (unit test: markup in a name is escaped); no `dangerouslySetInnerHTML`; no images (the community has no cover or image field today).
- Flag-off parity: the 3b spec's flag-off test, the 3a flag-off test and the unchanged community-editor spec pass with `HARVEST_SHELL_MODES=disabled`.
- Role matrix unchanged (3a test): owner and admin edit; member and viewer see the preview read-only and clicking a field switches step without focusing a disabled control.

## Screenshots

`docs/screenshots/shell-slice3b/`: desktop 1280 editing with the live preview (light and dark), desktop width toggle, view as member, tablet 768 editor and preview sheet (light and dark), phone 360 full-screen preview (light and dark) and member view. All viewed before committing.

## Deviations from the spec text

- Tabs are "Page" and "Welcome" only; there is no separate "Live preview" tab (the whole panel is the live preview and carries the "Preview (draft)" label).
- The preview shows the page body, not the public frame's brand header or footer (`PublicFrame` is a server component with a locale badge and the brand name).
- "Member" on the Page tab is a sample state (the Join button becomes "Open community"): the real public page does not change for signed-in members, so this is an illustration, not a render of the real thing. The Welcome tab for members renders the real welcome card frame with sample inert actions.
- Desktop width is a scaled 64rem page (text is small in the 22rem column; the sheet at 1024px or wider gives more room). It is not a second layout engine.
- Only the "focus a field highlights its element" direction listed in section 10a is implemented as a ring on the matching element; it follows control ids, not a general field registry.
- `?step=` in the URL (decision 1) is not implemented: scope said no route change.
- The preview frame is a `tabindex=0` scroll region (one tab stop) so keyboard users can scroll it; the spec said the frame content is not a tab stop (its contents are not).
- The cover image from the task text does not exist for communities; nothing is rendered for it.

## Not verified

- Production with the flag on; CI not run on the PR; Safari and Firefox (desktop width uses CSS `zoom`, supported in current Chromium, Safari and Firefox 126+; untested here).
- Screen reader announcements for the tabs, radio groups, sheet and "Edit this" menu; touch devices (Playwright viewport only).
- Behaviour with a very long name or rules list in desktop width; performance with large drafts (debounce only).
- The pane slice: `resolvePreviewSpace` is untested against a real pane.

## Decisions needed

1. Accept the sample "Member" state on the Page tab, or drop View as for that tab until the public page itself has a member state.
2. Whether view-as and device groups should select on arrow keys (native radio behaviour) instead of Radix toggle-group's focus-then-Space.
3. Whether to keep the scaled desktop width (small text in the column) or open desktop width in a larger sheet.
4. `?step=` in the URL: add in a slice that is allowed a route-level change.

## CI width assertion (shell-slice3a spec)

CI on other PRs failed `tests/e2e/shell-slice3a.spec.ts` "expected preview width 384, received 352" right after `setViewportSize(1700)`. It did not reproduce locally (the spec passed, also with `CI=1` and the spec file sharded). Cause: the width was read once immediately after the resize, before layout settled on a slower runner. The 3a and 3b specs now use `expect.poll` for every preview and form width read taken right after a resize (352 from 1280px, 384 from 1600px; the rule itself is unchanged).

## Address section (founder request, separate commit)

- The Basics address is an `InputGroup` with a fixed, read-only `/communities/` prefix (the shared `InputGroupAddon`, same string as the create dialog) and only the slug editable (not part of the prefix; lowercased as typed; 44px group; no helper text).
- A draft's address follows the title (`suggestSlug`, moved to `src/lib/community-editor.ts` and shared with the create dialog) until the owner edits the address by hand; after that it never syncs again (also after Discard it is recomputed from the saved values). A suggestion that is not a valid address (for example a one-letter title) leaves the address unchanged.
- A published community's address is read-only and never changes; the server refuses a slug change on a published community (409, `Errors.communitySlugLocked`) and a taken address (409, existing `communitySlugTaken`). The update API now accepts `slug` (no migration: the column, unique index and check already exist).
- Public page, Open page link and previews still use `/communities/:slug` (e2e).
- Tests: `tests/unit/community-slug.test.ts`; e2e "address" test in `tests/e2e/shell-slice3b.spec.ts` (follow, hand edit stops sync, save, taken address, published lock, axe, no overflow, 44px). Screenshots `docs/screenshots/shell-slice3b/address-{desktop-1280,phone-360}-{light,dark}.png` (crops of the Basics section), viewed.
- Not verified: a published community that is unpublished then renamed (the address stays whatever it was; it does not auto-sync because `slugFollowsName` is evaluated on load and the title and address already differ in practice only after a hand edit).
