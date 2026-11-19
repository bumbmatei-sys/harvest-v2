# E02 canonical Events follow-ups

Migration 0064 extends the existing Events model. Ministry owners and admins can place or remove an existing event in a community within the same ministry. Use PUT or DELETE on `/api/workspaces/{tenantId}/events/{eventId}/communities/{communityId}`. An inaccessible or missing event or community returns the same 404. The canonical event lock serializes placement changes with RSVP and capacity decisions. Retries preserve placement identity and audit only actual changes. Removing the last valid placement ends member access. Relinking creates a new placement identity and cannot restore lapsed seats.

Authorized event reads include optional `location` as up to 240 characters of single-line plain text. The venue field has no effect on joining online. The manager detail and list project `joinWindowMinutes` without exposing the URL. A save with a join URL and no new window keeps the stored window. A new join link defaults to 30 minutes. Member join still requires current admission through a community placement and the stored time window.

`waitlistEnabled` defaults on for a capacity-limited event. Turning it off prevents new entries. Existing eligible queue entries keep their order and can leave or claim a seat before the event starts. Access loss invalidates a queue entry. The server preserves recorded responses and the existing explicit-claim model. This slice adds no Maybe action, reminder delivery or automatic promotion.

Stacked on 0063. All four E01 tables retain FORCE RLS and the new placement actions use the scoped Events definer. The events gate blocks the API in production. Hosted migration and browser rendering of the new fields remain unverified. All five HC-02 gates remain **UNAPPROVED**.
