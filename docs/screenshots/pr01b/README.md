# PR 01b real UI and shell evidence

Regenerated for the v1 shell round on top of `74448bf`, retaining the consent-date fix. Captured from the running Next.js app with real Better Auth sessions and persisted disposable PostgreSQL records. Email and file delivery use the existing local mocks; people and workspaces are synthetic browser seeds. No deployment or production data is involved.

The shell uses Harvest branding above a separate workspace menu, v2 navigation, floating sidebar and content panels, an internal page scroller, breadcrumb, footer account/theme/collapse controls, and an icon rail. Studio page-card colors and all four existing palettes remain unchanged. Shell-only tokens separate Studio's canvas from its panel and leave its white page cards visible. Group labels use 85% sidebar foreground because the reference's 70% yielded only 4.10:1 in Harvest light and 80% still yielded 4.34:1 in Studio light; the stronger color passes AA.

The [v1-shell-ref comparison](../../design/reference/v1-shell/) contains Harvest's own reference PNGs from v1 `c29539f`. Compare side by side:

- [shell-expanded-harvest-light.png](shell-expanded-harvest-light.png) vs [v1-expanded-light.png](../../design/reference/v1-shell/v1-expanded-light.png).
- [shell-collapsed-harvest-dark.png](shell-collapsed-harvest-dark.png) vs [v1-collapsed-dark.png](../../design/reference/v1-shell/v1-collapsed-dark.png).

Each shell set has `harvest-light`, `harvest-dark`, `studio-light`, and `studio-dark` variants:

- `shell-expanded-*.png`: contacts list, 1280×800.
- `shell-collapsed-*.png`: contacts list and icon rail, 1280×800.
- `shell-account-menu-*.png`: footer account menu with Theme radio group, 1280×800.
- `shell-mobile-*.png`: open navigation sheet, 390×844.

The retained desktop page sets use a 1440×1000 viewport: `sign-in-*`, `workspace-*`, `contacts-empty-*`, `contacts-list-*`, `contact-detail-*`, and `appearance-*`. Mobile list/detail sets use 390×844: `contacts-list-mobile-*` and `contact-detail-mobile-*`. All have the same four palette variants.

Additional images cover the account menu, consent and erasure dialogs, Calendar/Popover date picker, pagination with 21 contacts, the list after erasure, contact-create network failure and retry, empty search, unknown contact, view-only access, and denied workspace. Filename suffixes identify their actual palette.

`tests/e2e/pr01b.spec.ts` regenerates every image and `axe-results.json`: 59 captured states, zero violations, and 2,567 successful rule results. Assertions cover 12px shell radius, 8px gutters, shadow, inset variant, loaded logo, footer control placement, collapsed-state cookie and keyboard shortcut, mode persistence, keyboard access to account-menu theme radios, mobile sheet navigation and overflow, plus every existing contact, consent, appearance, permission, isolation and sign-out assertion.

`contrast-results.json` records unselected radio border-to-card ratios and shell canvas/panel/page-card/foreground ratios in every palette. Surface ratios describe subtle decorative separation; text contrast is checked by axe in each captured state. The approved page cards retain their existing tokens, radius, and content.

Required checks passed: `npm run lint`, `npm run typecheck`, `npm test` (59 tests across 6 files), `npm run test:rls` (77 tests across 7 files), and `npm run test:e2e` (4 tests).
