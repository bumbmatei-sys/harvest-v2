# Newsletter click report privacy

Working migration `0137_newsletter_click_fixed_buckets` (first drafted as 0142, re-chained after main's 0135; final numbers are assigned at merge) replaces both click report functions: `newsletter_click_report` (ministry overview and campaign report) and `newsletter_automation_click_report` (automation Activity tab). The function can be called by the application role, so the privacy rule lives in PostgreSQL.

The report uses whole UTC days with an inclusive start and exclusive end. It determines visibility separately for each campaign and day before adding up a requested period. Each reported link on that day must have at least five deduplicated delivery IDs. If a campaign went to fewer than five recipients or any of its clicked links had fewer than five clicks that day, the whole campaign day is withheld. The rule also works on anonymous archived link counts.

Campaign link counts add only eligible daily buckets. A period total is withheld whenever it would include a withheld campaign day. Withholding both the link counts and that day's total avoids revealing a small count by subtracting the other links from the total. Expanding the date range can add eligible daily values and cannot release a previously withheld daily value. The top-ten list ranks the sums for the requested period. Some reported link totals therefore cover only the dates on which their campaign could publish all link counts safely.

The report paths and their database function require a ministry owner or admin role. A delegated newsletter grant does not give access to these reports. Reports expose link click totals only and introduce no new data collection. The boundary test covers the same instant expressed with different offsets and database session time zones. This change addresses differencing across requested dates at a given reporting snapshot. It does not freeze the current day's totals as new clicks arrive.

## Automation report (review follow-up)

The independent review found that `newsletter_automation_click_report` (0133) still decided small steps and days across the whole requested range and added link totals across days, so two overlapping ranges could be subtracted (step with link A at 6 clicks on day 1 and 2 on day 2, each step-day at 5 or more: [d1,d2) showed A = 6, [d1,d3) showed A = 8). The same migration now replaces it with the campaign cell model, with the step in the campaign's place:

- A cell is one step, one UTC day and one link. A step-day is withheld when any of its link cells is under five or the step's emails reached fewer than five people. Withholding depends only on that step-day, never on the range.
- Day, step and period totals are withheld whenever they include a withheld step-day. Link totals add only cells of shown step-days, so overlapping ranges differ only by whole shown cells of five or more.
- The earlier "leave out the smallest shown link" rule is no longer needed, because every shown cell is at least five.
- Access is owners and admins only in the database (`access_role(..., 'owner_admin', ...)`, which is never grantable) and in `automationClicks`; a delegated newsletter grant is refused (404 in the app, 42501 from the function). Search path stays pinned; the function only saves and restores its own `app.nl_send_tenant` and `app.nl_auto_private` flags and reads no forgeable flag.

Tests in `tests/integration/newsletter-automation-clicks.test.ts`: the reviewer's two-range case ([d1,d2), [d1,d3), [d2,d3) and a later safe day), with clicks written at UTC day edges in +02:00 and -04:00 and reports run under the Pacific/Kiritimati, America/Los_Angeles, Asia/Kolkata and UTC session time zones; the app path for the same data; and the delegated-manager refusal. Both new tests fail against the 0133 function and pass with 0137. Existing automation tests pass unchanged.

Rules kept: clicks only, totals only, owners and admins only, no IP, under-5 withheld. Synthetic data only.

No activation approval is requested.
