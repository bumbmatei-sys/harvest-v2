# Newsletter Sender screen

Public > Newsletter > Sender (`/workspaces/[tenantId]/newsletter/sender`, nav id `newsletterSender`, feature `newsletter`, permission `newsletter:delivery`, last entry of the Newsletter group). Sender setup and sending-domain verification only. Sending stays hard-off; everything here runs against the synthetic provider. No real DNS lookup, provider contact, mail or secret. All five HC-02 gates remain UNAPPROVED.

## Done

- Readiness summary: "Ready to send" or what is missing (verified sending domain, verified From address, verified reply-to address, mailing address, unsubscribe link) with a link to each fix, and one line "Sending is not enabled yet." Computed by `readiness()` in `sender-setup.ts`, the same predicate family the review step enforces (`assertVerified`, `domainVerified`, `assertMailingAddress`).
- Sender addresses: From and Reply-to addresses with status (Not confirmed, Pending, Verified, Failed, Off). Add, send or re-send the confirmation code, enter the code, turn off or on. A From address is Verified only when its mailbox is confirmed and its domain's last provider check is complete and under 48 hours old; Failed means the domain was checked and did not pass.
- Sending domains: add a domain, DNS records grouped by purpose (Ownership, Message signing, Sender policy, Bounce handling, Failed-check policy) with type, host, value and copy buttons, Verify button, last-checked time, per-purpose Found / Not found after a check. Provider-neutral wording. The domain is shown Verified only when the provider answer says all five checks pass (never assumed); an incomplete or negative answer is "Not verified".
- Mailing address: one field stored on the ministry brand kit (`address`). New emails start with it. An older email whose own address is empty picks it up in the editor and autosave stores it.
- Server enforcement: `reviewCampaign` and `dispatchCampaign` (both through `reviewData`) refuse with 409 `MAILING_ADDRESS_REQUIRED` and a clear message when the email would print "Mailing address not set". Email documents need their own `brand.address`; legacy block content needs the ministry brand-kit address.
- Send step: the address check links to Sender; the From picker shows "Set up a sender" when empty.
- Permissions: owners and admins only (`newsletter:delivery`, no new capability). Members, viewers and other ministries get a 404 from every route and the no-access note on the page.

## Server

- Migration `0087_newsletter_sender`: one SECURITY DEFINER function `newsletter_verify_domain` (fixed `search_path`, REVOKE FROM PUBLIC, EXECUTE to `harvest_app`). It requires the caller's ministry (`app.tenant_id`) and an owner or admin role, is version-checked, applies the same cross-ministry ownership guard as the worker's `newsletter_domain_check`, and sets the flags the server read from the provider port. No table, grant, policy or foreign key changed, so erase and merge are untouched. FORCE RLS applies as before. The worker's scheduled recheck is unchanged.
- `src/server/newsletter-campaigns/sender-setup.ts`: `senderSetup`, `addDomain`, `verifyDomain` (provider call outside the transaction), `saveMailingAddress`, `readiness`, `assertMailingAddress`. `synthetic-mailbox.ts`: in-memory test mailbox for the synthetic provider (confirmation codes only; unavailable in production like every newsletter route).
- Routes under `/api/workspaces/[tenantId]/newsletter/`: `sender-setup` (GET), `sender-domains` (POST), `sender-domains/[domainId]/verify` (POST), `mailing-address` (PUT), `sender-identities/[identityId]/test-code` (GET); the existing sender-identities routes now use the synthetic mailbox.

## Activation boundary (SYNTHETIC-ONLY)

`newsletter_verify_domain` is web-callable, whereas 0073 made domain verification outcomes worker-only. It is acceptable only because it hard-codes `current_domain ~ '[.]example[.]test$'`, so no real domain can verify through it. It is SYNTHETIC-ONLY: before the live adapter it must be removed or moved to the worker path. A unit test fails if that clause is removed or relaxed. The route, `verifyDomain`, the `test-code` route and the in-memory test mailbox are also gated on the synthetic provider being active (`provider-mode.ts`) and must be removed before activation. See `docs/runbooks/newsletter-activation.md`.

## Follow-ups (migration 0097, 24 Nov)

