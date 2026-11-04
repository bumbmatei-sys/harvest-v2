# PR 01b follow-ups after review r3

Scope: `/workspace/grokpr/v2-2-r3-REVIEW.md`, PRD-v2.5, PRD-v2.7 §5.-04 and its founder overrides, and DESIGN.md. This supersedes the recording-order and audit-retention statements in [round 3](pr01b-round3.md).

## Consent clock and effective state (F-r3-1, F-r3-3)

Migration `0008_consent_clock_and_audit_unlinking` was generated with Drizzle after making `audit_logs.target_id` nullable. Its SQL also replaces the insert-provenance trigger and the controlled erasure function and adds the audit-redaction guard. Existing SQL and snapshots 0000–0007 are unchanged; snapshot 0008 and the journal are generated, not hand-edited.

The insert trigger always assigns `NEW.recorded_at := now()`, including direct SQL writes. An explicit 2099 recording time is ignored; a 2099 occurrence still fails the occurrence CHECK. Historical clock-skew fixtures are migration-owner inserts with the provenance trigger temporarily disabled inside a disposable test transaction.

History remains ordered by recording time, occurrence time, then ID. Effective consent is scoped to channel and purpose. A withdrawal remains effective unless a grant is strictly later in **both** recording and occurrence time. Every withdrawal must be superseded. Backdated grants, equal clock values and later unknown states do not clear an outstanding withdrawal. Comparisons happen in PostgreSQL to preserve microsecond precision. The API and preferences card consume the same effective result.

## Erasure and audit exception (F-r3-2)

The founder decision requires unlinking contact audit history as well as anonymizing the consent ledger. Erasure now nulls `target_id` and clears the entire metadata object on that contact's `contact.*` and `consent.*` events, including references through contact IDs, consent targets and metadata IDs. Removing only channel and consent IDs would leave a day-plus-status correlation, so status and other correlating metadata are removed too.

Audit event ID, tenant, actor, action and creation time remain immutable. Only the erasure function's owner can perform the exact target-null/empty-metadata transformation, in the matching tenant context, after the contact is erased. The app role receives no audit UPDATE/DELETE/TRUNCATE privileges. Live-contact edits, unrelated actions, arbitrary metadata replacement and changes to immutable event facts are rejected. No session flag bypasses the guard.

Unlinking occurs before consent IDs are regenerated, so old consent references can still be located. The new `contact.erase` event has a null target and empty metadata; transaction-ID matches to this event no longer disclose a contact ID. Repeated erasure produces no duplicate event. A migration backfill strips the former contact targets/metadata from already-erased contacts' history and removes its temporary owner-only scan policy. Unrelated contacts, workspaces and their audit history are retained unchanged.

The original consent redaction and tombstone rules remain: remove personal values and identifiers; detach contact, actor and channel; clear source/evidence; regenerate consent IDs; coarsen timestamps to UTC days; preserve anonymous status, purpose and notice version. Audit and consent changes are one transaction and roll back together on failure. The restricted-definer test covers a non-superuser without RLS bypass, including the newly required audit SELECT/UPDATE permissions for that definer only.

The two-contact regression first proves the original day/status join exists, then verifies no redacted proof joins any audit row by ID, precise timestamp or day/status in that fixture. It also checks erasure-transaction audit matches contain no target or metadata. The unaffected contact has unknown consent to make the withdrawn event unique, reproducing the reviewer’s identifying correlation without treating coincidental matches to unrelated live consent as identity evidence.

## Shell and design (F-r3-4, F-r3-5, F-r3-7, F-r3-8)

The workspace switcher displays the selected workspace's full name in a truncated span and shadcn Tooltip. A shadcn Avatar with a sprout icon distinguishes its collapsed control from the Workspaces building icon. TooltipContent exposes the optional Radix portal container, as DropdownMenuContent already does, so the visible tooltip stays inside the sidebar landmark. Menu choices use shadcn DropdownMenuItem with real links. The static Harvest logo is composed with SidebarMenu/SidebarMenuItem/SidebarMenuButton, addressing the adjacent strict-shadcn observation as well.

The named complementary sidebar landmark contains the brand header, navigation and footer. The Workspace navigation landmark is limited to SidebarContent; account, theme and collapse controls are outside it.

DESIGN.md §3/§6/§7 specify Inter for Harvest UI and Geist for Studio UI, with Fraunces/Newsreader reserved for public headings and long-form content. Georgia was an unsupported shell-only addition. Removing it lets the wordmark and app headings inherit the correct palette font. No new font asset is necessary.

All inner shadcn Cards retain their border. A dedicated `--surface-card` token separates them from `--shell-panel`; popover and sidebar surfaces retain their existing tokens. Studio light remains white on off-white. The dark destructive token is lightened to keep alert descriptions above AA on the more distinct dark cards. Contact detail and shell browser checks measure computed card/panel colors, assert at least 1.1:1 in every palette and verify a visible one-pixel border. The React checklist found stable tenant keys, top-level hooks, derived workspace labels, correctly scoped client composition and no new dependency or client data-fetching path. Browser evidence is in [the screenshot inventory](../screenshots/pr01b/README.md) and [contrast results](../screenshots/pr01b/contrast-results.json).

## Validation

| Check | Result |
| --- | --- |
| Lint | Pass, zero warnings |
| Typecheck | Pass |
| Unit | 59/59, 6 files |
| Integration / RLS | 89/89, 10 files |
| Drizzle check | Everything’s fine |
| Drizzle generate | No schema changes |
| Fresh migrate | Nine migrations applied via `scripts/migrate.ts`; second application is a no-op |
| Playwright + axe | Final combined run pending; targeted PR 01b journey passed with 60 states, zero axe violations |
| Build | Pending |

Computed card/content ratios: Harvest light **1.1210**, Harvest dark **1.1667**, Studio light **1.1117**, Studio dark **1.1212**; all cards retain a solid border at least one pixel wide. Screenshots cover expanded/collapsed shells in all palettes, the open workspace tooltip, desktop/mobile contact detail and the existing workflows.

The browser → API → database → response flow records a backdated grant with HTTP 201, returns it first in history, preserves the effective withdrawal, and renders Withdrawn in Marketing preferences. All captured screens pass axe, and the journey asserts no page exceptions. The SQL tests separately verify the anonymous ledger and scrubbed audits after erasure.

All databases and provider mocks used for validation are disposable and local. No deployment or live database migration is part of this change.

## Workspace continuation

The checkout’s `.git` mount is read-only. This branch’s writable Git metadata is `/tmp/harvest-fu1-git`; use `GIT_DIR=/tmp/harvest-fu1-git GIT_WORK_TREE=/tmp/harvest-fu1 git ...` from this checkout. The branch is based on merged main `d728696`.
