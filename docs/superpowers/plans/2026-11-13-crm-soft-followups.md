# CRM soft follow-ups plan

Spec: `docs/superpowers/specs/2026-11-13-crm-soft-followups-design.md`.

1. Write `tests/integration/crm-associations-races.test.ts` (N1, N2) and confirm both fail on main.
2. `src/server/crm-associations.ts`: lock the person row before the consent read (N2); insert with `ON CONFLICT DO NOTHING` and return the existing row as a duplicate (N1).
3. Run the new test and the association, events and AI-tool suites, plus `crm07-upgrade` as the non-root user.
4. `tsc`, eslint on the changed files, `scripts/check-source.ts`, unit project.
5. Record decisions in `docs/acceptance/crm-soft-followups.md`; update the parked lists in `crm-07.md`.
6. Push, open a draft PR. No CI dispatch, no reviewer contact.
