# Link in bio — public page and editor — design

Status: **DRAFT for founder and independent review**, 17 Nov 2026. Documentation only. No UI code, migration, registry source, collection, publication or activation. Communities completion and social remain earlier priorities. Paid commerce stays parked; all HC-02 decisions remain UNAPPROVED.

References: house style `2026-11-11-communities-pr4b-forum-design.md`; the 16 Nov scope exception in `docs/prd/professional-v1-launch-scope.md`; shared UI registry/design system; `docs/plans/communities-kit-item-list.md`; existing `EditorShell`, `StickySaveBar`, `PublicFrame`; Connect's versioned landing definition/snapshot/public-resolver pattern; canonical Communities/discovery/entitlements; newsletter NL-01 acceptance; selected mail/calendar/files provider ports.

## Scope

**In:** a ministry-owned public link page, safe header/bio/link blocks, links to existing canonical free Harvest resources, draft/preview/publish/unpublish, stable share URL, versioned snapshots and limited aggregate click analytics.

**Out:** another website builder, custom code/CSS/scripts/iframes, paid checkout/donations/storefront, an independent course/product catalog, contact scraping, automatic CRM creation, unsolicited messages, email/social inboxes and custom domains in the first slice. A newsletter signup block waits for a real reviewed public consent flow; NL-01 alone is not that flow.

## Ownership and routes

A page belongs to a ministry, including a creator's sole-person ministry. A free personal account does not inherit ministry creation rights. Creation/publication eligibility uses existing ministry permissions and the launch contract; this spec invents no payment/LLC prerequisite for a free page.

Proposed public route: **`/bio/:slug`**. Owner routes remain under `/workspaces/[tenantId]/link-in-bio/...` through the typed navigation registry and existing AppShell. `/c/` stays Connect; `/communities/` stays Communities. The final route/handle namespace is a founder decision below; do not create competing public aliases before it is settled.

Use a globally unique, normalized slug with reserved words and an old-slug redirect only while it points to the same currently published page. Renaming/unpublishing must not leave a public redirect that exposes a removed page. Rate limits apply to slug probes and public reads; hidden drafts return the same 404 as missing pages. No draft title/profile enters public metadata or prefetch.

## Public layout and shared sources

Header (initials/approved image, display title, short bio), then ordered labelled links/resource cards. Full width on phone; an intentional readable public-page column is distinct from owner AppShell/editor width. The owner editor retains the existing full-width EditorShell/preview composition and StickySaveBar.

