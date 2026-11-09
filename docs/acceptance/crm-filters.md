# Shared CRM filters — bounded Phase 0B

Base: main `ca4fea8` (#41); main fetched and matched. Separate branch `feat/crm-shared-filters-20261109`. Open #38 changes copy/appearance, not these filter files; it was not merged or included. #43 review remains independent of product development; #42 and parked #16 untouched.

## Behavior and reuse

People and Organizations reuse ListPage/ListToolbar, FilterBuilder, shadcn Popover/Tooltip/Command/fields/controls, existing translations, validated field metadata, URL state, saved views and server list/count/export predicates. One icon-only Filters trigger opens grouped searchable authorized fields. Existing details/custom-field types and email-marketing permission rules only; no invented Source/follow-up filter. Conditions combine with the existing AND contract, with exclusion available through supported negative operands. No new boolean-group or provenance semantics.

Draft changes may be added, edited or removed, with local validation and the existing ten-condition limit. Add/Update condition stages another rule; Apply filter applies the full draft and current editor atomically. Cancel, Escape or outside dismissal changes no applied results. Clear all inside the panel is staged; toolbar Clear filters retains its existing immediate clear-search-and-filters behavior. Applied chips show three rules and +N more, support edit/remove, and use 44px targets on smaller screens.

Browser testing found clearing the last saved-view filter could produce only `view=id` and restore the saved condition. `stateToParams` now includes an explicit `q=` for URLs with a view ID, distinguishing default-state override from an intentional view-only load. A unit regression plus browser saved-view clear/reload/export checks protect this fix. Server authorization and predicate compilation are unchanged.

## Evidence

- Lint/source guards passed; initial sandbox runs could not create tsx IPC sockets. Reran with local socket permission.
- Final unit suite: 26 files, **298/298 passed**, including the serializer regression. Focused integration: **27/27 passed** (`crm-fields-views`, `crm-import-export-isolation`) against disposable local PostgreSQL. Typecheck passed.
- New `tests/e2e/crm-filters.spec.ts` exercises staged/cancel/outside/Escape, invalid input, chip editing/removal, limit/overflow, saved view, export count/file agreement, foreign-tenant denial, viewer empty-result browsing, and both consumers at 360/390/768/1280/1440 in light/dark with axe.
- Existing CRM and CRM-03 browser suites cover relation/custom-field rules, persisted views and permission regressions. Relevant existing integration tests are reused.
- Screenshots: `docs/screenshots/crm-filters/`. Browser tests use disposable PostgreSQL, mock email/storage, synthetic identities only. No Neon/provider call or production data.

Independent review, final CI and founder merge approval are separate gates. No deployment, production intake activation, real invitations/payments/messages or HC-06 implementation. Five HC activation decisions remain unapproved.


## Final runtime closeout

Runtime source: `84d62b0e0c65f1bd5bb840b7bf50d0055d55e8e9`; independent source review at that exact head found no blockers ([review](../reviews/crm-filters-independent.md)). Subsequent commits contain evidence only.

- Final browser invocation: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test tests/e2e/crm.spec.ts:121 tests/e2e/crm-filters.spec.ts tests/e2e/ui-showcase.spec.ts` — **4/4 passed**, no retries, 7.0 minutes. Shared filters (two tests), full CRM create/edit/link/filter/isolation/accessibility flow, and showcase exposure guard. The showcase flag was off; no claim of full interactive showcase validation in this invocation.
- Prior combined invocation: 4/5 passed, including CRM-03 custom fields/saved views/keyboard grid and company People-tab overflow. The failed full CRM flow identified a real body-portaled tooltip landmark issue; final code keeps the tooltip within the list landmark and consistently controls its state. That previously failing flow passes in the final invocation. No test assertion was relaxed.
- Earlier new-filter-only invocation found the last-filter saved-view restoration bug, fixed in shared URL serialization; final saved-view clear, reload, export count/file tests pass for both consumers.
- 40 panel/editor screenshots, 20 viewport/theme/consumer combinations with axe and geometry checks; implementation session inspected full contact sheets and representative full-size images. Source review is independent; browser/visual evidence is author-executed.
- Test harness uses synthetic local fixtures, mocked storage/mail and a disposable database. Existing note-textarea caret-style hydration warning and a destination-stream diagnostic appeared in dev-server logs; suite passed with no captured browser page errors. Cause of the latter was not established; no claim of globally clean logs.
- Production build: `NEXT_TELEMETRY_DISABLED=1 npm run build` — **passed**, including TypeScript, static page generation and build tracing. Final lint/source guards passed. No schema/dependency change; migrations and hosted Neon/provider suites were not rerun beyond the focused local integration setup. PWA/Lighthouse/complete unrelated browser suite and live CircleCI certification are not claimed.

Draft PR: [#44](https://github.com/bumbmatei-sys/harvest-v2/pull/44). Craft launch decisions and existing Now filter task reconciled. Hosted exact-head CI remains a separate requirement before merge; no workflow mutation or infrastructure merge was made to bypass it.

## Header button alignment follow-up

Founder reported Export taller than the other actions. Source `027770b` replaces its fixed 44px minimum with canonical `responsive` sizing, and applies the same size to People/Organizations Import links and shared ContactForm/CompanyForm triggers. All three header actions are now 36px on desktop and 44px below 1024px. Dialog footer controls and domain behavior are unchanged.

Standalone Chromium measurements passed on both list consumers at 390/768/1440px, light/dark (12 combinations), using a disposable database and synthetic empty workspace. Every Import/Export/Add height was 44/44/36px respectively; two updated desktop screenshots are `header-actions-light.png` / `header-actions-dark.png`. Typecheck and changed-file ESLint passed. Independent non-author review of exact source `027770bf672cc223caba076be00bee28318f77c8`: no blockers. Earlier full unit/integration/browser/build evidence above predates this styling-only follow-up; no redundant full suite was run. Initial temporary measurement script needed its browser base URL configured and the header Add control distinguished from the empty-state duplicate; these were harness corrections, not application failures. No persistent test added for this reversible styling fix.
