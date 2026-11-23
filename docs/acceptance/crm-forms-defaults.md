# Hosted forms server defaults (PR 1)

Founder-approved 23 Nov ("approve all"); see `docs/decisions/founder-decisions-2026-11.md`. Migration `0081_crm_form_defaults` (main ended at 0080; no open PR claimed 0081 when checked). Hosted forms stay hard-off in production (`CRM_FORMS_PRODUCTION_ENABLED = false` plus the `harvest_test` database-name gate). HC-02 activation gates stay UNAPPROVED. No real outbound sends.

## Done

- **Rate limits.** Per visitor per form 5/min, per visitor across forms 20/min, per ministry 300/min (replaces the 600 all-forms bucket), and proof issuing (`GET /f/:slug`) 30/min per visitor. Visitor buckets are checked before the ministry bucket, so one visitor cannot spend it and one ministry cannot lock out another. A limited request returns the same neutral `429 {"error":"rate_limited"}` with `Retry-After: 60`. Unknown, retired and disabled forms still return the same 404 and are not charged. Requests from a rejected origin are not charged.
- **Visitor key.** The client address from the sign-in configuration (`AUTH_IP_ADDRESS_HEADERS`, default `x-forwarded-for`; `AUTH_TRUSTED_PROXIES`), through the same parser, then an HMAC with the forms key. Only the hash reaches the database, in quota rows that are deleted after two minutes. Node deployments must configure a trusted header: a bare `x-forwarded-for` is client-controlled. Workers use `cf-connecting-ip`, which Cloudflare sets; hosted forms are not served from Workers yet. With no usable address the request gets a neutral 503 before any lookup.
- **Retention.** New responses expire after 90 days (was 30). Existing responses keep their stored expiry: extending them would change retention for data already collected, so it is not done silently.
- **Purge.** The manual owner/admin purge is unchanged. No schedule is installed. When CF-04 (hard-off) is enabled the purge should run daily with a failure alert. It is documented only: the job registry has no per-ministry purge executor, so adding an entry is not a one-line change.
- **Consent.** The ministry's own consent text is unchanged and editable. Harvest always adds "Your details go to [ministry name]. You can ask them to delete them." The ministry name is stamped into the publication at publish time and returned in the manifest, so later renames do not change a published version. Publications made before 0081 have no stored name and show neutral wording ("the ministry that published this form"). The checkbox starts unticked and no newsletter or follow-up permission is assumed. The line appears in the shared public form renderer, which the builder Preview tab and Settings preview also use. The builder canvas consent card is unchanged.

## Deferred

- Separate unticked newsletter and follow-up boxes (later feature, nothing added).
- Scheduled purge, failure alert and per-ministry retention maximum (CF-04).
- Extending expiry on existing responses.
- Load testing and tuning of the numbers at event bursts.

## Evidence

- `tests/integration/crm-hosted-forms.test.ts`: per-form and per-visitor limits, proof cap, visitor isolation, ministry isolation, neutral errors, no raw address in quota scopes, 90-day expiry, frozen ministry name.
- `tests/unit/crm-form-fixed-notice.test.ts`: fixed line, fallback wording, unticked box, visitor key derivation.
