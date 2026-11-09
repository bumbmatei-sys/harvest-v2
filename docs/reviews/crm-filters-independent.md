# Shared CRM filters — independent source review

9 November 2026. New non-author review session `independent_filter_review`, separate from the implementation session, as required by CLAUDE.md. Final reviewed source head: `84d62b0e0c65f1bd5bb840b7bf50d0055d55e8e9`, against main `ca4fea8`.

Outcome: **No blockers or remaining source-review findings.** This is independent source review, not independent browser/build certification or merge authorization.

Reviewed shared panel and toolbar state, cancellation/unmount, chip edits/removal, limits, typed validation, URL/saved-view serialization and permission/predicate boundaries. No new domain permissions, SQL predicate, schema or provider activation was introduced. Independently ran the focused CRM-fields unit suite: 17/17 passed on the earlier serializer/source snapshot.

Observations resolved during review:

- Existing relation selection initially lost its visible name in the editor. Authorized related-name mapping now initializes the editor and retains newly staged names.
- Clear-last-saved-view acceptance needed reload/export assertions. Browser regression now explicitly verifies reload, count and CSV results after clearing.
- Tooltip initially toggled controlled/uncontrolled state. Final code keeps it consistently controlled, suppresses it while the filter panel is open and portals it within the local main landmark. Parent browser tests originally detected the landmark issue.

Final reviewer statement: “No blockers or remaining source-review findings. Tooltip state is now consistently controlled, suppressed while the filter panel is open, and portaled within the local landmark. Prior relation-label and saved-view regression observations remain resolved.”

Final runtime validation and screenshots are parent-executed and recorded in [acceptance](../acceptance/crm-filters.md). Subsequent evidence-only commits must not be described as independently runtime-certified. Hosted CI and founder merge/deploy approval remain separate.

## Header sizing follow-up

Independent review of exact source `027770bf672cc223caba076be00bee28318f77c8`: no blockers. Five one-line changes use the existing responsive variant (36px desktop / 44px below 1024px), removing Export's competing minimum-height override. Shared ContactForm also grows consistently in the Organization People section. Dialog footers, permissions, actions and filter behavior are unchanged. Browser measurements are author-executed; `git diff --check` passed.
