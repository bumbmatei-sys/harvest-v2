# Newsletter campaigns screens (PR 1)

Campaigns list, a block-based email editor with a ministry brand kit, eight starter templates and an inbox check, on the merged newsletter server (#165, NL-01, NL-02). Sending stays hard-off: the Send and Schedule button is disabled, nothing reaches a provider, test sends go to the synthetic sink only. All five HC-02 gates remain UNAPPROVED.

## Done

- `/workspaces/[tenantId]/newsletter/campaigns` (list: status, search, sort, New campaign, template row, DataTable) and `/newsletter/campaigns/[campaignId]` (editor). Sidebar entry through the typed registry (`newsletterCampaigns`, icon MailPlus, feature `newsletter`, permission `newsletter:campaigns`, live only outside production like the server routes).
- Editor on the shared `EditorShell` (steps Write | Send, preview column, undo and redo, autosave with version check). Write: name, subject, preview text, block canvas (searchable add menu, drag with pointer, touch and keyboard sensors plus Move up and Move down, duplicate, remove, per-block settings), Design (brand kit sheet), Templates (confirm before replacing), live preview (sandboxed frame, desktop and mobile), Send me a test (synthetic sink). Send: lists and saved groups with a live recipient count, Now or Pick a time, From and Reply to, subject and recipient summary, inbox check, disabled Schedule or Send with a short notice.
- Blocks: header, hero, text (Tiptap, shared `RichTextEditor`), image with text, two columns, quote or scripture, event card, giving button, video thumbnail, social links, divider, spacer, sign-off.
- Email renderer (`src/lib/email/render.ts`): tables, inline styles, 600px, mobile and dark-mode media rules, VML plus anchor buttons, https-only links and images, escaped user text, merge fields with fallbacks, plain-text alternative, unsubscribe and mailing address footer always appended (not a block, cannot be removed). Literal colours live in `email-theme-registry.ts` (the source guard allows them only there).
- Eight templates (Weekly update, Event invite, Prayer and praise, Sermon recap, Fundraising appeal, Welcome, Seasonal greeting, Digest) built from the blocks and the brand tokens; the picker thumbnails are the real templates rendered with the ministry kit. No static images; heroes fall back to a solid brand panel.
- Brand kit per ministry: logo link, three colours, six email-safe fonts, button style and corners, mailing address. Edits apply to the open email at once; Save keeps them as the ministry default (`newsletter_brand_kits`, migration 0083).
- Campaign bodies: a version 2 email document (`{ version: 2, brand, blocks }`) is accepted beside the original block list by `newsletterContent`; `renderNewsletter` dispatches. The brand kit is copied into each document, so revisions stay immutable.

## Server glue (small)

- Migration `0083_newsletter_brand_kits` (next free number: main ended at 0081, #208 holds 0082; journal `idx` 83): one table, FORCE RLS, owner and admin only through `newsletter_capability`, no worker access, no personal data. Journal `when` increases, snapshot `prevId` is the 0081 snapshot, a second `drizzle-kit generate` reports no changes. If #208 merges first, regenerate only the snapshot `prevId` chain.
- `GET/PUT /newsletter/brand-kit` (versioned), `POST /newsletter/campaigns/[id]/test-sink` (renders like a real send, submits to the fake provider; needs no verified sender), drafts may be saved without a list (review still requires one), journal and registry fixes (below).
- Navigation: CRM `campaigns` now matches `under("/campaigns")` instead of `has("/campaigns")`; the substring match claimed `/newsletter/campaigns` for the CRM entry. Hard-coded counts re-checked: `campaigns.spec.ts` (14 flag-on, 13 flag-off) is unchanged because the new entry is Public-mode only and has no legacy group; `navigation.test.ts` moved `newsletterCampaigns` from the planned list to the live list and its route sample.

## Deferred, hard-off, not in this PR

- Real sending, scheduling, webhooks, provider calls: hard-off. The Send step never fakes a send.
- Image upload (images are https links; the existing file path needs a public-file picker, not trivial). Merge-field insert buttons exist on plain fields; in the rich text block type the token by hand.
- The shared CRM people filter popover inside the Send step: recipients are chosen from NL-01 lists and saved groups; creating groups belongs to the Audience PR. Legacy (pre-v2) campaign bodies open as a blank email.
- Audience lens, sender settings and domain verification, Analytics, sign-up forms, sequences, website builder reuse: later PRs.

## Server gaps

Drafts needed a list (relaxed here). Test send required verified identities (sink route added). Sender verification UI and a list or saved-group creation UI do not exist yet, so the From picker is empty until a mailbox is verified through the API.

## Reuse and provenance

Reuses EditorShell, DataTable, StatusBadge, EmptyState, FormSection, the CRM forms history helpers and the dnd-kit pattern of the forms builder, `RichTextEditor`, shadcn Command, Popover, Sheet, Dialog. No kit code was copied, so `ui-provenance.ts` is unchanged; design is taken from the Eden newsletter screens (flow and layout only), style from Studio Admin through the shared components. No new dependency (Tiptap and dnd-kit were already approved and installed).

## Evidence

Unit: `tests/unit/email-blocks.test.ts` (every block, escaping, https only, footer always, Outlook markup, plain text, templates render and pass the inbox check). Integration: `tests/integration/newsletter-campaign-screens.test.ts` (RLS, tenant isolation, versioning, drafts, sink) plus the existing newsletter integration files. E2E: `tests/e2e/newsletter-campaigns.spec.ts` with axe at 360, 768 and 1280 in light and dark; screenshots in `docs/screenshots/newsletter-campaigns/`.
