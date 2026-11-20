# Newsletter server acceptance

PR #165 adds campaign drafts, immutable revisions, templates, mailbox and domain verification, fake delivery, aggregate analytics and worker-only retention. Campaign revisions store the authored subject, preheader and content and an unpersonalized preview. Per-recipient rendered messages, plaintext confirmation codes and raw callback bodies are transient. All five HC-02 gates remain **UNAPPROVED**. Production routes, provider transport and production workers are hard-off. No schedules are installed and production migrations are unapplied.

## Merge condition

**Merging #165 first is NOT safe.** Merge the social stack #157, #159, #161 and #162 (migrations 0069–0072) into main before #165. Migration 0073 currently follows the 0068 snapshot on the PR branch. Applying 0073 first can cause Drizzle to skip the earlier migrations when they arrive. Its journal timestamp is `1795400000021`.

After the founder confirms the stack is merged, merge main into `codex/newsletter-sending-server` and regenerate 0073 from the full merged schema. Set `prevId` to the 0072 snapshot ID, verify the snapshot includes the social tables and set the 0073 journal `when` strictly above 0072. Confirm that a second `drizzle-kit generate` reports no changes. Preserve the merged migration numbers.

## CRM merge chain

Migration 0073 calls `merge_contacts_before_newsletter_sending` from the public `merge_contacts` entry point to reconcile pending and attempted deliveries. That function is the NL-02 wrapper from 0060. It transfers restrictive subscription state and calls `merge_contacts_before_nl02`, the core CRM merge implementation. The core moves canonical consent and erases the source. Integration coverage checks all three effects in one reviewed merge.

## Verification

Lint and typecheck passed. The full unit project passed 1,234 tests in 97 files. Local Drizzle generation against the current 0068-based branch reported no schema changes. The focused newsletter and restricted migration-owner suites passed 18 tests in 3 files.

Hosted Neon, real DNS and mailbox ownership messages, real SES intake and event delivery, production quotas, received MIME and DKIM, hosted monitoring, and a fresh independent review of this follow-up remain unverified. The post-social snapshot check awaits the founder’s confirmation that the stack is merged. [Delivery and SES evidence](newsletter-sending.md)
