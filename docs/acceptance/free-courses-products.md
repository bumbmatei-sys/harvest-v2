# Standalone free courses and downloadable products

0061 adds one ministry-owned catalogue item for each course or downloadable product. Courses keep ordered lessons on their canonical item. Download products reference ready private files from the existing file service. Community shelves link to the same canonical item and confer no access on their own.

| Route | Contract |
| --- | --- |
| `GET/POST /api/workspaces/{tenantId}/catalog` | List editorial metadata or create a draft. The list accepts an `after` item ID and returns up to 50 items. |
| `GET/PUT /api/workspaces/{tenantId}/catalog/{itemId}` | Read details or replace a draft with its expected version. Ministry members and viewers receive editorial metadata. Owners and admins can read and edit lesson bodies and file references. |
| `PUT /api/workspaces/{tenantId}/catalog/{itemId}/state` | Publish, return to draft, or archive with an expected version. A published course needs a published lesson. A published download needs ready private files. |
| `PUT/DELETE /api/workspaces/{tenantId}/communities/{communityId}/catalog/{itemId}` | Add, position or remove a reference in the same ministry. |
| `GET /api/catalog/{slug}` | Resolve listed or unlisted published metadata by its exact slug. |
| `POST /api/catalog/{slug}/enrolment` | Atomically record one free enrolment and the associated shared entitlement for the signed-in learner. |
| `GET /api/catalog/{slug}/content` | Return published lessons or linked file names and IDs after checking the learner's active grant. |
| `GET /api/catalog/{slug}/files/{fileId}` | Check the active grant, linked file and current ready/private state, then issue a 60-second private download URL. |

The server keeps the routes off in production. Access checks use the verified session and tenant scope. Hidden or archived items, missed grants and cross-tenant targets receive the same unavailable response. Enrolment creates no workspace membership. The database checks composite tenant references, forces RLS and limits use of the catalogue definer. Audit metadata covers state changes, edits, links and first enrolment.

This slice covers the catalogue, authoring, free access and link contract. Community shelf readers, Discover indexing, learner progress, questions, workshops, payments and UI are outside the slice. Real object storage, hosted migrations and production are unverified. All five HC-02 gates remain **UNAPPROVED**.
