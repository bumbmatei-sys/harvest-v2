# Communities C11b — channel chat UI

C11b uses the C11a schema and adds no migration. The member page and its API remain non-production only. DMs belong to C11c. The executable purge and Recently deleted view belong to C11d. [C11 chat design](../superpowers/specs/2026-11-17-communities-c11-chat-design.md)

## Shipped surface

- CommunityShell exposes Chat in the rail and mobile navigation. The member page shows readable channels, unread and mention badges, mute choices and hosts-only posting. The desktop layout has a channel list and message pane. The tablet list and threads use Sheet. Phones show one pane at a time.
- The message viewport loads earlier history, polls for committed revisions and merges by message ID. Polling observes visibility, focus, connectivity, server intervals and Retry-After. The visible latest message updates read state after a short delay. Send retries reuse the client ID for the same request.
- Members can send plain text, mention other eligible members, open a thread, react, edit, delete, restore their own deletions and report messages. Moderation also includes pin, unpin, remove, restore and held decisions. The messages stream remains the source of tombstones.
- The editor's existing Channels step uses StickySaveBar and MemberList to manage access, invitations, posting, slow mode, order and archive. The Moderation page adds Chat sources for reports and held messages.
- The extra selection endpoint reads pins and thread history under user and channel RLS. Channel settings reads use the existing ministry permission check. All writes still go through the C11a definers.

## Founder feedback round (18 Nov): composer, phone full screen, channel administration

- Composer: starts as one 44px line, grows to four lines (100px), then scrolls. Send and mention targets are 44px. Helper `src/lib/chat-composer-size.ts` (unit tested); the field also uses native `field-sizing` where available.
- Phone (below `md`): the chat page hides the community header and bottom bar through `CommunityShell` `chatView`, fills `100dvh` with top safe-area padding, pads the composer by the bottom safe-area inset and sets `interactiveWidget: resizes-content` so the keyboard resizes the page. The channel list is a full-screen view with a back link to the community; a channel is a separate full-screen view with a back arrow; the thread opens as a full-width sheet. Tablet and desktop keep the rail, header and two-pane layout. Phone is read as below the shell's own `md` (768px) breakpoint; the bottom bar already exists only there.
- Channel administration from the chat (owner, admin: `chat:manage_channels`): **New channel** in the channel list; a 44px options menu per channel with Edit, Move up/down, Archive and Delete. Edit and New reuse one `ChannelSheet`, now shared with the editor's Channels step. Server support: `PUT /channels/:id` (edit, archive), `DELETE /channels/:id` (removes an empty channel, archives one that has messages), `PUT /channels/reorder`. A new `GET /settings` returns full channel settings (slow mode, invite lists) for managers only (403 otherwise); the chat page and the edit action use it. Controls are not rendered for other roles.
- Channel info (founder request, 18 Nov): the channel name in the header opens a panel (right-side sheet on tablet and desktop, full screen with a back arrow on phone; Escape closes and focus returns to the name). Contents: name, emoji, description; Notifications (the existing none, mentions_only, all choices); Members (everyone-count with a link to the members page for open channels; eligible members for role channels; the invite list for invite channels, shown to managers only because the server exposes it only to hosts; 20 at a time with Show more, client-side because no members listing route exists); Pinned messages (server pins, at most 5; tap scrolls to the message when loaded, otherwise opens it as a thread); Shared links (distinct links from the loaded history, with a note that it covers loaded messages only; the server cannot list link messages); Shared media and Documents show "Photos and files are coming soon" (attachments wait for the malware scanner; no upload exists). Owners and admins get Edit channel in the panel and Edit, Archive and Delete in a header menu. Report and leave are not included.
- Not verified in this environment: browsers cannot run here and `@shadcn/react` is not installed, so the new e2e cases, axe runs and the new/updated screenshots (`admin-*` and refreshed chat captures) were not produced; CI must run them. Reviewed by reading only.

## UI sources

Composed from Harvest shared components. The kit's chat blocks (`chat-ui10`, `chat-ui4`, `bubble1`–`bubble7`) were a layout reference only; no kit code is copied, and the bubble is reimplemented as a small component. **The exception to the use-kit rule for this screen was approved by the founder on 18 November 2026; the next screens (DMs, profile, events) adopt the real kit blocks from the start.** Earlier "derived from" headers were wrong and were replaced. See [UI provenance](../ui-sources.md).

`@shadcn/react` ^0.3.1 (official, MIT, no runtime dependencies, sole consumer `ui/message-scroller.tsx`) was approved by the founder on 18 November 2026 and is listed in the third-party licences.

CommunityShell, NotificationBell, ReportDialog, MemberList, StickySaveBar and the moderation DataTable continue to own their existing UI responsibilities.

## Verification

- Lint, typecheck and production build passed.
- Unit suite passed 1,104 tests with two workers and a 20-second test timeout.
- Integration suite passed 815 tests with a 120-second test timeout. A focused restricted-owner test verifies channel selection, pins, replies, invite membership and ministry isolation.
- Chromium passed one end-to-end scenario using the existing local synthetic test server.

The browser test used two signed-in sessions on a disposable database. It covered hosts-only channel creation, send and reply polling, reactions, pinning, mute, offline draft preservation, held-message approval, edit, delete, restore and report submission. The phone test also checked focus when opening a channel with Enter and when returning to the channel list.

Six captures passed the axe WCAG checks and the page overflow check at 360, 768 and 1280 px in light and dark mode. The mobile send button measured at least 44 × 44 px. [Screenshots](../screenshots/communities-c11b/)

Verification is author-executed. A separate fresh session reviews the draft head. No production or delivery verification was performed.

### Known bounds

Invite-only mention suggestions use the participants visible in the loaded messages. The server validates each submitted mention against current access. The additional thread-history read omits already-deleted replies outside the loaded message stream. Tombstones already received in the stream remain available, including eligible restores.

## Gates

Chat and its routes require `NODE_ENV !== "production" && communitiesEnabled()`. All five HC-02 decisions remain **UNAPPROVED**. Attachment scanning, push, presence, search and DM settings are deferred.
