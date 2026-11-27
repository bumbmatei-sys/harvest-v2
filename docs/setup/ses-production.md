# Amazon SES production setup (community and newsletter email)

Drafted 27 Nov 2026. **Preparation only. No real sending until the founder says go.** Sign-in email stays on its current sender (`docs/setup/email.md`). Founder decision: [27 Nov, G4](../decisions/founder-decisions-2026-11.md#founder-decisions-27-nov-launch-gates). Bounce and complaint handling is required before any real community or newsletter email.

This guide holds no secrets. Keys, ARNs with account numbers, certificates and peppers go in the deployment secret store, never in the repository, logs, PR text or screenshots.

**[Founder AWS]** marks a step that needs the founder's AWS account (owner sign-in or a role he grants). Everything else is engineering work in the repository or on staging.

Related: newsletter SES adapter `src/server/newsletter-campaigns/ses-adapter.ts`, callback route `src/app/api/newsletter/callback/route.ts` (handler `src/server/newsletter-campaigns/callback.ts`), [SES evidence](../acceptance/newsletter-sending.md#amazon-ses-evidence), [activation runbook](../runbooks/newsletter-activation.md), community sender `src/server/community-email-sender.ts`.

## 0. What the code does today

| Piece | State on main | Needed before go |
| --- | --- | --- |
| Newsletter send request | `buildSesSend` builds an SESv2 `SendEmail` request with a configuration set, a `harvest_delivery_id` tag, HTML and text bodies and RFC 8058 unsubscribe headers. Live submission is off (`LIVE_NEWSLETTER_ENABLED = false`, a code literal) | A reviewed PR that wires a real SESv2 client and flips the literal, after founder go |
| Newsletter callback verifier | `sesAdapter().verifyCallback` checks SNS signature version 2, the exact topic ARN, a pinned regional certificate URL and a 24-hour window. It accepts only `Send`, `Delivery`, `Bounce` (permanent only) and `Complaint` | Wire it into the route; today the route uses only the synthetic verifier (`FakeNewsletterProvider`) with `HARVEST_NEWSLETTER_CALLBACK_KEY` |
| Callback route | `POST /api/newsletter/callback`, off unless `HARVEST_NEWSLETTER_CALLBACK_ENABLED`; writes through the worker role (`newsletter_apply_callback`); neutral 202, 503 only for an internal failure | Live certificate loading and the SNS subscription confirmation step (§6.4) |
| Ministry sending domains | Fake verification for `*.example.test` only; `sesAdapter().domain()` returns null | Live identity registration and recheck through the worker path; remove the synthetic paths (runbook "Remove the synthetic sender-setup paths") |
| Newsletter suppression | Keyed HMAC digests for unsubscribes, hard bounces and complaints | Key ring provisioned (`HARVEST_NEWSLETTER_SUPPRESSION_KEYS`) |
| Community email sender | Uses the transactional provider SDK and is off (`COMMUNITY_EMAIL_LIVE_DELIVERY = false`) | **New SES sender for community email**, plus bounce and complaint handling and suppression for community email. Not built |

## 1. Account and region **[Founder AWS]**

1. Use a dedicated AWS account for Harvest email, or a dedicated organisation unit. Turn on MFA for the root user. Do not create root access keys.
2. Use **`us-east-1` (N. Virginia)** for SES, SNS and alarms (founder, 27 Nov: US audience first). The main database stays in the EU (Frankfurt) for now. SES quotas, identities and suppression are per region. Email addresses and message content therefore go to a US processor; see the transfer section of `docs/decisions/hc-02-policy-pack.md` (§10).
3. Create two IAM roles (no long-lived user keys if the runtime can assume roles):
   - **Sender role:** `ses:SendEmail` only, limited to the Harvest identities and the two configuration sets.
   - **Identity worker role:** `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`, `ses:DeleteEmailIdentity`, `ses:PutEmailIdentityMailFromAttributes`, for ministry domains on the worker path.
   If the runtime cannot assume a role, create one access key per role, store it only in the secret store, and rotate it every 90 days.
4. Turn on CloudTrail for the account (management events) so SES and IAM changes are logged.

## 2. Domains

There are two kinds of sending domain.

- **Harvest's own domain** for community email. Use a subdomain only for this mail, for example `community.<harvest-domain>`, so its reputation stays apart from sign-in mail. **[Founder AWS]** for the identity; **[Founder DNS]** for the records.
- **Each ministry's own domain** for newsletters (founder, 20 Nov). Harvest registers the identity through the worker path and shows the ministry the DNS records. The ministry never needs an AWS account.

### 2.1 Domain verification and DKIM

1. Create the domain identity in SES (SESv2 `CreateEmailIdentity`) with Easy DKIM, RSA 2048-bit.
2. SES returns three DKIM CNAME records. Publish all three. SES verifies the domain once they resolve.
3. For ministry domains, Harvest also asks for its own ownership TXT record (already in the sender setup flow). Keep both checks.
4. Recheck rules already in code: recheck after 24 hours, block after 48 hours without a successful check; a status change bumps the domain version and invalidates old reviews.

### 2.2 SPF with a custom MAIL FROM

1. Set a custom MAIL FROM subdomain, for example `bounce.<domain>`.
2. Publish an MX record for it: `feedback-smtp.<region>.amazonses.com`, priority 10.
3. Publish an SPF TXT record on it: `v=spf1 include:amazonses.com ~all`.
4. MAIL FROM failure behaviour: choose "use default MAIL FROM" so mail still goes out if the MX breaks. DMARC still passes through aligned DKIM. Record the choice in the activation evidence.

### 2.3 DMARC

1. Publish `_dmarc.<domain>` TXT. Start with `v=DMARC1; p=none` (the code's minimum; `p=quarantine` or `p=reject` also pass).
2. Add an aggregate report address you control (`rua=mailto:...`) before moving to `p=quarantine`. For now that is the founder's mailbox (founder, 27 Nov). Do not write the address in the repository.
3. Move Harvest's own domain to `p=quarantine` after two clean weeks of reports.

## 3. Leaving the sandbox **[Founder AWS]**

New SES accounts are in the sandbox: they can only send to verified addresses, with a low daily quota.

1. In the SES console, open the account dashboard and request production access for the chosen region.
2. Mail type: **Marketing** (newsletters) or one request covering both; describe community email as transactional notifications.
3. Website URL: the public Harvest site.
4. Use case description, in plain words:
   - recipients opt in; newsletters use double opt-in;
   - every newsletter has one-click unsubscribe (RFC 8058) and a footer link;
   - community email goes only to members who chose email in their preferences;
   - bounces and complaints come back through SNS and stop further sending to that address at once;
   - Harvest keeps its own suppression list and the SES account suppression list is on.
5. Expect an answer within about a day. If AWS asks questions, answer in the same case.
6. Do this **after** §4 to §7 are in place on staging, so the description is true.

## 4. Configuration sets

Create two configuration sets so the two kinds of mail never mix their events or reputation.

| Set (placeholder name) | Used by | Event destinations | Other settings |
| --- | --- | --- | --- |
| `harvest-newsletter` | Newsletter worker (`ConfigurationSetName` in `buildSesSend`) | SNS topic `harvest-newsletter-events`: Send, Delivery, Bounce, Complaint | Reputation metrics on; SES open and click tracking **off** (Harvest counts clicks itself, and never opens); configuration-set suppression on for bounces and complaints |
| `harvest-community` | Community email sender (to build) | SNS topic `harvest-community-events`: Send, Delivery, Bounce, Complaint | Same |

Select only those four event types. The verifier accepts only them; any other type is answered with a neutral 202 and dropped, which would look like a silent loss.

## 5. SNS topics and the callback

1. Create one standard SNS topic per configuration set. **[Founder AWS]**
2. Set the topic attribute `SignatureVersion` to `2`. The verifier rejects version 1.
3. Topic access policy: allow `ses.amazonaws.com` to publish, with conditions on `aws:SourceAccount` and the configuration set ARN.
4. Subscribe the HTTPS endpoint `https://<production-origin>/api/newsletter/callback` to the newsletter topic. Use raw message delivery **off** (the verifier expects the signed SNS envelope).
5. Delivery retry policy: make all retries fit inside the 24-hour signed-timestamp window the verifier allows (for example, a few immediate retries, then backoff up to about 20 hours in total). Record the final policy.
6. Store the exact topic ARN and the trusted SNS signing certificate for the region in the deployment configuration (the adapter accepts injected certificates only; it fetches nothing).

### 5.1 Community email callback (to build)

The route today applies newsletter events only (`newsletter_apply_callback`). Community email needs one of these, decided in its PR:
- a second route for the community topic, or
- one route that checks the topic ARN and dispatches to a community handler.

Either way: the same SNS checks, the worker role, and a community suppression record on permanent bounce or complaint.

### 5.2 Subscription confirmation (gap)

The handler deliberately does not confirm SNS subscriptions or fetch any URL. The runbook says an operator confirms the subscription, but no path shows the operator the confirmation token today. Before go, add a reviewed, hard-off, operator-only way to confirm (for example a one-time flag that logs only the topic and token to the operator console, then is switched off). Not built.

## 6. Suppression

1. **Harvest's own lists (primary).** Newsletter: keyed digests for unsubscribe, hard bounce and complaint (already built; key ring in `HARVEST_NEWSLETTER_SUPPRESSION_KEYS`, rotation in the runbook). Community email: an equivalent block on permanent bounce and complaint, to build.
2. **SES account-level suppression list.** **[Founder AWS]** Turn it on for both `BOUNCE` and `COMPLAINT` in the region. It is a safety net, not the source of truth.
3. **Configuration-set suppression.** On for both sets (§4).
4. Soft bounces do not suppress. The adapter treats only `Permanent` bounces as bounces.
5. A suppression record is personal data. Erasure rules: `docs/runbooks/connect-rights-requests.md#newsletter-suppression`.

## 7. Sending limits

1. Sandbox: SES allows only verified recipients and a small daily quota.
2. After production access, note the granted daily quota and per-second rate in the activation evidence.
3. The newsletter worker already caps a selection at 5,000 memberships; the community email worker sends at most 40 batches of 25 per run (`src/server/community-email.ts`). Keep the worker's send rate below the SES per-second rate, and treat a throttling error as `unknown` (the adapter already does), never as sent.
4. Ask for a higher quota only when real volume needs it, with bounce and complaint rates attached.
5. Keep rates well under the levels at which AWS reviews an account: bounces under 5% and complaints under 0.1% (AWS may pause sending at higher rates; check the current SES documentation).

## 8. Monitoring

1. CloudWatch alarms **[Founder AWS]**: `Reputation.BounceRate` above 2%, `Reputation.ComplaintRate` above 0.05%, daily send close to quota, and SNS `NumberOfNotificationsFailed` above zero for either topic.
2. Harvest health checks: the newsletter worker health output (`unknown` and `operatorReview` counts, oldest unresolved age), the callback's 503 rate, and the community sender's failures (to build).
3. Alerts go to the founder's mailbox for now (founder, 27 Nov). The address lives only in the alarm configuration, not in the repository.
4. Weekly for the first month: read the DMARC aggregate reports and the SES reputation page.

## 9. Secrets and configuration (names only)

| Name | Where | Notes |
| --- | --- | --- |
| SES sender role or key | Secret store, web and worker runtimes | New; name chosen in the sender PR |
| Topic ARNs and SNS certificate material | Deployment configuration | Not secret, but kept out of the repo because they include the account number |
| `HARVEST_NEWSLETTER_SUPPRESSION_KEYS` | Secret store | Existing |
| `HARVEST_NEWSLETTER_TOKEN_KEY` | Secret store | Existing |
| `HARVEST_NEWSLETTER_CALLBACK_KEY` | Synthetic only | Not used with real SNS |
| `WORKER_DATABASE_URL` | Secret store | Existing; worker role |

## 10. Go sequence (each step needs the one before)

1. §1 to §8 done on staging with synthetic recipients and the sandbox.
2. Code PRs merged after independent review: live SES client, route wiring, subscription confirmation, community SES sender, community bounce and complaint handling.
3. Production access granted (§3).
4. Founder says go, in writing, for each of newsletter and community email.
5. A separate activation PR flips `LIVE_NEWSLETTER_ENABLED` or `COMMUNITY_EMAIL_LIVE_DELIVERY`. These are code literals on purpose, not environment toggles.
6. First real send to an internal list only; check headers, DKIM, unsubscribe and a test bounce (`bounce@simulator.amazonses.com`) and complaint (`complaint@simulator.amazonses.com`).

The HC-02 gates must be approved before email reaches Connect guests (`docs/decisions/hc-02-activation-gates.md`).