| Area | Source candidate / preview | Harvest reuse / fallback |
| --- | --- | --- |
| Header and public profile composition | [Profile V2 template](https://shadcnuikit.com/dashboard/pages/user-profile), a template page, not a registry item | pinned MIT Studio Admin profile header patterns; `PublicFrame`, `Avatar`, semantic tokens |
| Link/resource rows | chosen profile/header pattern plus installed shadcn `Item`, `Button`, `Badge` | existing public resource/link presentation; accessible whole-row target |
| Owner fields / ordering | [`form-layout1`](https://shadcnuikit.com/blocks/dashboard-ui/form-layouts#form-layout-1) | `EditorShell`, `Field`, inputs, Move up/down, `StickySaveBar`, `ConfirmDialog` |
| Media choice | existing file list/upload composition | `FileList`, `UploadControl`, ready-file authorization/scanner |
| Analytics summary | catalogued [`stat-card1`](https://shadcnuikit.com/blocks/dashboard-ui/stat-cards#stat-card-1) candidate, exact anchor verified before adoption | existing status/list components; bounded daily counts |

**Source-fit gate:** no complete link-in-bio registry item has been verified. The implementation PR must audit the template/source fit and name exact items, previews, licence and shared components. Do not invent `link-in-bio1` or hand-build a missing screen. If neither source covers it, return to the founder. The licence is settled (founder, 17 Nov): premium kit blocks may be used, with provenance recorded. No premium code/assets are included here.

All copy is catalogued, concise and supplier-neutral. Use Studio Admin tokens, 44px links/controls, keyboard focus, reduced motion, semantic headings and useful empty/error states. Public bios are plain text, not HTML.

## Data and publication

Propose `bio_pages` (tenant/id/slug/title/status/current draft revision/published snapshot id/version), `bio_page_revisions` (immutable typed definition/schema version/actor/time), and a small slug-history table if canonical redirect infrastructure cannot be reused. Names are proposals; no migration number reserved.

Every tenant table has composite ownership FKs and FORCE RLS. Owner/admin author/publish by default; member/viewer get no drafts or analytics. Saves require the current version and one bounded definition: at most 20 blocks, field/block ids, validated lengths and allow-listed block types. Audit ids, versions and actions only; no bio text or secret preview tokens.

Reuse the **pattern** of the existing landing definition, immutable snapshot and sanitized public resolver; do not reuse Connect response links, intake tables, consent notices, campaigns or collection side effects. Shared low-level validators may be extracted only with both real consumers and unchanged privacy boundaries.

Publishing validates an immutable revision, rights to every asset/resource and its current public eligibility, then atomically points the page to that snapshot. A failed validation changes neither pointer nor status. Owner preview is authenticated/read-only and explicitly a preview; no impersonation. A public URL resolves the published pointer through an explicit field allow-list, not a direct anonymous table read.

Start with private/no-store draft responses and uncached public resolution until unpublish/asset/resource revocation and cache invalidation are proved together. Later public CDN caching needs bounded freshness and reliable invalidation for page and linked-resource changes; never retain a withdrawn private snapshot indefinitely. Unpublish immediately stops public resolution and old-slug redirects, while keeping owner revisions.

## Blocks and canonical resources

- **Header/text:** title ≤100, bio ≤500, plain text only. Optional image must be owned/authorized and ready under the existing scanner/media policy; initial letters work without an upload. No remote avatar fetch on render.
- **External link:** label ≤80 and bounded HTTPS URL. Reject credentials in URLs, control characters and unsafe schemes. No arbitrary iframe/HTML. Render with `nofollow noopener noreferrer ugc`; show enough destination context for a meaningful click. No server-side preview fetch, URL proxy or arbitrary redirect endpoint.
- **Community/resource card:** stores canonical resource type/id, not copied private descriptions, price or access grants. Use the owning service's sanitized public projection. A draft/hidden/removed/ineligible resource is omitted or shown unavailable without leaking its name. A link never grants membership or an entitlement.
- **Courses/products:** enable only after their standalone canonical free modules exist. No fake cards or parallel catalog. All offers are free; paid commerce stays parked until the founder's separate decision.
- **Social links:** owner-authored verified destinations or an explicit safe public projection; OAuth linkage/credentials/DM permissions are not public profile fields. Any connected-account lookup goes through the existing provider layer.
- **Newsletter signup:** deferred until a reviewed public purpose/notice, canonical contact/consent association, abuse controls and opt-in verification exist. A signup is never inferred from a page view, link click, community join or social follow. No ad-hoc email column/form in the bio module.

Resource availability is re-evaluated on public read as well as publish, so a later community unpublish cannot leave cached private details in a bio snapshot. Keep only snapshot-owned safe presentation; do not let preview metadata become an alternate read path to a hidden resource. Missing resources never turn into a purchase CTA.

## Analytics and privacy

Propose daily page/block aggregate counters, owner/admin-only, keyed to a published page/revision/block. An event must name a real block in a valid published snapshot; bound payload/rates and deduplicate only with a reviewed anonymous technique. Label figures as approximate clicks/views, not unique people or verified conversions. Bots, failed beacons and copied links limit accuracy.

Do not retain raw IPs, full user agents, participant/user ids, emails, query strings or identifying referrers; no cross-site cookie, faith-interest inference, CRM contact creation or per-person timeline. Suppress small cells according to a separately reviewed policy (proposed threshold five is an engineering default, not approval). Default tracking remains off until the notice/legal/retention decisions are reviewed. Links work when scripts, storage, consent or telemetry fail; no navigation-blocking analytics call.

No data goes to social/email/calendar/files directly from a page view. Connected integrations use the selected Zernio provider layer in their own domain and require an explicit permitted action. Office remains separate. This module does not send webhooks/messages or widen any HC-02 purpose.

## Editing flow and failure states

Create draft → set public title/slug → choose safe blocks → reorder with keyboard/buttons → preview as visitor → publish checklist → explicit publish. Save conflicts preserve local input and offer reload/compare rather than overwriting a newer revision. Unpublish requires a clear confirmation. Version/slug conflicts, unavailable assets/resources and access loss are surfaced with concise actionable copy.

Owner preview uses the same renderer and sanitized resource projections as public display; draft-only mode must not render restricted canonical content as if publicly accessible. Initial public screenshot fixtures are synthetic; no imported member/contact data.

## Testing

Unit: slug/URL/text/definition limits, unknown blocks, safe resource projections, revision migration and approximate-counter arithmetic. Integration: two ministries; direct RLS/restricted owner; stale saves; slug collision/rename; atomic publish/unpublish; unauthorized assets; linked resource becomes hidden/deleted; no membership/CRM/consent effects; preview token scope if introduced; forged click ids/rate limits; no sensitive telemetry; scanner/flag refusal before real collection. No actual provider calls.

Browser: owner draft/edit/preview/publish/unpublish; visitor sees only published safe content; stale conflict recovery; keyboard reorder/links; tracking disabled/blocked; resource revocation; light/dark editor and public renderer at 360/768/1280, axe/overflow, 44px targets and screenshots. Fresh non-author review per PR; no public publication during author testing.

## Delivery and decisions

| Slice | Delivers | Exit |
| --- | --- | --- |
| B01 server/model | typed definition, versioned snapshots, ownership/public projection | RLS/isolation/publish/revocation tests |
| B02 adopted UI | shared editor/public renderer, safe blocks, source provenance | visitor/owner browser evidence and responsive screenshots |
| B03 analytics | reviewed minimal aggregate collection/report | no PII, abuse/retention/suppression tests; tracking still gated |
| later | canonical course/product cards, consent-backed newsletter block, custom domains | owning services and separate gates exist |

Founder/review decisions: public URL/slug namespace; exact source fit (licence settled, 17 Nov); initial block set; whether minimal tracking is wanted and its notice/retention/suppression policy. The draft recommends `/bio/:slug`, safe links plus existing free resources, and no tracking until review. This document approves no policy, production activation or HC-02 decision. One branch/draft PR per implementation slice, migrations verified from trusted main, no force push/merge/deploy.
