# Newsletter click report privacy

Working migration 0142 replaces the report function used by both the ministry overview and the individual campaign report. The function can be called by the application role, so the privacy rule lives in PostgreSQL.

The report uses whole UTC days with an inclusive start and exclusive end. It determines visibility separately for each campaign and day before adding up a requested period. Each reported link on that day must have at least five deduplicated delivery IDs. If a campaign went to fewer than five recipients or any of its clicked links had fewer than five clicks that day, the whole campaign day is withheld. The rule also works on anonymous archived link counts.

Campaign link counts add only eligible daily buckets. A period total is withheld whenever it would include a withheld campaign day. Withholding both the link counts and that day's total avoids revealing a small count by subtracting the other links from the total. Expanding the date range can add eligible daily values and cannot release a previously withheld daily value. The top-ten list ranks the sums for the requested period. Some reported link totals therefore cover only the dates on which their campaign could publish all link counts safely.

The report paths and their database function require a ministry owner or admin role. A delegated newsletter grant does not give access to these reports. Reports expose link click totals only and introduce no new data collection. The boundary test covers the same instant expressed with different offsets and database session time zones. This change addresses differencing across requested dates at a given reporting snapshot. It does not freeze the current day's totals as new clicks arrive.

No activation approval is requested.
