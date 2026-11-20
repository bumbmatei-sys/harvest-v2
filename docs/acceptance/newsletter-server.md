# Newsletter server acceptance

PR #165 adds campaign drafts, immutable revisions, templates, mailbox and domain verification, fake delivery, aggregate analytics and worker-only retention. Campaign revisions store the authored subject, preheader and content and an unpersonalized preview. Per-recipient rendered messages, plaintext confirmation codes and raw callback bodies are transient. All five HC-02 gates remain **UNAPPROVED**. Production routes, provider transport and production workers are hard-off. No schedules are installed and production migrations are unapplied.

## Merge condition

**Merging #165 first is NOT safe.** Merge the social stack #157, #159, #161 and #162 (migrations 0069–0072) into main before #165. Migration 0073 currently follows the 0068 snapshot on the PR branch. Applying 0073 first can cause Drizzle to skip the earlier migrations when they arrive. Its journal timestamp is `1795400000021`.

After the founder confirms the stack is merged, merge main into `codex/newsletter-sending-server` and regenerate 0073 from the full merged schema. Set `prevId` to the 0072 snapshot ID, verify the snapshot includes the social tables and set the 0073 journal `when` strictly above 0072. Confirm that a second `drizzle-kit generate` reports no changes. Preserve the merged migration numbers.

## CRM merge chain

Migration 0073 calls `merge_contacts_before_newsletter_sending` from the public `merge_contacts` entry point to reconcile pending and attempted deliveries. That function is the NL-02 wrapper from 0060. It transfers restrictive subscription state and calls `merge_contacts_before_nl02`, the core CRM merge implementation. The core moves canonical consent and erases the source. Integration coverage checks all three effects in one reviewed merge.

## Before-activation review fixes

- The callback accepts SNS signature version 2 and signed notifications up to 24 hours old. Message-ID deduplication and delivery writes commit together. A verified event whose write fails receives 503, while malformed and unauthenticated input receive the same 202 as a successful replay.
- DMARC with `p=none` or stricter is mandatory. The API returns the verification flag and exact TXT record. The server and SQL cap scheduling at 60 days from review.
- Suppression digests are personal data, keyed with a versioned, injected HMAC secret. Reads check earlier versions and fail closed when a needed key is absent. CRM erasure removes delivery-linked digests when the canonical link is gone. Scoped unsubscribe rows are deleted on fresh verified signup. The retention exception for hard bounce and complaint blocks remains subject to privacy approval.
- Unresolved attempts transition to operator review after 48 hours. The worker logs per-ministry ages and separate state counts. Late eligible callbacks can reconcile them. The 90-day purge deletes both unresolved states and retains their anonymous counts.

[Activation runbook](../runbooks/newsletter-activation.md) · [Delivery and SES evidence](newsletter-sending.md)

## Verification

Lint and typecheck passed. The full unit project passed **1,235 tests in 97 files**. The full integration project passed **907 tests in 107 files** on embedded PostgreSQL. The focused newsletter and restricted migration-owner suites passed **27 tests in 3 files**. A final newsletter sending run passed **17 tests**, including the database review clock. Two local Drizzle checks reported no schema changes on the current 0068-based branch. Migration 0073 keeps its original snapshot ID, previous ID and journal entry.

Hosted Neon, real DNS and mailbox ownership messages, real SES intake and event delivery, production quotas, received MIME and DKIM, hosted monitoring, and a fresh independent review of this follow-up remain unverified. The post-social snapshot check awaits the founder’s confirmation that the stack is merged. [Delivery and SES evidence](newsletter-sending.md)
