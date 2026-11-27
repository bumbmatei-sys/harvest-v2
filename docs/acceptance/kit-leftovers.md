# Kit leftovers: toast placement, edge to edge, tier check, switcher member count (acceptance record)

Roadmap: Phase 0, "Kit leftovers: toast placement, free-tier check, member count in switcher". Founder decisions 26 Nov 2026: toasts at the top on phones and bottom right on desktop; edge to edge with `viewport-fit=cover` and safe-area spacing; the switcher counts everyone with access and names the Collaborator and Guest roles. No migration, permission or API change; no new kit item (the Sonner adapter from `toast1`, approved 16 Nov, and the switcher from `dashboard-dropdown7`, approved 16 Nov, are reused). Status: draft PR, not reviewed, not merged, nothing deployed.

## 1. Toast placement

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| T1 | One toast outlet for the whole app (the root layout's `Toaster`), one position per width: bottom right from 601px, full width at the top on phones (600px and below, Sonner's own phone breakpoint). | BUILT | `src/components/ui/sonner.tsx`; `tests/e2e/ministry-audience.spec.ts` |
| T2 | Offsets add the safe-area insets (24px from the edge on desktop, 16px on phones, plus `env(safe-area-inset-*)`). | BUILT | `sonner.tsx` (`offset`, `mobileOffset`) |
| T3 | No second floating notice position: the doc editor's import error, which was a fixed alert at the bottom left, now uses the shared toast (`notify.error`, id `doc-import`). | BUILT | `src/components/docs/doc-editor.tsx` (no browser spec covers the import failure; `docs.spec.ts` was not run to completion) |

Why the top on phones: the bottom of a phone screen holds the community bottom navigation, sticky save bars, the chat composer and the on-screen keyboard.

## 2. Edge to edge (safe areas)

`src/app/layout.tsx` exports `viewport = { viewportFit: "cover" }`; the chat and messages pages, which export their own viewport, repeat it. Pages now draw under the notch and home bar, and every surface keeps its content clear:

| Surface | Safe-area handling |
| --- | --- |
| App shell (`app-shell.tsx`) | Top, left and right padding on the shell; the scrolling content ends with the bottom inset, so its last row can scroll above the home bar. |
| Sticky save bar (`sticky-save-bar.tsx`) | Unchanged: `pb-[max(0.75rem, env(safe-area-inset-bottom))]`. |
| Community shell (`community-shell.tsx`) | Top, left and right padding; desktop rail below the top inset; the phone bottom navigation pads the bottom, left and right insets, and the content reserves its height plus the bottom inset. |
| Chat and messages (`chat-layout.tsx`, `dm-layout.tsx`) | Height is the viewport minus the top inset (held by the community shell); the composer keeps `pb-[max(0.75rem, env(safe-area-inset-bottom))]`. |
| Public pages (Connect frame, link in bio, Discover and Giving staff pages, sign-in, campaign invitations) | Padding on all four insets (`max()` with the existing padding where the page had one). |
| Sheets (`ui/sheet.tsx`) | Each side pads the screen edges it touches; the close button moves with the top and right insets. Consumers that reset padding (mobile sidebar, inbox list, editor preview, doc pages and page tools, calendar event panel) add the insets back. |
| Full-screen settings on phones (`settings-dialog.tsx`) | Padding on all four insets and the close button below the top inset below 768px; unchanged centred dialog from 768px. |
| Doc editor "Exit focus" button | Offsets include the bottom and right insets. |

Headless Chromium reports zero insets, so the screenshots show that nothing moved on devices without a notch; the inset values themselves need a check on a notched phone (installed app and browser).

## 3. Kit tier check

All 29 kit items recorded in `src/lib/ui-provenance.ts` were checked on 26 Nov 2026 against the kit's category Markdown pages (`https://shadcnuikit.com<href>.md`), which list every variant as Free or Pro: 8 confirmed free, 20 confirmed premium, and `select14` corrected from premium to free (record, file header and tables). Details: `docs/ui-sources.md`, "Tier check".

## 4. Switcher member count and roles

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| M1 | The count is everyone with access: every accepted membership row of the ministry, collaborators and guests included (pending invitations are not access). Counted inside the per-ministry tenant transaction with an explicit tenant filter; a person only gets counts for ministries they belong to. | BUILT (count from Kit PR 2, #89) | `tests/integration/workspace-member-count.test.ts` (new case with a collaborator and a guest) |
| M2 | Role names: Collaborator and Guest instead of raw ids; a collaborator's role token (`collaborator;crm=manage`) shows as Collaborator and `campaign_guest` as Guest. | BUILT | `switcherRoleKey` in `src/lib/ministry-switcher.ts`; `tests/unit/ministry-switcher.test.ts`; `tests/e2e/kit-pr2-shell.spec.ts` (new test) |

## Test evidence (27 Nov 2026, local, webpack dev server, one worker, CI timeouts)

- Unit: `tests/unit/ministry-switcher.test.ts` (role keys), `tests/unit/ui-primitives.test.ts` (the sheet sides pad exactly the edges they touch; the old "bottom only" expectation is replaced by the edge-to-edge rule), `tests/unit/ui-provenance.test.ts` 16 passed.
- Integration: `tests/integration/workspace-member-count.test.ts` 2 passed.
- Browser: `tests/e2e/kit-pr2-shell.spec.ts` 5 of 5 passed across two runs (tests 1 to 3 in the first, 4 and 5 rerun on a fresh server after a dev-server restart); the new test also checks "Role: collaborator" and "Role: guest" on Your ministries, where a collaborator previously got a missing-message error. `tests/e2e/ministry-audience.spec.ts` 1 passed (toast in the Notifications region).
- Not run to completion: `docs.spec.ts` and `community-chat.spec.ts` (the shared machine ran out of disk), and the founder phone screenshots.
