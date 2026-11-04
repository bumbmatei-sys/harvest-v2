# Email-code sign-in setup

The environment contains `RESEND_API_KEY`. No Resend API request was made and no email was sent during this setup session.

## EMAIL_FROM

`EMAIL_FROM` is required before enabling sign-in delivery. It is currently absent from the session environment. Set it to the approved sender address on the existing Resend account's verified sending domain, optionally with the Harvest display name. Reuse the existing account/domain specified by the foundation brief; obtain the exact approved sender without guessing or changing DNS.

Resend's `from` field requires a sender address; see the [send-email reference](https://resend.com/docs/api-reference/emails/send-email) and [verified-domain requirement](https://github.com/resend/resend-skills/blob/main/skills/resend/references/sending/overview.md). Keep `RESEND_API_KEY` in the environment and out of commits, logs, test snapshots, and PR descriptions. Configure `EMAIL_FROM` locally when provided; this task authorizes no Vercel environment changes.

## Integration blocker

The available repository contains documentation only. There is no Better Auth configuration, email-code callback, dependency manifest, or test suite to wire or modify. Resend sign-in is **not implemented or verified** by this change.

When the existing foundation code is available, wire its email-code callback to Resend using `RESEND_API_KEY` and `EMAIL_FROM`. Keep delivery mocked in every test, including when a real key is present. Cover sender configuration, code delivery payload, missing configuration, and provider failures without making network calls or logging codes or credentials. Preserve the foundation brief's hashed code storage, expiry, attempt limit, and resend cooldown.
