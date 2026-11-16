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
No server change; no new copy; "withdrawal for a purpose with no recorded state" was reachable only through the Consent history form; closed by the row-withdrawal follow-up below. CI not verified here.

## Follow-up (CI fix)
The e2e axe helper ran unfiltered (best-practice rules) and could audit a half-rendered page (`page-has-heading-one`). It now uses the repo's tag set (wcag2a, wcag2aa, wcag21aa) and waits for the person h1 and permissions list first. The person page does render an h1 (via the record title); no page structure changed. `ConsentForm` `statuses` is now required (no silent default).

## Follow-up: withdrawal from a row with nothing recorded
A purpose row with no recorded state now offers "Record withdrawal" as well as "Record opt-in", each by permission (`rowActions` in `src/lib/consent-controls.ts`). Owners and admins see both; members only the withdrawal; viewers neither. The dialog is preset to Withdrawn with only that status selectable. Rows in other states are unchanged. No server change: `recordConsent` already accepts a withdrawal with no prior state, and no new copy (existing catalogue strings). Tests: unit `rowActions`; e2e "a purpose with nothing recorded offers a withdrawal from its row" (owner both, member end to end, viewer neither, 44px, axe at 390 light/dark). Existing e2e counts were updated for the extra buttons on rows with nothing recorded.
