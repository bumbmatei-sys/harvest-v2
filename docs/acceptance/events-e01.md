# E01 canonical Events server

Migration `0059_events_e01` adds the ministry-owned Events model, event RSVP, the protected join-link table, and the database contract for community placement. E01 provides versioned save, publish, cancel, bounded list, detail, RSVP, roster, join and calendar download endpoints. C14 will write and manage placement through the association table.

## Ownership and scope

The planned Operations Events entry can consume this canonical service when its UI is implemented. Community placements reference the same event and do not own its content or attendance. Campaign schedules and dates keep their existing ownership. If campaign screens later need to show a canonical event, the proposed link is an explicit ministry-scoped association to the Events record. It can be evaluated independently of this migration.

All four new tables force row-level security. The app role reaches data through the Events operation definer. The database rechecks ministry owner/admin for management and rosters. Members need an active, grant-aware membership in a published linked community. A join response requires a current member and an open window, defaulting to 30 minutes before the start through the end. Owners and admins have an explicit preview operation. Cancelling a never-published event keeps it private. Calendar downloads use the same read rules and include UTC times, a stable UID, version and cancellation state. Exported copies remain outside Harvest's control.

## Admission and lock order

RSVP and join take the caller's ministry-scoped community membership row locks, sorted by community ID, before locking the canonical event. The existing grant-revision trigger takes the matching membership lock on grant writes. Membership and grant writers never take an event lock. The event row serializes capacity updates, RSVP changes and join-window reads. C14 placement writers must take the event lock when adding or removing a link.

An RSVP requires the caller’s current RSVP version and saves all current sources of admission. Each source records the placement identity, the community’s publication epoch, a grant or grant-free staff access, and the membership access epoch. Unpublishing invalidates reservations through that placement. Republishing requires a fresh RSVP for seats that lost all their original sources. The database counts a Going reservation only while at least one of those sources remains valid. Leaving or a grant-free staff access transition rotates the membership epoch. Revocation and the original end of a time-limited grant invalidate that source. Another original placement can preserve the reservation. Rejoining without an original valid source requires a fresh RSVP. Capacity is checked in the same transaction as the versioned write and the audit and outbox records.

Outbox entries hold canonical event IDs and versions. The existing dispatcher leaves them for a future Events consumer. No provider work or outbound notifications are scheduled. The HTTP gate is non-production only, and all five HC-02 activation gates remain **UNAPPROVED**.

## Review and verification

Local restricted-owner integration covered tenant isolation through the viewer/member context, concurrent seat and ban races, retries, rejoin, grant changes and expiry, link access, cancellation, calendar export, and durable outbox records.

The draft is stacked on the C11c migration. Independent review of the admission and locking contract and a trusted-main Neon migration check are pending. No hosted behavior, production, calendar-provider import, community placement UI or reminder delivery was verified. Founder decisions are whether the proposed 30-minute default fits the first pilot and whether campaign screens should link to canonical events in a later slice.
