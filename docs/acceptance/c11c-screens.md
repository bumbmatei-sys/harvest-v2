# Communities C11c private message screens

Screens for the merged private message server (migration 0058, PR #132). No migration, no server change. The feature stays non-production only: the new `/communities/:slug/messages` page returns 404 before any session work unless `NODE_ENV !== "production"` and Communities is on; the API routes already do. No environment switch was added.

## What was built

- **Messages area inside the chat:** a Channels | Messages switch in the list header (also in the tablet channel sheet), a live Messages entry in the community rail, a conversation list (search, unread badge, muted marker, per-row Mute and Hide), and the conversation beside it (one pane at a time on phones, no bottom bar, no header, 44px targets).
- **Conversation:** the shared message list, read mark, live notice and composer from the channel chat, extended rather than copied (`message-list.tsx` moved out of the channel pane; `ChatComposer` gained `mentionable` and `label`; `ChatHeader` gained `person` and `backLabel`). Edit, delete and restore for the author; report on the other person's messages; header actions Mute, View profile, Hide, Block and Unblock.
- **New message dialog:** recipient search through the existing server search, one person, a first message, Send. Owners and admins always see the button; others only while the community setting is on.
- **Read-only banner** when the server reports the conversation cannot be replied to (community setting off, own mute), a **blocked banner** with Unblock for the person who blocked, and an inline **not available** state for a refused send or a conversation that cannot be opened.
- **Message action on a member profile** (from the channel chat): a neutral compose dialog that sends the first message and opens the conversation. It follows the C09b reconciliation in #141: no lookup before sending, no `dmPeople` call, one answer for every refusal.
- `ReportDialog` gained a private message mode (same dialog, posts with the conversation, says who sees what, offers "Block this person" afterwards).

## Privacy rules and how the screens hold them

- Every refusal that depends on the other person (not a member, opted out, blocked either way, setting off, unanswered cap) maps to one value, shown as one sentence: "This isn’t available right now." Only the sender's own rate limit, sign-in and connection problems differ. Unit-tested (`dmFailure`).
- The new message button and the Message action never vary by the other person. Browser test: after a block, the blocked person's conversation list text and composer are identical to before, a send returns the neutral sentence, the draft stays, and nothing on the page mentions blocking.
- The people search is called from exactly one component (unit-tested by source scan); the profile compose dialog and layout never call it. The screens never read `acceptMembers`.
- Hosts get no new read path: the list and conversation read only the signed-in person's own conversations through the existing participant routes. Moderation review of reported private messages is not part of this PR.

## Verified

- `npm run lint` and `npx tsc --noEmit` clean.
- Unit: 90 files, 1,178 tests pass (8 new in `tests/unit/dm-view.test.ts`: neutral failure mapping, merge and sort helpers, people-search isolation, production 404 of the new page; the provenance test covers the new headers).
- Integration (local PostgreSQL 16, server unchanged): `community-dm` and `community-chat`, 47 tests pass.
- Browser (`tests/e2e/community-dm.spec.ts`, one flow, passes): member to member start and reply, unread badge, setting off gives read-only banner and no New message button, admin starts while the setting is off and the member replies, mute, profile Message action, report then block, blocked-person parity and neutral refusal, unblock, 360px full screen with no bottom bar and 44px targets, focus returns to the list heading. Axe (WCAG 2.2 AA) and no horizontal scroll in light and dark at 1280 and 360 for the list, conversation, new message dialog, admin start and read-only banner.
- The existing `community-chat` browser spec (3 tests) still passes with the shared components changed.
- Screenshots (light and dark, 1280 and 360 at device scale 2) were written to `/tmp/c11c-screens-shots` by the spec (`HARVEST_SHOTS_DIR`); they are not committed.

## Not verified or not built

- Real devices, screen readers and a real network: not done. Chromium only.
- The people search lists only people the server says can be messaged (design §6.1). A member can therefore infer that a person who is absent from the list may have opted out. The screens add nothing to that; closing it needs a server change and a founder decision.
- Drafts survive switching conversations but not a reload (channel drafts use session storage). Rail badge: the Messages unread count shows on the list tab, not on the rail icon.
- Not built: host review of reported private messages (evidence view and decision UI), the member's "Allow messages from members" setting and the one-time notice (C09b My settings), group messages, attachments, push or email. Production migrations and all HC-02 and legal gates are untouched and unapproved.
- Kit provenance: two files are adapted copies of kit files (about 27% and 24% of lines still identical, recorded in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`); four more are modelled on the kit with no copied code.
