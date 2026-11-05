# CRM-01/02 screenshots

Captured by `tests/e2e/crm.spec.ts` in headless Chromium against the e2e server (real PostgreSQL 16, mocked email), Harvest brand, Europe/Berlin time zone, reduced motion. Desktop captures use a 1440px viewport and mobile captures 390px. Captures grow to the full content height. Every screen except `people-loading-light` was scanned with axe-core: `accessibility.json` lists 30 scans with 0 violations. The loading state is transient and was not scanned.

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
