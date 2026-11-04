# Email-code sign-in setup

The environment contains `RESEND_API_KEY`. No Resend API request was made and no email was sent during this setup session.

## EMAIL_FROM

`EMAIL_FROM` is required before enabling sign-in delivery. It is currently absent from the session environment. Set it to the approved sender address on the existing Resend account's verified sending domain, optionally with the Harvest display name. Reuse the existing account/domain specified by the foundation brief; obtain the exact approved sender without guessing or changing DNS.

Resend's `from` field requires a sender address; see the [send-email reference](https://resend.com/docs/api-reference/emails/send-email) and [verified-domain requirement](https://github.com/resend/resend-skills/blob/main/skills/resend/references/sending/overview.md). Keep `RESEND_API_KEY` in the environment and out of commits, logs, test snapshots, and PR descriptions. Configure `EMAIL_FROM` locally when provided; this task authorizes no Vercel environment changes.

## Implemented foundation and verification

The foundation now wires Better Auth's email-code callback to `src/server/email.ts`, using `RESEND_API_KEY` and `EMAIL_FROM`. Password and OAuth sign-in are disabled. Codes are six digits, stored as a keyed hash, expire after ten minutes, permit five failed attempts and enforce a database-backed 60-second resend cooldown before code rotation.

Integration tests run the actual Better Auth/Drizzle stack against local PostgreSQL with the Resend SDK mocked. Browser tests alias the mailer only in a development E2E build and use an isolated local test mailbox. Both test paths override any real credentials and send no email. Provider failures are surfaced safely, and the verified code/session flow persists and audits sign-in.

The remaining delivery prerequisite is the approved `EMAIL_FROM` value. No live delivery test has been authorized or performed. See [PR 01a evidence](../acceptance/pr01a.md) and [Neon setup](neon.md) for the current implementation and passing test totals.
