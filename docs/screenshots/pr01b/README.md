# PR 01b real UI evidence

Chromium screenshots captured by `tests/e2e/pr01b.spec.ts` from the running Next.js app, with real Better Auth sessions and persisted disposable PostgreSQL records. Email delivery is mocked; displayed people/workspaces are explicitly synthetic browser seeds. Reference imagery and application source are not copied into these screenshots.

Each desktop set has `harvest-light`, `harvest-dark`, `studio-light`, and `studio-dark` variants at 1440×1000:

- `sign-in-*.png`
- `workspace-*.png`
- `contacts-empty-*.png`
- `contacts-list-*.png`
- `contact-detail-*.png`

Mobile list/detail sets have the same four variants at 390×844: `contacts-list-mobile-*.png` and `contact-detail-mobile-*.png`.

Additional screenshots cover appearance settings, contact-create network failure with retry, search with no results, unknown contact, view-only access, and a denied workspace. Filename suffixes identify the actual theme/mode of those states.

`axe-results.json` contains the check totals for all 34 captured screens: zero violations and 1,360 successful rule results. Every run regenerates these images from the actual UI; assertions also check theme precedence after reload, HTML pre-paint initialization, no horizontal mobile overflow, mobile sidebar navigation, role denial and tenant isolation. No deployment is involved.

Studio white cards remain the DESIGN.md section 6 default pending product-owner visual review. Compare [Harvest light](contacts-list-harvest-light.png) with [Studio light](contacts-list-studio-light.png), and [Harvest dark](contact-detail-harvest-dark.png) with [Studio dark](contact-detail-studio-dark.png).
