# CRM-01/02 screenshots

Captured by `tests/e2e/crm.spec.ts` in headless Chromium against the e2e server (real PostgreSQL 16, mocked email), Harvest brand, Europe/Berlin time zone, reduced motion. Desktop captures use a 1440px viewport, wide captures (`*-wide-*`) 1920px, tablet captures (`*-tablet-*`) 1024×900 with the sidebar expanded, and mobile captures 390px. Captures grow to the full content height. Every screen except `people-loading-light` was scanned with axe-core: `accessibility.json` lists every scan; all have 0 violations. The loading state is transient and was not scanned.

| State | Light | Dark |
| --- | --- | --- |
| People, empty workspace | people-empty-light.png | people-empty-dark.png |
| People list (24 rows, page 1 of 2) | people-list-light.png | people-list-dark.png |
| People list, mobile | people-list-mobile-light.png | people-list-mobile-dark.png |
| People, company + "No email" filters | people-filtered-light.png | — |
| People, no matching search | people-no-results-light.png | people-no-results-dark.png |
| People, loading (real slow query: table lock) | people-loading-light.png | — |
| Person record (inline fields, companies, activity) | person-detail-light.png | person-detail-dark.png |
| Person record, mobile | person-detail-mobile-light.png | person-detail-mobile-dark.png |
| Person, inline duplicate-identifier error | person-inline-duplicate-error-light.png | — |
| Person, same-name suggestion (no merge) | person-possible-duplicate-light.png | — |
| Person, stale version rejected | person-stale-version-light.png | — |
| Person, viewer (read-only) | person-viewer-light.png | — |
| Companies, empty | companies-empty-light.png | companies-empty-dark.png |
| Companies list | companies-list-light.png | companies-list-dark.png |
| Companies list, mobile | companies-list-mobile-light.png | companies-list-mobile-dark.png |
| Create company dialog | company-create-dialog-light.png | — |
| Duplicate domain conflict with link to existing | company-duplicate-domain-light.png | — |
| Company record (people, activity) | company-detail-light.png | company-detail-dark.png |
| Company record, mobile | company-detail-mobile-light.png | company-detail-mobile-dark.png |
| Foreign company ID (not found) | company-not-found-light.png | — |
| People list, tablet 1024×900, sidebar expanded, long names | people-list-tablet-light.png | people-list-tablet-dark.png |
| Companies list, tablet 1024×900, sidebar expanded, long names/domains | companies-list-tablet-light.png | companies-list-tablet-dark.png |
| People list, wide (full-width shell) | people-list-wide-light.png | people-list-wide-dark.png |
| Person record, wide (three columns) | person-detail-wide-light.png | person-detail-wide-dark.png |
| Companies list, wide | companies-list-wide-light.png | companies-list-wide-dark.png |
| Company record, wide (three columns) | company-detail-wide-light.png | company-detail-wide-dark.png |

## Layout (2026-11-05 revision)

The shell content is full width with compact gutters: 16px on phones and 24px from 1024px. The back link sits directly under the breadcrumb, on the same left edge. Record pages adapt by width:

- **1536px and wider:** three regions side by side (profile, context, history).
- **1024–1535px:** two columns, with history as a full-width row below.
- **Phones:** a single stack.

`tests/e2e/helpers/layout.ts` asserts, on every captured screen:

- the content area has no `max-width` and spans the full inset width;
- the gutters are exactly 16px or 24px;
- the breadcrumb and back link align with the content edge;
- the document never scrolls sideways;
- no element is clipped and no table scrolls sideways.

The non-CRM screens (workspaces, files, appearance, profile) are captured under [`../layout/`](../layout/) at 1920px and 390px, in light and dark, with axe and the same layout checks.

### List columns (2026-11-05 tablet fix)

List tables choose columns by the **card's width** (container queries), not the viewport, because the sidebar's state changes the space available. They use a fixed layout: secondary columns have exact widths, and Name takes the rest and truncates.

| Card width | People columns | Companies columns |
| --- | --- | --- |
| below 576px | Name, with company or email underneath | Name (domain underneath), People |
| 576px+ | + Company (192px) | + Domain (240px) |
| 672px+ | + Email (224px) | — |
| 768px+ | — | + Added (112px) |
| 896px+ | + Email marketing (136px) | — |
| 1024px+ | + Added (112px) | — |
| 1280px+ | + Phone (144px) | — |

At 1024×900 with the sidebar expanded, the card is about 688px wide, so People shows Name, Company and Email, and Companies shows Name, Domain and People.
