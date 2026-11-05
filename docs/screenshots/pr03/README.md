# PR 03 verification evidence

All account, workspace and contact data in these screenshots is synthetic. The browser suites use disposable local PostgreSQL and local email/storage mocks.

| Screen | Variants |
| --- | --- |
| `sign-in`, `workspaces`, `contacts`, `contact-detail`, `files`, `appearance`, `profile` | `harvest-light`, `harvest-dark`, `studio-light`, `studio-dark` |
| `offline` | All four variants, plus the default `offline.png` |
| `production-offline.png` | Production worker registration and network failure |

The 28 main-screen axe results are in `axe-results.json`, with zero violations. The offline Playwright test also runs axe in every variant. Rendered component classes and inline styles are checked for literal colors. Registry tests check complete palettes and contrast, including dark text on gold at rest and hover.

`lighthouse.json` records Lighthouse 13.6.0 accessibility **100**, best practices **100**, and the custom Harvest PWA installability audit **100**. This custom audit is explicitly supplied because this Lighthouse version no longer includes the old PWA category: it checks Chromium's manifest/installability diagnostics and automatic activation of the production worker. Both error lists are empty. `production-offline.json` records successful production fallback, zero axe violations and the exact four public cache entries.

Validation on 5 November 2026:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed, including copy/color source guards |
| `npm run typecheck` | Passed |
| `npm test` | 84 passed |
| `npm run test:rls` | 91 passed, including migrations and profile isolation |
| `npm run test:e2e` | 6 passed in 2.7 minutes; upload progress, theme menu, profile persistence, offline fallback and axe |
| `npm run build` | Passed |
| `npm run test:pwa` | Passed against the local production build |

Reproduce with the commands above. `test:e2e` and `test:pwa` regenerate their screenshot/report evidence. CI uploads the browser report, traces on failure and this directory. Cloud database verification remains skipped on this branch under the explicit no-cloud-resources instruction.
