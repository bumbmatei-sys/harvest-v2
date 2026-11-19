# C09b community member profile server

Migration 0062 adds voluntary community profile data. Existing eligible members default to **members** with empty voluntary fields. A peer can open an **unlisted** profile by exact link. The directory excludes unlisted and private rows before ordering and limiting. A **private** profile opens only for the profile owner or a current community owner or admin. Hidden, absent, inactive and wrong-community targets use the same 404. A ministry viewer or plain member cannot read the profile table with their tenant context.

| Operation | Contract |
| --- | --- |
| `GET /api/communities/{slug}/members/{userId}` | Membership summary and permitted display name, bio, language, links and visibility. The projection excludes account-private fields and DM eligibility. |
| `GET /api/communities/{slug}/profile` | Read the caller's fields and current version. A caller with a stored profile can still read it after leaving. |
| `PUT /api/communities/{slug}/profile` | Replace the active member's fields, visibility and up to three labelled HTTPS links using the expected version. |
| `POST /api/communities/{slug}/profile/withdraw` | Set visibility to private with an expected version. |
| `DELETE /api/communities/{slug}/profile` | Clear the caller's voluntary fields and preserve private visibility. The operation accepts the expected version and remains available after leaving. |

The profile follows the existing account-to-membership deletion cascade. Erasure from settings clears profile fields and leaves existing forum and account data under their own rules. Audit events identify the community, action and version without storing the profile text, links or a subject reference. All profile API routes are hard-off in production.

## Screen acceptance addendum

The server now supports community display name, bio, volunteered language, up to three links, visibility, restricted private access, directory filtering and self withdrawal or erasure. The profile projection is available to the profile page. The screen work in #147 was still open when this slice started. Avatar uploads, profile controls in the screen and browser verification of the new fields are outside this server slice.

Verification covers synthetic membership and grants, cross-tenant isolation, directory exclusion, owner/admin access, moderator denial, restricted migration owner, version conflicts and deletion. No hosted migration or activation was run. All five HC-02 gates remain **UNAPPROVED**.
