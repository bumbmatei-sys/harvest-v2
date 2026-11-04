# PR 01b real UI evidence

Regenerated after merging main at `207f933` (OTP hardening, file uploads and latest PRD decisions).

Chromium screenshots captured by `tests/e2e/pr01b.spec.ts` from the running Next.js app, with real Better Auth sessions and persisted disposable PostgreSQL records. Email delivery is mocked; displayed people/workspaces are explicitly synthetic browser seeds. Reference imagery and application source are not copied into these screenshots.

Each desktop set has `harvest-light`, `harvest-dark`, `studio-light`, and `studio-dark` variants at a 1440×1000 viewport (full-page captures may be taller):

- `sign-in-*.png`
- `workspace-*.png`
- `contacts-empty-*.png`
- `contacts-list-*.png`
- `contact-detail-*.png`
- `appearance-*.png`

Mobile list/detail sets have the same four variants at a 390×844 viewport: `contacts-list-mobile-*.png` and `contact-detail-mobile-*.png`.

Additional screenshots cover the open account menu, consent and erasure dialogs, 21-contact pagination, the list after erasure, contact-create network failure with retry, search with no results, unknown contact, view-only access, and a denied workspace. Filename suffixes identify the actual theme/mode of those states.

`axe-results.json` contains the check totals for all 42 captured screens: zero violations and 1,704 successful rule results. Every run regenerates these images from the actual UI; assertions also check keyboard theme selection/save/reload and precedence, Pagination next/previous with 21 contacts and `aria-current`, strict extra-tenant body rejection, non-member route denial, contact erasure, HTML pre-paint initialization, no horizontal mobile overflow, mobile sidebar navigation, role denial and tenant isolation. No deployment is involved. See the [opened reference-screen mapping](../../acceptance/pr01b-round2.md).

Studio white cards remain the DESIGN.md section 6 default pending product-owner visual review. Compare [Harvest light](contacts-list-harvest-light.png) with [Studio light](contacts-list-studio-light.png), and [Harvest dark](contact-detail-harvest-dark.png) with [Studio dark](contact-detail-studio-dark.png).
