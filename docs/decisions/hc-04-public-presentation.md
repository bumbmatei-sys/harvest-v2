# HC-04 public presentation contract

## Current-state reconciliation — 2026-11-07

The HC-01/HC-04 baseline and evidence below are historical, not a current implementation checklist. CRM-01–08 foundation, CW-01 campaigns and HC-02 are now merged (PRs #25, #22 and #28 include migrations 0025–0026). HC-03 is open as draft PR #29 with migration 0027: QR lifecycle administration and a published-only database resolver. It is not merged or deployed. See [HC-02 acceptance](../acceptance/hc-02.md), [HC-03 acceptance](../acceptance/hc-03.md) and [closeout review](../reviews/hc-03-closeout.md). Follow the live GitHub head/checks, not historical migration reservations or statements that CRM-05 is unmerged.

HC-05 intake, HC-06/07 verified claims/CRM association and later Communities/follow-up remain future work. The [five activation decisions](../decisions/hc-02-activation-gates.md) remain unapproved; technical review is not collection or launch approval. Historical review checkboxes record the scope of their original slice only.

Date: 2026-11-06. Implementation proposal for review; no production publishing or ministry/legal/security signoff.

Scope: [PRD J1 and HC-04](../prd/harvest-connect-qr-to-discipleship.md), [ADR 0011](0011-harvest-connect.md), [slice dependencies](../prd/harvest-connect-slices.md), [J1 processing inventory / QR enumeration threat](../security/harvest-connect-threat-model.md), and [acceptance evidence](../acceptance/harvest-connect.md#hc-04-public-landing-and-starter-resources).

## Routes and the temporary source

Use the PRD's `/c/[publicCode]` for the landing and `/resources/start` for independent guest resources. Individual guides live at `/resources/start/[resourceId]`. All are outside AppShell, like sign-in. Public pages use a responsive reading layout; no authenticated admin layout is introduced.

The single static preview is `/c/9f4c2a71d8e64b30a6f9c1057b2d8e43`. It is labelled **Starter preview**, not attributed to a real church, tenant, event or published production QR. There is no campaign directory, list endpoint, mutable campaign store, form, public intake endpoint or QR/short-URL publisher.

`src/lib/connect-public.ts` defines the minimal read-only projection:

| Field | Meaning |
| --- | --- |
| `version: 1` | Public presentation contract version |
| `source: starter-preview` | Temporary static source; no canonical Campaigns entity is created |
| `publication: published` | Explicitly allowlisted for public preview exposure; not approval to launch |
| `publicCode` | Fixed opaque 128-bit-format preview slug; no sequential record lookup or identity token |
| `locale: en` | Public copy locale from the existing supported locale type |
| `resourceIds` | Only the three allowlisted starter guides; no user-generated URLs or private content |

Only the exact preview code resolves. Unknown codes and resource IDs show the same safe unavailable page with a link to general resources; no supplied tenant/contact/form identifiers are used. The proxy strips caller-supplied workspace theme hints on these routes, as it already does on sign-in and workspace routes.

HC-03 can later connect its published-source resolver to this presentation boundary after HC-02 settles canonical Campaigns/Forms storage and permissions. That resolver must derive ownership from the authoritative source, enforce live publication/disable/expiry and project only approved public metadata/resources. It must not return raw campaign, tenant, responder, account or CRM rows. The static preview is not a second Campaigns system. No response form or legal-notice contract is fabricated; HC-05 remains gated.

## Resource and locale policy

The explicit preview allowlist contains original English text: `first-reading` (three short Bible reading references with introductions/reflection prompts), `common-questions`, and `keep-exploring`. No third-party text, media, fonts, embeds, links or community listings are fetched. These guides are approved for exposure by the code allowlist only; ministry/content approval and launch locales remain human review items. No legal/privacy/security approval is implied.

All visible copy and metadata use the existing `messages/en.json` / next-intl patterns. The app currently supports only `en`; unsupported browser languages fall back to English and the public header identifies English. There is no existing second-locale catalogue to extend. Additional locales need reviewed catalogues before appearing as selectable languages; no app-wide placeholder translation is introduced.

The index loads summaries and navigation; each guide loads only when opened. Links disable Next.js prefetching. All content is server-rendered and navigation works without JavaScript, media or downloaded fonts. There are no forms or progress writes. Connection and free-account choices are visibly unavailable; they neither request data nor link into account creation/claim workflows. No community discovery is simulated.

## Privacy and persistence

Views do not create contacts, response classifications, consents, subscriptions, memberships, jobs or analytics events. No person-level or aggregate analytics is implemented. There is no tracking identifier, cookie, local/session storage write or third-party tracker in this slice. Existing service-worker behavior remains static-assets-only: public navigation/content responses are never cached as an offline resource library. Low-bandwidth support is online text access, not a promise of offline guides.

Network/security metadata still reaches the host as described in the J1 inventory; infrastructure logging/retention policy remains pending. This slice invents no legal notice beyond “Resources are free. No signup required.”

No tables, schema edits, grants, RLS policies or migrations are added. No migration number is allocated: main ends at `0017`; open CRM-05 #15 owns `0018`–`0020` and may extend to `0021`. Any later Connect migration must recheck branches/open PRs and start at `0022` or higher. Existing two-tenant fail-closed tests are rerun; there is no new table requiring an RLS policy.
