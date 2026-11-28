# Multi-church server foundation

Working migration 0213 implements a direct link between two ministries. The parent owner requests the link, the child owner explicitly accepts it, and either owner can unlink. Requests, acceptance and unlinking record the actor and time in the link row. The endpoint only returns ministry and link IDs, status and the active local outreach campaign count. The count disappears from the first request after unlinking. Links grant no access to contacts.

| Endpoint | Caller and action |
| --- | --- |
| `GET /api/workspaces/{tenantId}/church-network` | Either owner can read pending and active links. |
| `POST /api/workspaces/{tenantId}/church-network` | Parent owner requests a link using `{ "childId": "…" }`. |
| `PATCH /api/workspaces/{tenantId}/church-network/{linkId}` | Child owner accepts using `{ "accept": true }`. Acceptance permits the count of active, non-archived local outreach campaigns. |
| `GET /api/workspaces/{tenantId}/church-network/{linkId}` | Parent owner reads the single count for an active, direct link. |
| `DELETE /api/workspaces/{tenantId}/church-network/{linkId}` | Either owner unlinks or cancels a pending request. |

The F2 companion PRD also describes expiring grants for shared projects. Those are deferred. Founder decisions remain on which additional metrics may be shared, who can read them, how to scope and expire project grants, and whether the network should enforce a hierarchy.
