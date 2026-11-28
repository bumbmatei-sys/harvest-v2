# Church directory server

Working migration 0212. `GET /api/public/churches` searches published ministry profiles by name and public city or region. It returns up to 50 ministries with a continuation cursor. The projection includes public profile fields and public location summaries. `PUT /api/workspaces/{tenantId}/church-directory` lets the ministry owner opt in or out. Listings also require verification. The application has no path to set the verification timestamp.

## Founder decisions for the next slice

- Who verifies churches and locations, what evidence is required, and which profile changes require verification again?
- Who appoints and removes each receiving liaison, and which role is eligible for designation? The PRD limits access to designated liaisons.
- Which contact fields may a person disclose, how long may a referral stay readable, and which ministry is the controller at each stage?
- Which verified guest flow can authorize disclosure and later revoke it?

HC-18 waits for those decisions. There is no referral intake or disclosure path in this slice. The directory fixtures use synthetic profiles and a database-seeded verification timestamp.
