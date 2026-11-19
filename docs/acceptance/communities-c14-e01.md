# E01 canonical Events server

Migration `0059_events_e01` adds the ministry-owned Events model, event RSVP and waitlist, an optional reminder lead time, the protected join-link table, and the database contract for community placement. E01 provides versioned save, publish, cancel, bounded list, detail, RSVP, roster, join and calendar download endpoints. C14 will write and manage placement through the association table.

## Ownership and scope

The planned Operations Events entry can consume this canonical service when its UI is implemented. Community placements reference the same event and do not own its content or attendance. Campaign schedules and dates keep their existing ownership. If campaign screens later need to show a canonical event, the proposed link is an explicit ministry-scoped association to the Events record. It can be evaluated independently of this migration.

All four new tables force row-level security. The app role reaches data through the Events operation definer. The database rechecks ministry owner/admin for management and rosters. Members need an active, grant-aware membership in a published linked community. A join response requires a current member and an open window, defaulting to 30 minutes before the start through the end. Owners and admins have an explicit preview operation. Cancelling a never-published event keeps it private. Calendar downloads use the same read rules and include UTC times, a stable UID, version and cancellation state. Exported copies remain outside Harvest's control.

## Admission and lock order

RSVP and join take the caller's ministry-scoped community membership row locks, sorted by community ID, before locking the canonical event. The existing grant-revision trigger takes the matching membership lock on grant writes. Membership and grant writers never take an event lock. The event row serializes capacity updates, RSVP changes and join-window reads. C14 placement writers must take the event lock when adding or removing a link.

An RSVP requires the caller’s current RSVP version and saves all current sources of admission. Each source records the placement identity, the community’s publication epoch, a grant or grant-free staff access, and the membership access epoch. Unpublishing invalidates reservations through that placement. Republishing requires a fresh RSVP for seats that lost all their original sources. The database counts a Going reservation only while at least one of those sources remains valid. Leaving or a grant-free staff access transition rotates the membership epoch. Revocation and the original end of a time-limited grant invalidate that source. Another original placement can preserve the reservation. Rejoining without an original valid source requires a fresh RSVP. Capacity is checked in the same transaction as the versioned write and the audit and outbox records.

Outbox entries hold canonical event IDs and versions. The existing dispatcher leaves them for a future Events consumer. No provider work or outbound notifications are scheduled. The HTTP gate is non-production only, and all five HC-02 activation gates remain **UNAPPROVED**.

## Waitlist and reminders

A member can opt in to a waitlist for a capacity-limited event before it starts. Queue order uses the server-assigned entry time and an account ID tie-breaker. The event lock serializes admission, claims and capacity changes. A cancelled RSVP, revoked grant or loss of membership stops reserving a place. Rejoining with new admission requires a new queue entry. Before the start, available seats go first to active earlier waitlist entries. An eligible member explicitly changes their RSVP to Going to claim a seat. Walk-in availability excludes seats held for the queue. Each member sees their own claim eligibility. The manager roster can see RSVP states. Queue reservations lapse at the start. Automatic promotion and waitlist notifications are future work.

An owner/admin can set one reminder lead time from one minute to seven days. It defaults to off. The server-only candidate operation is manager scoped and returns up to 100 IDs and versions per page for due Going RSVPs. It excludes unpublished or cancelled events, started events, invalidated admissions and recipients who muted every original surviving placement. Results contain no event body, addresses or join links.

Reminders **require a separate delivery job**. A future C15 job needs an idempotent receipt per event schedule and attendee, current admission/consent/mute rechecks at dispatch, cancellation and retry handling, and monitored scheduling. This slice has no job, provider send or reminder delivery.

## Review and verification

Local restricted-owner integration covered tenant isolation through the viewer/member context, concurrent seat and ban races, retries, rejoin, grant changes and expiry, waitlist order and claims, reminder timing and mute, link access, cancellation, calendar export, and durable outbox records.

The draft is stacked on the C11c migration. Independent review of the admission and locking contract and a trusted-main Neon migration check are pending. No hosted behavior, production, calendar-provider import, community placement UI or reminder delivery was verified. Founder decisions are the 30-minute join window, explicit claim versus automatic waitlist promotion, reminder timing and consent, and a possible later link from campaign screens.