- **Display name per sender.** `newsletter_identities.display_name` (nullable, 1 to 80 characters, no `<`, `>`, `"`, `@` or control characters; checked in the database and in the route). Sender addresses only; the Reply-to rows refuse it. Setting it uses the existing identity PATCH and bumps the identity version, so a review that froze the old version is invalidated like any other sender change. Shown above the address in the list and in the Send step From picker as "Name (address)". Empty clears it.
- **Real delete.** `newsletter_delete_identity` (SECURITY DEFINER, fixed `search_path`, owners and admins of the caller's ministry, version-checked) refuses any address that any revision of any campaign names as From or Reply-to (409 `IDENTITY_IN_USE`); the setup response carries `inUse` per address. DELETE on `sender-identities/[identityId]` with `{ version }`, behind a confirmation.
- **Domain removal.** `newsletter_remove_domain`: refused while the domain has sender addresses (409 `DOMAIN_HAS_SENDERS`; delete them first), otherwise removed. DELETE on `sender-domains/[domainId]` with `{ version }`, behind a confirmation. The same domain can be added again.
- **DNS re-issue.** `newsletter_reissue_domain` writes fresh synthetic records, resets all five checks and the checked time, and bumps the version, so the domain and its senders are unverified and reviews that froze the old domain version are invalidated until the next provider check. It can never mark anything verified. POST on `sender-domains/[domainId]/reissue` with `{ version }`, behind a confirmation; synthetic provider only like Verify.
- All three functions are `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO harvest_app`, re-check the caller's ministry and `newsletter:delivery` capability, and set `app.nl_send_tenant` only for their own statements (restored after). Each action writes an audit row (`newsletter.identity.delete`, `newsletter.domain.remove`, `newsletter.domain.reissue`) with the target id and version only.
- Evidence: `tests/integration/newsletter-sender.test.ts` (display name rules and roles, delete used and unused, refusal by revision, stale versions, other ministry and member 404, domain removal and re-issue effects, function privileges), `tests/e2e/newsletter-sender.spec.ts` "sender follow-ups" (confirmations, error message, axe), screenshots in `docs/screenshots/sender-followups/`.

## Deferred, server gaps and decisions

- From name on the wire (migration 0108): the delivery authorization now returns the sender's display name and the worker, and the test send, build the From header with `formatFromHeader` (`src/lib/email-address.ts`): a plain name stays plain, a name with a comma, semicolon, dot, parenthesis, colon, at sign, bracket or quote is an RFC 5322 quoted string (quote and backslash escaped), a non-ASCII name is RFC 2047 encoded words (base64, at most 75 characters each, never split inside a character), control characters and line breaks are dropped so a name cannot add a header line. No name gives the bare address. Unit `tests/unit/email-address.test.ts`; integration `newsletter-sending.test.ts`. Nothing is sent; the provider is the synthetic one.
- The synthetic provider confirms any `*.example.test` domain with all records present, without a DNS lookup. A live adapter must replace it before activation; nothing here claims live verification.
- Unsubscribe is always appended by the renderer, so that readiness line is always satisfied; it is shown for completeness.
- Sign-up forms and Analytics are separate slices; Analytics order in the sidebar is left to its own PR.

## Reuse and provenance

Reuses AppShell and the nav registry, FormSection, DataTable, StatusBadge, EmptyState, CopyButton, Dialog, DropdownMenu and shadcn form controls. No new kit code was copied, so `ui-provenance.ts`, `docs/ui-sources.md` and `scripts/ui-identical.sh` are unchanged; the shared components were already derived from the paid kit (admin-dashboard and chat-app were not needed beyond them).

## Evidence

Unit: `tests/unit/navigation.test.ts` (Sender last in Newsletter, owner/admin only, CRM Campaigns never matches). Integration (restricted migration owner): `tests/integration/newsletter-sender.test.ts` (roles, cross-ministry isolation, fake-provider pending, verified and failed states, stale version, mailbox confirmation, mailing address at review and at send, function privileges); `newsletter-sending.test.ts` fixture now saves a mailing address. E2E: `tests/e2e/newsletter-sender.spec.ts`, flag on and with `HARVEST_SHELL_MODES=disabled`, axe and no horizontal scroll at 360, 768 and 1280 in light and dark on the main screen; `settings-popup`, `campaigns` and `newsletter-campaigns` specs re-run green. Screenshots: `docs/screenshots/newsletter-sender/` (the app shell scrolls inside the page, so `ready-full-desktop-*` use a tall viewport).
