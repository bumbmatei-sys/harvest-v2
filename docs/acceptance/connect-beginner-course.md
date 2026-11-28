# Connect beginner course

Connect managers can read and set the ministry's beginner course through
`GET` and `PUT /api/workspaces/:id/connect/settings`. Send
`{ "beginnerCourseId": "<uuid>" }` to select a published, free course that guests
can open. Send a null ID to clear the setting. The selection must belong to
the same ministry.

After a successful QR or short-link response, send a JSON POST to
`/api/public/connect/:kind/:code/course`. Include the response's
`receiptToken` in the body.

- `action: "offer"` returns the currently available course's slug, title, and summary.
- `action: "start"` takes the offered `slug` and returns published lessons for a guest session.
- `action: "enrol"` takes the offered `slug` and requires a signed-in session. It uses the catalogue's ordinary free enrolment grant. The normal catalogue progress API then applies.

Keep the receipt in the response flow and out of URLs. The course receives no
Connect answers, identities, receipt identifiers, or consent records. Erasing
the response ends receipt-based guest access. A freely chosen catalogue
enrolment has its own lifecycle. These APIs use the existing synthetic intake
and free catalogue gates.
