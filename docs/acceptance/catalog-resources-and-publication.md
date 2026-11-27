# Course resources and catalogue publication

Working migration `0151_catalog_resources`. The existing non-production catalogue gate applies to all routes below.

| Route | Contract |
| --- | --- |
| `POST /api/workspaces/{tenantId}/catalog`, `PUT /api/workspaces/{tenantId}/catalog/{itemId}` | Accept `coverFileId` for a course or product and `attachmentFileIds` on each lesson. Omitted asset fields retain the existing selections on a saved lesson or item. An empty attachment list removes a lesson's selections. |
| `PUT /api/workspaces/{tenantId}/catalog/{itemId}/publication` | With the current `version`, change `visibility` or set or clear `coverFileId`. `draft` closes public access. Use the existing state route to publish after satisfying the publish checks. |
| `GET /api/workspaces/{tenantId}/catalog/{itemId}/cover` | Authorized editor preview of the selected private image. |
| `GET /api/catalog/{slug}/cover` | Returns image bytes if the caller can open the published item. |
| `GET /api/catalog/{slug}/resources` | Returns published-lesson file metadata and recipient-bound download links. Links expire after 60 seconds. |
| `GET /api/catalog/{slug}/lessons/{lessonId}/attachments/{fileId}?grant=…` | Checks the signed grant, active learner entitlement, item and lesson visibility, and the file's current ready state before streaming the download. |
| `GET /api/public/ministries/{tenantId}/catalog?limit=24&after=…&author=…` | Returns approved published public items and a cursor when there is another page. `author` is the optional author ID from a result. Each item has the title, summary, cover link when set, author display name and stored price label. |

The editor can choose a ready private file from the ministry's existing Storage API. To upload a new file, use that API's upload and confirmation routes. The existing size, type, content verification and scan rules apply. Only JPEG, PNG and WebP may be covers. Responses stream attachment bytes through Harvest and expose no storage object key.

A draft is available to ministry catalogue editors. An unlisted item is available on its exact link, including to anonymous visitors. A community item opens only to active members with access to a published community that links the item. An owner can still edit the item without joining its community. Public items open by exact link, and enter the ministry catalogue and Discover after the existing opt-in, approval and standing checks. The old editor's `listed` and `hidden` spellings remain accepted. New callers can read `publicationVisibility` on the editorial response. Legacy storefronts and community shelves reference the same item.

Local tests cover two ministries, direct RLS, all visibility states, course and product covers, attachment entitlement, grant expiry and recipient checks, and paged catalogue and author queries. Hosted Neon, real DNS and the real email provider remain unverified. HC-02 activation gates remain **UNAPPROVED**.
