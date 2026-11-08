# HC-07 browser evidence

Synthetic local fixtures only. The real email adapter is hard-disabled; the operator writes a local mocked mailbox. Visible addresses, codes and invitations belong to disposable test accounts, not real people.

The dual-theme journey captures invitation-only choice, pending receipt, secure preparation, sign-in, code verification, explicit confirmation, personal welcome on mobile/tablet, personal profile and safe replay failure. A separate existing-account journey exercises mismatch, account switching, decline, later confirmation and unchanged Organization membership.

Each metrics JSON records clean axe scans, no horizontal overflow and actual control measurements at least 44×44px. Screenshots are full-page; viewport is 390×844 for mobile and 768×1024 for tablet. Author visual assessment and exact successful run results are in [HC-07 acceptance](../../../acceptance/hc-07.md). This does not certify physical devices, crowd load, live delivery or activation policy.


| State | Light | Dark |
| --- | --- | --- |
| Invitation-only form | [mobile](invitation-form-mobile-light.png) | [mobile](invitation-form-mobile-dark.png) |
| Pending receipt | [mobile](pending-mobile-light.png) | [mobile](pending-mobile-dark.png) |
| Secure link preparation | [mobile](prepare-mobile-light.png) | [mobile](prepare-mobile-dark.png) |
| Email sign-in | [mobile](sign-in-mobile-light.png) | [mobile](sign-in-mobile-dark.png) |
| Code verification | [mobile](verification-mobile-light.png) | [mobile](verification-mobile-dark.png) |
| Explicit confirmation | [mobile](confirm-mobile-light.png) | [mobile](confirm-mobile-dark.png) |
| Personal welcome | [mobile](welcome-mobile-light.png) | [mobile](welcome-mobile-dark.png) |
| Personal welcome | [tablet](welcome-tablet-light.png) | [tablet](welcome-tablet-dark.png) |
| Personal profile | [tablet](profile-tablet-light.png) | [tablet](profile-tablet-dark.png) |
| Replay refusal | [tablet](replay-tablet-light.png) | [tablet](replay-tablet-dark.png) |

[Existing-account mismatch](mismatch-mobile-light.png) is checked separately, including switching, decline, reopening and preserved Organization membership. Dual-theme metrics persist ten scans per theme; the separate mismatch capture also asserts axe and target geometry in the browser test.
