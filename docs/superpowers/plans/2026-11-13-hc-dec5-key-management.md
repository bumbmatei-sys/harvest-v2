# HC-DEC5 key-management groundwork (plan)

Spec: docs/superpowers/specs/2026-11-13-hc-dec5-key-management-design.md

1. Tests first: tests/unit/connect-key-management.test.ts (provider, v1 and v2 envelopes, audit, rotation) and tests/unit/connect-crypto-guard.test.ts.
2. Add connect-key-provider.ts; route connect-intake-crypto.ts keys through it; seal as version 2; open v1 and v2.
3. Add connect-decrypt.ts and switch the three call sites in connect-invitations.ts.
4. Add connect-key-rotation.ts.
5. Docs: acceptance record with decisions, limits and activation gates.
6. Verify: unit and integration suites (HC-05, HC-06B, HC-07, owner and upgrade suites as non-root), tsc, eslint on changed files, scripts/check-source.ts.
