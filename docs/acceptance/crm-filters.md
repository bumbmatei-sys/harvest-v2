# Shared CRM filters — bounded Phase 0B

Base: main `ca4fea8` (#41); main fetched and matched. Separate branch `feat/crm-shared-filters-20261109`. Open #38 changes copy/appearance, not these filter files; it was not merged or included. #43 review remains independent of product development; #42 and parked #16 untouched.

## Behavior and reuse

People and Organizations reuse ListPage/ListToolbar, FilterBuilder, shadcn Popover/Tooltip/Command/fields/controls, existing translations, validated field metadata, URL state, saved views and server list/count/export predicates. One icon-only Filters trigger opens grouped searchable authorized fields. Existing details/custom-field types and email-marketing permission rules only; no invented Source/follow-up filter. Conditions combine with the existing AND contract, with exclusion available through supported negative operands. No new boolean-group or provenance semantics.

Draft changes may be added, edited or removed, with local validation and the existing ten-condition limit. Add/Update condition stages another rule; Apply filter applies the full draft and current editor atomically. Cancel, Escape or outside dismissal changes no applied results. Clear all inside the panel is staged; toolbar Clear filters retains its existing immediate clear-search-and-filters behavior. Applied chips show three rules and +N more, support edit/remove, and use 44px targets on smaller screens.

Browser testing found clearing the last saved-view filter could produce only `view=id` and restore the saved condition. `stateToParams` now includes an explicit `q=` for URLs with a view ID, distinguishing default-state override from an intentional view-only load. A unit regression plus browser saved-view clear/reload/export checks protect this fix. Server authorization and predicate compilation are unchanged.

## Evidence (updated at closeout)

- Lint/source guards passed; initial sandbox runs could not create tsx IPC sockets. Reran with local socket permission.
- Unit suite before final serializer regression: 297/297 passed outside sandbox. Final unit/build/browser results pending below.
- New `tests/e2e/crm-filters.spec.ts` exercises staged/cancel/outside/Escape, invalid input, chip editing/removal, limit/overflow, saved view, export count/file agreement, foreign-tenant denial, viewer empty-result browsing, and both consumers at 360/390/768/1280/1440 in light/dark with axe.
- Existing CRM and CRM-03 browser suites cover relation/custom-field rules, persisted views and permission regressions. Relevant existing integration tests are reused.
- Screenshots: `docs/screenshots/crm-filters/`. Browser tests use disposable PostgreSQL, mock email/storage, synthetic identities only. No Neon/provider call or production data.

Independent review, final CI and founder merge approval are separate gates. No deployment, production intake activation, real invitations/payments/messages or HC-06 implementation. Five HC activation decisions remain unapproved.
