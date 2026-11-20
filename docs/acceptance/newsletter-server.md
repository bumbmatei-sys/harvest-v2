# Newsletter server acceptance

PR #165 adds campaign drafts, immutable revisions, templates, mailbox and domain verification, fake delivery, aggregate analytics and worker-only retention. Campaign revisions store the authored subject, preheader and content and an unpersonalized preview. Per-recipient rendered messages, plaintext confirmation codes and raw callback bodies are transient. All five HC-02 gates remain **UNAPPROVED**. Production routes, provider transport and production workers are hard-off. No schedules are installed and production migrations are unapplied.

## Merge condition

Merging #165 before the social stack would have been unsafe. The original 0073 snapshot followed 0068, and applying 0073 early could have caused Drizzle to skip social migrations 0069–0072 when they arrived.

After #162 completed the social stack (#157, #159, #161 and #162), the newsletter branch was brought onto main `b4adf0bb1b808188f050de1a123c17e1d8e265d2` through merge commit `57d12b04bbb35d9e6434f36873e1d1bd7eb93ad0`. [PR #165 and current head](https://github.com/bumbmatei-sys/harvest-v2/pull/165)

Snapshot 0073 was regenerated from the full merged schema. Its `prevId` is the 0072 snapshot ID `cd1369ab-99f8-426c-ad37-8bbc9716a39f`, and it preserves all 21 social tables. Its journal entry has index 73 and timestamp `1795400000021`, immediately after 0072 at index 72 and timestamp `1795400000020`. Migration 0073 retains the hand-written SQL. A second `drizzle-kit generate` reported no schema changes. The journal and snapshot are ready for the single stack-end review.

## CRM merge chain

Migration 0073 calls `merge_contacts_before_newsletter_sending` from the public `merge_contacts` entry point to reconcile pending and attempted deliveries. That function is the NL-02 wrapper from 0060. It transfers restrictive subscription state and calls `merge_contacts_before_nl02`, the core CRM merge implementation. The core moves canonical consent and erases the source. Integration coverage checks all three effects in one reviewed merge.

## Before-activation review fixes

- The callback accepts SNS signature version 2 and signed notifications up to 24 hours old. Message-ID deduplication and delivery writes commit together. A verified event whose write fails receives 503, while malformed and unauthenticated input receive the same 202 as a successful replay.
- DMARC with `p=none` or stricter is mandatory. The API returns the verification flag and exact TXT record. The server and SQL cap scheduling at 60 days from review.
- Suppression digests are personal data, keyed with a versioned, injected HMAC secret. Reads check earlier versions and fail closed when a needed key is absent. CRM erasure removes delivery-linked digests when the canonical link is gone. Scoped unsubscribe rows are deleted on fresh verified signup. The retention exception for hard bounce and complaint blocks remains subject to privacy approval.
- Unresolved attempts transition to operator review after 48 hours. The worker logs per-ministry ages and separate state counts. Late eligible callbacks can reconcile them. The 90-day purge deletes both unresolved states and retains their anonymous counts.

[Activation runbook](../runbooks/newsletter-activation.md) · [Delivery and SES evidence](newsletter-sending.md)

## Verification

Lint and typecheck passed at the merged schema revision. The full unit project passed **1,336 tests in 103 files**. The full integration project passed **955 tests in 112 files** on embedded PostgreSQL.

A separate embedded PostgreSQL upgrade started at 0072 with a restricted migration owner. Applying the full journal added exactly one ledger entry for 0073 with the hand-written SQL checksum, preserved the 0072 ledger entries and was a no-op on repeat.

Hosted Neon, real DNS and mailbox ownership messages, real SES intake and event delivery, production quotas, received MIME and DKIM, hosted monitoring, and a fresh independent review of this follow-up remain unverified. [Delivery and SES evidence](newsletter-sending.md)
