# Hosted CRM forms server acceptance

The hosted routes are available only for synthetic testing in a non-production Node process connected to a disposable local test database. All five HC-02 activation gates remain **UNAPPROVED**. [Activation decisions](../decisions/hc-02-activation-gates.md)

## What is built

- In synthetic test mode, owners and admins can publish, republish and retire a CRM form. The first publication reserves a unique lowercase slug. The address stays reserved after retirement. Later edits create a new draft and leave the published form and notice intact until a manager publishes again. Each publication and retirement writes an audit entry. CRM publication uses its own tables and leaves the Connect form states, rules and notice versions in place.
- The server returns the published form and a ten-minute submission proof at `GET /f/:slug`. `POST /f/:slug/submit` takes that proof and one set of answers, keyed by block ID. Unknown, unpublished, retired, archived and disabled forms return the same 404. Submissions require JSON and the configured same origin, with a 32 KiB streaming limit. A honeypot is always active. The builder's **Spam check** setting adds a one-second minimum time between obtaining the proof and submitting it. The temporary limits are 30 submissions per form per minute and 600 per minute across forms, including malformed submissions from the accepted origin.
- Every accepted response is tied to the exact published version and its immutable notice. The checked mandatory block records acceptance of the form-processing notice. It adds no permission to the contact ledger for newsletters, outreach, follow-up, or account communications. Older terms keep their original meaning.
- One transaction saves the response and creates or reuses the CRM person by the ministry's normalized email or international phone. If the two identifiers point to different people, the request is declined. A mapped organization can be attached to the response. New people receive the configured owner, labels, and organization link. Reuse preserves the existing person's profile and relationships. A pipeline destination creates an opportunity in its first available open stage. The server validates the owner against ministry membership and checks campaign and QR identifiers against live records from the form's ministry. Each new response also records a `form` event in the existing HC-06 `contact_source_events` history. The event links to the accepted response, which identifies the form, published version and validated campaign and QR link. The form's address supplies its reserved slug. A submitter can use the form without a session or account.
- A retry with the same proof and answers returns the same acknowledgment. A changed submission using a proof that already saved a response gets a conflict. After erasure, the short-lived random replay key prevents the same proof from recreating the deleted response.
- Owners and admins can read responses with cursor pagination and an audited read. The editor's form-detail API includes the retained response count. Migration `0076_crm_hosted_forms` adds the published state and response tables with forced row security and ministry-qualified references. Main ended at `0075`, and the open PRs checked at implementation time did not claim `0076`.

## Retention and erasure

The response row contains the answers, submitted time, processing acknowledgment, assigned owner, labels, and source links. The provisional response window is 30 days. Expired answers stop appearing in the manager API and stay in the database until a manager runs the manual purge. The authenticated endpoint deletes expired responses in batches of up to 100. CRM records already created from the form follow their own CRM deletion lifecycle.

A contact merge moves responses and source events to the contact being kept. Erasure deletes the responses and their source events and clears the erased contact's form owner and labels before the old contact ID is replaced. The audit records hold form/version references without answers or contact IDs. Short-lived quota counters and replay keys carry no names, emails, phones or form answers. [Erasure inventory](../security/harvest-connect-threat-model.md#storage-delivery-and-rights-handling)

## What is hard-off

Both public Node handlers and owner-side publication and retirement return 404 in production before looking up a form. The source guard checks the literal `false` constant and the gated entry points. The database functions for public intake and owner transitions also require a database named for local Harvest tests. The test mode uses fabricated data, including reserved `@example.test` emails and fictional North American phone numbers. Submissions create no accounts, sends, notifications, webhooks or jobs. File uploads, branching, ranking, payments and partial answer storage are outside this slice.

## Known gap

New submissions record one form source event whether they create or reuse a person. Replaying an accepted submission adds no event. Owners and admins can include or exclude the `form` kind through the shared People list, count, saved view and export predicates. Explicit form rules can also match the publication version, campaign and QR link on the same event. Entry route remains a Connect attribute. The source event stops matching at response expiry and is removed with the response on purge or erasure. Migration `0079_crm_form_provenance` adds this behavior for new submissions. Responses accepted before 0079 keep their existing response records and have no automatic source backfill. Main ended at 0078 and none of open PRs #193, #174, #169, #74, #61, #49, #47 or #38 claimed 0079 when checked.

The source history label comes from the immutable published title already stored when the version was published. Draft edits, later publications and form retirement leave earlier labels intact. `GET /api/workspaces/:tenantId/crm/sources/options` adds `hostedForms: { id: string; name: string }[]` for owners and admins. Each ID is a published version ID for the rule's `forms` array with `kinds: ["form"]`. Slugs and QR codes stay out of the option labels.

## Editor response count contract

`GET /api/workspaces/:tenantId/crm/forms/:formId` returns a private, non-cacheable JSON object with `id: string`, `definition: FormDefinition`, `createdAt: string` (ISO timestamp), `createdBy: string`, `responseCount: number` and `publication: { slug: string; state: "published" | "retired"; versionId: string | null } | null`. Owners and admins can read the count for their ministry. It is the number of responses with `expires_at > now()` across the form's published versions, including after retirement. A draft with no responses returns zero. The paginated response endpoint returns the same total as `count`, independent of cursor or page size.

## What remains unverified

The builder from PR #189 renders a fixed badge count. Wiring that badge to `responseCount` and adding named hosted publication choices to the source rule editor remain screen follow-ups. Production migrations, load testing, live collection, reviewed notice text and operational retention scheduling are outside the local verification.

## Founder decisions

- **Source retention.** Form attribution is visible for the same period as the response. Decide before activation whether the ministry needs attribution for longer than it keeps answers.

- **Retention.** Confirm the response window and ministry-wide maximum, and assign a purge schedule and operational owner before activation. Expired responses remain stored until the manual purge runs.
- **Rate limits.** Decide the production rate-limit design for normal traffic and bursts at events. Exhausting the global 600-per-minute bucket can lock out every hosted form, and exhausting the 30-per-minute bucket can lock out an individual form. GET mints proofs freely and there is no per-client limit.
- **Definer policies.** Review the migration owner's scoped database access before activation. Migration `0076` replaces the broad policies for `workspace_members`, `companies`, `crm_pipelines` and `crm_pipeline_stages` with `SELECT` policies, an `INSERT` policy for company creation, and `UPDATE` policies that allow row locking under `FOR SHARE` and reject writes through those policies.
- **Labels.** Should these labels stay as text from the form settings, or should a ministry have a managed tag table?
- **Consent wording.** What should the mandatory form-processing acknowledgment and privacy notice say for the intended audiences and jurisdictions?

## Local verification

The focused local suites passed 14 hosted-form and draft tests under PostgreSQL, including a populated upgrade using a migration owner without superuser or bypass rights. The 18 CRM import and restricted-owner merge regression tests also passed. The repeat Drizzle generation reported no schema changes. The journal timestamp increases from 0075, and the 0076 snapshot points back to the 0075 snapshot. The draft PR records the full-project results and the tested head.

See [hosted forms server defaults](crm-forms-defaults.md): the rate limits, 90-day response window and fixed consent line there replace the 30/600 per minute limits and 30-day window described above.
