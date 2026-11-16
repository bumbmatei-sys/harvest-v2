# PR 0a: consent controls follow permissions

## What changed
The person page now shows consent controls by permission. The server already enforced this (`recordConsent`: grants and "unknown" need `contacts:attest_consent`, withdrawals need `contacts:record_withdrawal`); no server code changed.

- `src/lib/consent-controls.ts`: `consentControls(role)` derives `canGrant`, `canWithdraw` and the selectable statuses from `can()`.
- Person page computes it on the server and passes booleans/statuses down.
- `ConsentForm` takes `statuses` and offers only those.
- `ContactPermissions` shows a row's opt-in button only with `canGrant` and its withdrawal button only with `canWithdraw`.

## Role matrix
| Role | Opt-in row buttons | Withdrawal row buttons | Record consent form statuses | State shown |
|---|---|---|---|---|
| owner, admin | yes | yes | Unknown, Granted, Withdrawn | yes |
| member | no | yes | Withdrawn only | yes |
| viewer / unknown | no | no | form hidden | yes, read-only |

## Tests
- Unit: `tests/unit/consent-controls.test.ts`; full unit project 819 passed.
- E2E: `tests/e2e/pr0a-consent-controls.spec.ts` (owner, admin, member end-to-end withdrawal, viewer read-only and API 403, axe at 390 light/dark for member and viewer, no horizontal overflow, 44px target). Also re-ran `crm07.spec.ts` and `pr01b.spec.ts`: pass.

## Not done
No server change; no new copy; "withdrawal for a purpose with no recorded state" is reachable only through the Consent history form (rows offer opt-in for that state). CI not verified here.
