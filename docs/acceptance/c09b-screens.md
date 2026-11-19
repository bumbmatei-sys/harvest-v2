# C09b member profile screens: acceptance (draft)

Scope: the member profile page inside a community, built only on what the merged server exposes. No migration, no new definer, no env switch.
Status: author-executed evidence; no independent review yet.

## Built
- `/communities/:slug/members/:userId`: avatar (initials), name, role badge, joined day, post and reply counts, latest activity (own posts and replies the viewer can already read, 20 per page, Newer/Older). Held posts and replies show only on the author's own page; removed content never.
- Directory names link to the profile (44px target). The chat member sheet links to the full profile; its header is now the shared `MemberSummary`.
- Message action: the existing C11c compose dialog, shown to every other member when chat is on; no people search or preflight.
- Own page: Settings tab with account name and language (link to the account page), the existing notification settings sheet, and the member-message switch (existing `dmAccept`, shown only where private messages are on and the community allows member messages).
- Neutral 404 for an unknown person, a non-member or a former member (same answer, no detail).

## Not built (no server support; a migration would be needed)
Community display name, bio, volunteered language, up to three links, visibility (members / unlisted / private), the private-field hidden state and host-only access to private fields, avatar upload, directory filtering by visibility, forum author links. Events attending waits for E01/C14. The "private field hidden" screenshot is therefore the neutral not-visible page only.

## Verification
- Lint (incl. source guards), `tsc --noEmit`, unit tests (1180 passed), integration: new profile tests plus forum and DM (27 passed).
- Browser: `tests/e2e/community-member-profile.spec.ts` (1 passed, axe wcag2a/2aa/21aa/22aa and no horizontal overflow at 1280 and 360, light and dark, for directory, other member, own profile, settings and not-visible).
- Not verified: other browser specs (DM, chat, forum) after the sheet change; real devices; independent review. A late spacing-only class change on the Settings rows was not re-screenshotted.

## Founder decisions needed
Profile visibility labels and default (members), whether moderators see private fields (design recommends owner/admin only), and approval of the C09b server slice with migration.
