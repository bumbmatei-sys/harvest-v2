# PR 01a workflow contracts and evidence

| Flow | Success | Error | Empty | Unauthorized |
| --- | --- | --- | --- | --- |
| Request code | Mocked/real adapter sends six-digit code; UI advances | Invalid email, provider failure, 60-second cooldown or HTTP limit appears as an alert | Email form with labelled field | Public sign-in only; other OTP purposes and auth mechanisms rejected |
| Verify code | User/session persisted; audit recorded; workspace page opens | Wrong, expired, replayed or exhausted code rejected | Code field appears after request | No session until code verification succeeds |
| List workspaces | Only verified memberships and tenant rows shown | Error boundary with retry | First-workspace prompt | Session required; signed-out navigation redirects |
| Create workspace | Workspace, owner membership and audit commit together | Validation/DB/audit failures roll back, UI alert | Empty form | No client-selected owner/tenant; anonymous and cross-origin mutations denied |
| Add member/change role | Existing user gets tenant-qualified membership; append-only audit | Unknown user, last-owner demotion and invalid roles rejected | No member invitation/send flow | Member/viewer denied; admins cannot change ownership; no foreign workspace access |
| Tenant data access | Only verified tenant context visible | Foreign writes rejected; callbacks never run without membership | No context returns zero tenant records | Server sessions and membership checks gate context |

Validation on 2026-11-04:

- Unit tests: permission matrix and unavailable payment adapter.
- Local PostgreSQL integration: actual Better Auth/Drizzle persistence, mocked Resend, expiry, five wrong attempts, single-use codes, code rotation, per-email cooldown, persistent HTTP limit, session logout and audit.
- RLS: tenant read/write isolation, forged workspace denial, immutable audit, audited-write rollback, restricted app role, and pool context reset after commit/rollback with matching backend PID.
- Neon dev: migration applied; five live RLS checks pass. Both pooled and direct app-role traffic verified; only synthetic dev seeds created, no email sent.
- Playwright Chromium: real UI → auth handler → PostgreSQL → session → workspace API → persisted reload → logout. Sign-in and workspace axe checks report zero violations. Desktop and mobile screenshots are captured under `test-results/` and uploaded by CI.
- Lint/typecheck/build and final test totals are recorded in the draft PR.

Limits: live email delivery was intentionally not exercised. EMAIL_FROM must be configured with the existing verified sender. Neon CI depends on repository secrets. Staging/prod migration verification, product owner sign-off, contacts, shell, dual-theme screenshots and theme switching are outside this PR 01a implementation. No deployment is performed.

Committed screenshots: [sign-in](pr01a/sign-in.png), [empty workspaces](pr01a/workspaces-empty.png), [created workspace](pr01a/workspaces-created.png), [mobile](pr01a/workspaces-mobile.png). Final local totals: 6 unit + 19 PostgreSQL integration + 5 Neon integration + 1 Playwright journey, all passing. Lint, strict typecheck, production build, and repeated dev migration also pass.
