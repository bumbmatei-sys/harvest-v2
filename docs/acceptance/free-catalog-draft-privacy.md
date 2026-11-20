# Free catalog draft privacy and address conflicts

A duplicate item address on create or edit returns HTTP 400 with `details.reason: address_unavailable`, for both a same-ministry item and a hidden draft in another ministry. The error includes no item or ministry data. A stale edit still returns HTTP 409. Address uniqueness remains global.

Migration `0067_catalog_draft_privacy` narrows the metadata RLS policy. Members and viewers cannot read draft titles, summaries or addresses through list, detail or direct SQL reads under the application role. Owner and admin editing continues to use the staff policy. Published and archived metadata use their existing scope, and the separate anonymous and enrolled catalog rules remain in effect.

This follows #146. Its journal and snapshot continue after #152, #153 and the member-profile follow-up. All five HC-02 gates remain **UNAPPROVED**. Hosted Neon and production were outside verification scope.

## Verification

Lint and typecheck passed locally. The full unit project passed 1,218 tests in 95 files. The full integration project passed 885 tests in 106 files against disposable loopback PostgreSQL.

The 7 focused catalog integration tests covered draft metadata, direct SQL and the duplicate-address response.
