# Newsletter activation runbook

Synthetic rehearsal and review only. Production routes, transport and worker flags are hard-off. All five HC-02 gates remain **UNAPPROVED**. Production migrations and job schedules are pending separate approval.

## Validate callbacks

1. Provision a dedicated SNS topic for the SES configuration set and require **SNS SignatureVersion 2**. The verifier accepts RSA-SHA256 version 2 and rejects other versions. Pin the exact topic ARN and regional HTTPS SNS certificate URL. Supply trusted certificate material through deployment configuration and rehearse key rollover with overlapping certificates.
2. Confirm the subscription as an operator after checking the destination and topic against the approved configuration. The notification handler accepts only signed `Notification` events. It performs no subscription confirmation or URL requests.
3. Set the SNS retry policy and verify the configured delivery attempts fit within the 24-hour signed timestamp window. Verify 503 retries on a synthetic internal failure and a single application of repeated `MessageId` values. The receipt and delivery updates are atomic. Expired receipts are removed by the bounded synthetic retention job.
4. Verify a domain with the ownership, SPF, DKIM, bounce-domain and DMARC records. Publish the suggested `v=DMARC1; p=none` at `_dmarc.<domain>` or confirm an existing stricter policy. Verify both mailboxes and exercise the reviewed delivery cutoff before obtaining any live approval. [SES evidence](../acceptance/newsletter-sending.md)

## Review unresolved delivery

Run the synthetic delivery worker against its dedicated worker-role login. Inspect `unknown`, `operatorReview`, `markedForReview` and `unresolvedByMinistry` in the worker health output. Each affected ministry includes `oldestUnknownAgeSeconds`, covering both unresolved states. After 48 hours, a bounded worker pass marks still-unknown attempts as `operator_review`. An operator investigates missing evidence using the delivery correlation and the approved incident process. There is no resubmission. Late signed evidence can still reconcile the attempt. The 90-day job deletes individual rows from both unresolved states and rolls up their separate counts.

## Inject and rotate suppression peppers

Supply `HARVEST_NEWSLETTER_SUPPRESSION_KEYS` from the server secret manager to the web and delivery worker runtimes. Use a JSON array of up to eight distinct, random 32-byte keys encoded as lowercase hex. The first key is active for writes. All supplied keys are used for lookups. The stored version is a SHA-256 fingerprint of the random key material. SQL computes HMAC inside the transaction that locks the canonical email address so consent, address changes and suppression use the same view. The application sends peppers as bound parameters in a transaction-local setting. Keep bind-parameter and error-parameter logging disabled on the application and worker database connections and in database proxies and tracing. Never persist the setting at the role, database or session level.

Distribute a new key as a read key to all instances before promoting it to the first position. Keep prior keys readable while any suppression row or unresolved callback-eligible attempt refers to those versions. Existing digests cannot be transformed without the address. An absent configured key ring or a stored suppression version absent from the ring blocks eligibility and sending. Check the web startup log and run `npm run newsletter:deliver:test -- check-suppression` for the worker. In each runtime, `newsletter_suppression_key_ring` must report `present` with the expected `keyVersionCount`. Missing or invalid configuration reports `missing` with a count of zero. The web app still starts. Enabled public newsletter writes return HTTP 503, and an enabled worker exits before connecting to its database. The standalone worker check needs only the injected key ring. It performs no database or provider calls.

Treat suppression digests as personal data. Contact erasure detaches delivery references. The retention job clears surviving attempt digests with individual delivery rows. Scoped unsubscribe rows can be deleted by fresh verified opt-in. Hard bounce and complaint records survive CRM erasure while their narrowly scoped block remains necessary. Exceptional deletion and a key retirement policy remain subject to founder and privacy approval. [Erasure procedure](connect-rights-requests.md#newsletter-suppression)

## Activation checklist

- [ ] Verify both runtimes report the expected suppression key version count. Rehearse a missing ring and check that the sign-in page still loads, enabled public signup confirmation and unsubscribe return HTTP 503, and the standalone worker check exits with status 1.
- [ ] On a disposable hosted Neon branch, confirm the migration owner can resolve and execute the pgcrypto extension member `hmac(bytea,bytea,text)` in its installed schema. Apply 0073 and exercise suppression via the web and worker database roles. Verify transaction-local cleanup and bind/error logging settings.
