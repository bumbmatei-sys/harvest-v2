# Social Inbox screens acceptance

Screens for the unified Inbox on top of the merged Inbox server ([acceptance record](social-inbox.md)). Route: `/workspaces/[tenantId]/social/inbox` (Public mode, Social media, Inbox). Nothing is activated: the integration, live network and human-reply switches stay hard-off, and all five HC-02 gates remain **UNAPPROVED**. Verification below is author-executed; a fresh non-author review is still due.

## What was built

- Three panes from 1280px (filters, conversation list, conversation), list plus thread from 768px, one pane at a time on phones with a back button. Owner and admin only (neutral not-found state for everyone else); 404 while the non-production gate is closed.
- Coloured platform marks on every row, filter, header and settings account (`PlatformLogo colored`, colours in `src/lib/theme-registry.ts`). Marks stay subject to each platform's brand guidelines; the platform name is in the accessible name or visible beside the mark.
- Tabs All, Unread, Assigned to me, Needs reply; folders Done and Starred; platform and account groups with counts; type filter (direct message, comment, mention, story reply); search over Harvest-authored notes only (no provider search). **Needs reply means "open in Harvest"**: the server has no platform reply state, so staff mark a conversation Done.
- Per conversation: read and unread (Harvest only; opening a conversation marks it read in Harvest), star, done or reopen, assign to an owner or admin. **There is no separate hand-off flag in the server contract**; hand-off is assignment. Auto-DM hand-off belongs to the Auto-DM screens.
- Thread messages are read live; failures show explicit loading, error, delayed, expired and unavailable states, never invented text. Comment, mention and story threads add reply actions per item.
- Reply composer: shows the server's eligibility answer and reason (closed window, permissions, account health, choose a comment). **Send is disabled while `SOCIAL_HUMAN_REPLY_ENABLED` is false** with the reason shown. The send and receipt-polling path (one UUID per intent, `unknown` never re-offers the same text) is written against the documented contract but is not exercised end to end.
- Comment hide: shown disabled with a visible "not available yet" note; the server has no hide endpoint.
- Settings (`?view=settings`): per-account timezone, weekly working windows and away message using the server's version, timezone, slots and template fields.
- Polling: the sidebar is polled every 30 seconds with its ETag while the tab is visible and online, and on focus or reconnect; an `activityRevision` change refreshes the list and open thread. A stale cursor restarts the scan.
- Server touch points (no migration): inbox routes now use the same gated dependencies as the Publish routes (`inbox-http.ts`), so the fake provider answers in non-production; the hard-off defaults apply otherwise. Synthetic fake-provider conversations live in `src/server/social/inbox-fixtures.ts` and are reachable only through the open gate.

## Kit use and provenance

Premium kit sources (admin-dashboard commit `1631106`, chat-app `66fd523`): mail app (`apps/mail` mail.tsx, mail-list.tsx, nav.tsx, mail-display.tsx) and chat (`apps/chat` chat-header.tsx, chat-bubbles.tsx, chat-footer.tsx). **No kit file was copied**; five Harvest files are **modelled on** them (0 identical lines claimed) and listed in `adminDashboardReferences` and `kitChatAppReferences`. Message rows reuse the existing kit-derived `ui/bubble.tsx`. Style comes from Studio Admin through the shared shadcn components, StatusBadge, EmptyState, FormSection and the shared shell.

## Verified (author-run)

See the PR description for the exact counts and screenshot review.

## Not verified or not built

Real provider behaviour, hosted database, reply send end to end, saved-reply picker, label management, bulk actions, contact linking and follow-up task UI, internal note editing, snooze, media attachments in replies, live provider search, hiding comments.
