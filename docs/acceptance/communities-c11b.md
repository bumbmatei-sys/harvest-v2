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
- Verified in a real browser (Chromium, light and dark, 360/768/1280): see Verification.

## UI sources

The chat UI is adopted from the founder-supplied premium Shadcn UI Kit chat app (`bumbmatei-sys/chat-app`, commit `66fd523`, approved 19 November 2026), wired to the real C11a server and Harvest's shared components. This replaces the earlier hand-built layout and the 18 November "layout reference only" exception. Files, sources and changes are in [UI provenance](../ui-sources.md). `@shadcn/react` ^0.3.1 (message scroller) was approved 18 November and `@base-ui/react` 1.7.0 (bubble) on 19 November; both are in the third-party licences. Nothing from the kit's mock store, status, calls or attachments was adopted.

CommunityShell, NotificationBell, ReportDialog, MemberList, StickySaveBar and the moderation DataTable continue to own their existing UI responsibilities.

## Verification

Run by the author on the head of this change, with Chromium on a disposable database (author-executed; a fresh reviewer session is still required):

- `tsc`, `eslint src tests` and `check-source` pass.
- Unit suite: 84 files, 1,132 tests pass (includes the chat-app provenance test, polling hook, composer size, draft payload, link extraction and role matrix).
- Integration: `community-chat` and `communities` files, 46 tests pass, including `GET /settings` (403 for members and non-managing staff, 404 for non-members, other tenants, unknown communities and chat switched off, 200 for owner and admin).
- Chromium end to end, `community-chat.spec.ts`, 3 of 3 pass: the full live-chat scenario (axe WCAG 2.2 AA, no horizontal overflow and the 44px send target at 360, 768 and 1280 px in light and dark); phone full screen with no bottom bar or header, one-line composer under 56px, back navigation, and admin create, rename, archive and delete from the chat with the channel confirmed gone from the server state; the channel info panel at 360 and 1280 px in light and dark with axe, overflow, Escape and focus returned to the channel name; and a member who sees no administration controls and is refused `GET /settings`. `community-editor.spec.ts` and `kit-pr7-communities.spec.ts` also pass.
- Screenshots: [docs/screenshots/communities-c11b](../screenshots/communities-c11b/): `chat-{360,768,1280}-{light,dark}`, `admin-360-light`, `admin-menu-360-light`, `admin-menu-1280-light`, `info-{360,1280}-{light,dark}`.

Not verified: the other community end-to-end specs (applications, forum, joining, moderation, notifications), the full integration suite, a production build, real device keyboards and safe-area insets, and any production or delivery behaviour.

### Reviewer follow-ups (18 Nov)

- S1: message links use `rel="nofollow noopener noreferrer ugc"`. Drafts persist in `sessionStorage` per community (this tab only; cleared when the tab closes; unreadable or blocked storage falls back to memory).
- S2: unread counts include thread replies, so the channel read mark now follows the newest loaded message, root or reply. Replies count as read once the channel is caught up and scrolled to its end; opening the thread is not required.
- S3: new unit tests cover the polling hook (hidden and offline stop and resume, stop on 401, 403 and 404, 304 with the advertised interval, Retry-After, backoff cap), `mergeChatMessages`, `chatDraftPayload`, link extraction, and the chat capability matrix by role. E2E covers the member and admin matrix and the mention picker. Moderator and ministry-viewer browser cases are not added: the moderator role has no assignment API in the test setup; the unit matrix covers them.
- S4: the Chat rail item appears only when chat is on; with chat off it is absent rather than shown as "Coming soon", which matches design section 13.
- S5: mention tokens the server did not validate, or whose member is gone, never render as literal `<@id>`; they are removed or shown as "Former member".

### Known bounds

Invite-only mention suggestions use the participants visible in the loaded messages. The server validates each submitted mention against current access. The additional thread-history read omits already-deleted replies outside the loaded message stream. Tombstones already received in the stream remain available, including eligible restores.

## Gates

Chat and its routes require `NODE_ENV !== "production" && communitiesEnabled()`. All five HC-02 decisions remain **UNAPPROVED**. Attachment scanning, push, presence, search and DM settings are deferred.
