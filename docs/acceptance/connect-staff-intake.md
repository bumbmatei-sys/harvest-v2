# Staff-assisted Connect intake

A Connect manager can submit through
`POST /api/workspaces/:id/campaigns/:campaignId/connect/responses/assisted/:kind/:code`.
The source must belong to the specified campaign and ministry.

Use the same intake payload and receipt as the QR form. Wrap it in an
`intake` field and send `evidence` with `method` set to `in_person` or
`phone` and `wordingVersion` set to the form stamp for the immutable
notice read to the person. Send only the purposes the person explicitly
chose. The grant remains the person's choice. The ledger records the
method, wording version, staff identity, and server time.

Give the person the same receipt used for per-purpose withdrawal and
erasure. Pending expiry and retention use the existing intake path.
Erasure removes the assisted evidence along with the identifying data.
Only reserved synthetic contact details are accepted, with
`@example.invalid` addresses. The feature uses the existing production
hard-off gate.

Campaign-issued device sessions, offline queues, and paper hand-off
guidance are outside this server slice.
