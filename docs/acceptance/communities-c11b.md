# Communities C11b — channel chat UI

C11b uses the C11a schema and adds no migration. The member page and its API remain non-production only. DMs belong to C11c. The executable purge and Recently deleted view belong to C11d. [C11 chat design](../superpowers/specs/2026-11-17-communities-c11-chat-design.md)

## Shipped surface

- CommunityShell exposes Chat in the rail and mobile navigation. The member page shows readable channels, unread and mention badges, mute choices and hosts-only posting. The desktop layout has a channel list and message pane. The tablet list and threads use Sheet. Phones show one pane at a time.
- The message viewport loads earlier history, polls for committed revisions and merges by message ID. Polling observes visibility, focus, connectivity, server intervals and Retry-After. The visible latest message updates read state after a short delay. Send retries reuse the client ID for the same request.
- Members can send plain text, mention other eligible members, open a thread, react, edit, delete, restore their own deletions and report messages. Moderation also includes pin, unpin, remove, restore and held decisions. The messages stream remains the source of tombstones.
- The editor's existing Channels step uses StickySaveBar and MemberList to manage access, invitations, posting, slow mode, order and archive. The Moderation page adds Chat sources for reports and held messages.
- The extra selection endpoint reads pins and thread history under user and channel RLS. Channel settings reads use the existing ministry permission check. All writes still go through the C11a definers.

## UI sources

The founder supplied and selected `chat-ui10` for layout and composer and `chat-ui4` for rows on 17 November 2026. [Chat UI 10](https://shadcnuikit.com/blocks/application-ui/chat-ui#chat-ui-10) · [Chat UI 4](https://shadcnuikit.com/blocks/application-ui/chat-ui#chat-ui-4)

The shared bubble is the identical free primitive in `bubble1`–`bubble7`. The message-scroller wrapper uses the audited Studio Admin MIT source and its `@shadcn/react` primitive. See [UI provenance](../ui-sources.md#communities-c11b-chat).

The kit supplies presentation. CommunityShell, NotificationBell, ReportDialog, MemberList, StickySaveBar and the moderation DataTable continue to own their existing UI responsibilities.

## Verification

Browser screenshots go in [`docs/screenshots/communities-c11b/`](../screenshots/communities-c11b/). Verification is author-executed. A separate fresh session reviews the draft head.

## Gates

Chat and its routes require `NODE_ENV !== "production" && communitiesEnabled()`. All five HC-02 decisions remain **UNAPPROVED**. Attachment scanning, push, presence, search and DM settings are deferred.
