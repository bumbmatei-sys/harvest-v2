# Dashboard data

Both endpoints require a verified session and use private, no-store responses.
Each block uses its feature gate, existing access checks, and ministry scope.
A missing block is unavailable to the caller. Chart counts below five use
a null value with the response's `smallGroupLabel` for display.

## Ministry Home

`GET /api/workspaces/:id/home` returns 12 Monday-start weekly buckets for
people added and community activity in the ministry time zone, the next five
visible published events, the latest three frozen newsletter campaigns with
sends and clicks available from the analytics window, and only the caller's
open CRM and campaign tasks. Social contains daily counts for the current
ministry week when scheduling is available. Giving compares this month to
last month by currency and is available to owners and admins. The giving
series uses confirmed gifts, applies reversals against the original gift
month, and excludes pledges.

## Campaign summary

`GET /api/workspaces/:id/campaigns/:campaignId/summary` returns dated
goal and raised, planned and spent, and per-department task snapshot
series. Money uses decimal cent strings and an accompanying currency.
Connect returns the last 30 completed UTC dates for scans and responses.
Response counts include coarse erasure tombstones while those records
remain in retention. An additional Connect cell is withheld when the
campaign total could expose a small group by subtraction. Event sign-ups
are eligible going RSVPs for linked published events, grouped by UTC event
start date. The endpoint returns no response, donor, or attendee fields.
