# Shared filter panel evidence

Synthetic local fixtures only. `tests/e2e/crm-filters.spec.ts` generates People and Organizations panel/editor screenshots at 360, 390, 768, 1280 and 1440px in light and dark modes (40 images).

The suite asserts viewport-bounded panel geometry and mobile/tablet 44px controls, and runs axe on all 20 open-panel combinations plus applied/closed states. The implementation session inspected the full matrix as contact sheets and representative images at full size. This is author-executed evidence, not independent visual certification.

Runtime source reviewed independently: `84d62b0`. Review and acceptance: `docs/reviews/crm-filters-independent.md`, `docs/acceptance/crm-filters.md`.

Header sizing follow-up at source `027770b`: `header-actions-light.png` and `header-actions-dark.png` show aligned Import/Export/Add actions. Standalone measurements covered People/Organizations at 390/768/1440 in both modes. The earlier 40 filter screenshots remain evidence for source `84d62b0` and predate this sizing follow-up.
