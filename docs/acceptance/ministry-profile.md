# Ministry profile and locations

Working migration `0145_ministry_profile`.

| Route | Contract |
| --- | --- |
| `GET /api/workspaces/{tenantId}/profile` | Members see the published profile's member and public fields and locations. Owners and admins also see the draft, revision and editable field settings. |
| `PUT /api/workspaces/{tenantId}/profile` | Owners and admins send `version` (zero for first save), optional `published`, `fields` and `locations`. Values in `fields` use `{value,visibility}`. A null removes the field. A supplied locations array replaces the list and retains supplied existing IDs. |
| `GET /api/public/ministries/{tenantId}/profile` | Published ministries only. Returns `{fields,locations}` with public values, image links and per-location maps links. Missing or unpublished profiles return 404. |
| `GET …/profile/images/{logo\|cover}` | Checks the matching public or signed-in profile visibility and resolves a ready image selected from the same ministry's Storage. The response redirects to a short-lived inline image grant. |

Name must be public before publication. Other fields and locations default to staff. An owner chooses to expose a contact email or phone publicly. A location list may be empty while an address has not been added. A nonempty list has exactly one primary location. Maps links encode the saved address and make no geocoding request. Image links use the configured app origin, including the worker request origin where available. The site-address helper from #328 was absent on the base branch.

Verify anonymous, member, staff and outside-ministry views, switching the primary location, escaped maps addresses, ready images and worker grants. Local tests use synthetic data and a fake storage signer. Hosted Neon and real storage providers remain unverified. HC-02 activation gates remain **UNAPPROVED**.
