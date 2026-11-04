# PR 01b real UI evidence

Regenerated for round 3 on top of `d15bd60` (main remains `207f933`). The detail screens show recording-order withdrawal precedence, shadcn Item lists and the overview heading; appearance uses the corrected radio borders.

Chromium screenshots captured by `tests/e2e/pr01b.spec.ts` from the running Next.js app, with real Better Auth sessions and persisted disposable PostgreSQL records. Email delivery is mocked; displayed people/workspaces are explicitly synthetic browser seeds. Reference imagery and application source are not copied into these screenshots.

Each desktop set has `harvest-light`, `harvest-dark`, `studio-light`, and `studio-dark` variants at a 1440×1000 viewport (full-page captures may be taller):

- `sign-in-*.png`
- `workspace-*.png`
- `contacts-empty-*.png`
- `contacts-list-*.png`
- `contact-detail-*.png`
- `appearance-*.png`

Mobile list/detail sets have the same four variants at a 390×844 viewport: `contacts-list-mobile-*.png` and `contact-detail-mobile-*.png`.

Additional screenshots cover the open account menu, consent and erasure dialogs, the open Calendar/Popover date picker, 21-contact pagination, the list after erasure, contact-create network failure with retry, search with no results, unknown contact, view-only access, and a denied workspace. Filename suffixes identify the actual theme/mode of those states.

`axe-results.json` contains the check totals for all 43 captured screens: zero violations and 1,704 successful rule results. Every run regenerates these images from the actual UI; assertions also check keyboard date selection and UTC persistence in a Europe/Berlin browser, future-occurrence API rejection, later-recorded withdrawal precedence, keyboard theme selection/save/reload and precedence, Pagination next/previous with 21 contacts and `aria-current`, strict extra-tenant body rejection, non-member route denial, contact erasure, HTML pre-paint initialization, no horizontal mobile overflow, mobile sidebar navigation, role denial and tenant isolation. No deployment is involved. See the [round 3 contracts and results](../../acceptance/pr01b-round3.md) and [opened reference-screen mapping](../../acceptance/pr01b-round2.md).

`contrast-results.json` records the measured unselected radio border-to-card ratios: Harvest light 6.26:1, Harvest dark 7.10:1, Studio light 5.66:1, Studio dark 5.11:1. Every palette exceeds 3:1.

Studio white cards remain the DESIGN.md section 6 default pending product-owner visual review. Compare [Harvest light](contacts-list-harvest-light.png) with [Studio light](contacts-list-studio-light.png), and [Harvest dark](contact-detail-harvest-dark.png) with [Studio dark](contact-detail-studio-dark.png).
