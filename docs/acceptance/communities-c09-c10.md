# Communities PR 4b — C09 member layout + C10 forum (full Eden post)

Design: `docs/superpowers/specs/2026-11-11-communities-pr4b-forum-design.md`. Plan: `docs/superpowers/plans/2026-11-11-communities-pr4b-forum.md`. Migration `0038_community_forum`.

## Founder decisions (11 Nov)

- **Full Eden post now** ("do full now so there's no need to come back to it"): title, rich text, cover image, video link, attachments, and switches to turn off replies and likes.
- **Video:** links from the two largest video platforms play embedded; any other https link is shown as a link. UI copy stays provider-neutral.
- **Rich text:** Tiptap 3 (MIT), restricted to headings 2–3, bold, italic, strikethrough, lists, quotes and links.
- **UI:** Eden design, Studio Admin style.

## Delivered

- **Shared libraries (pure, unit-tested):**
  - `src/lib/rich-text.ts`: `sanitizeRichText` with an allow-list of nodes, marks and link schemes (http, https, mailto); limits on depth, characters, bytes and nodes; plus `plainText`.
  - `src/lib/video-embed.ts`: privacy-enhanced embed URLs for recognised links, a link card for other https links, and null for anything else.
  - `src/lib/forum.ts`: input schemas, limits, cover and attachment MIME rules, and the storage key.
- **Migration 0038:**
  - Five tables: categories, posts, comments, likes and member files. Each has FORCE RLS, a staff tenant policy, and a member read policy through the shared `community_can_read` predicate (an active membership plus a staff role or a valid grant from the same ministry). Member files are readable only when `ready` or uploaded by the caller.
  - A "General" category for existing communities, written under a policy that exists only inside the migration.
  - Audited SECURITY DEFINER writes that return outcomes rather than raising:
    - posts: save and delete;
    - replies: save and delete;
    - likes: toggle;
    - moderation: pin, unpin, remove a post, remove a reply;
    - files: create, and set status (forward transitions only, uploader only);
    - a members directory with names and roles only.
  - The definers check the posting role, hosts-only categories, the replies-off and likes-off switches, own-content edits, and attachment rules: the caller's own files, `ready`, the right kind, not attached to another post, at most 5.
- **Services and routes:**
  - Forum list (New: pinned first, then newest; Best this week: likes in the last 7 days), post view, writes, moderation and members.
  - Uploads: presign, then confirm with inspect and scan, then a download that redirects to a short-lived signed URL. The body is re-sanitised on read.
  - Category management for owners, with a limit of 30. A category can't be deleted while it has posts or when it is the last one.
  - Every route returns 404 when the flag is off (unit test). Non-readers get 404.
- **UI:**
  - **`CommunityShell`:** an icon rail on desktop and a bottom bar on phones (44px). Forum, Members and About are live; Chat, Events, Products and Messages show "Coming soon".
  - **Forum:** a category column (chips on phones) with a hosts-only lock, New and Best this week, and post cards with cover, video mark, excerpt, replies and likes.
  - **New/edit post window:** title, category (hosts-only categories are hidden for members), cover, video link, attachments, the shared rich-text editor, and the replies-off and likes-off switches.
  - **Post page:** cover, sandboxed embedded player, rendered rich text (a React renderer, never HTML), attachments, likes, one level of replies, author edit and delete, and host pin, unpin and remove.
  - **Members and About pages.** `/communities/:slug/home` now redirects to `/forum`.
  - **Editor:** the Channels step is live, with a Forum categories card (add, rename, emoji, hosts only, move up/down, delete); chat channels are "Coming soon".
  - **Shared components:** `RichTextEditor` and `RichTextView` live in `src/components/rich-text/` for reuse by courses, campaigns and events.

## Evidence (local, author-executed)

- **Static checks:** lint and source guards, typecheck, and 405 unit tests (rich text, video embed, editor steps, flag-off 404s for every new route).
- **Integration:**
  - `community-forum-db` covers the read rules (pending, banned, left and other-community members read nothing; ministry staff read), hosts-only categories, the switches, own-content edits, moderation by role, attachment rules and like idempotence.
  - `community-forum` covers sort, removed content hidden from members, uploads with fake storage and scanner (clean releases; skipped releases only outside production; quarantined files can't attach), and category CRUD with permissions.
  - `community-joining-definer-owner` runs the forum definers with a non-BYPASSRLS owner.
- **Browser (`community-forum`):**
  - the owner adds a hosts-only category with an emoji and reorders it;
  - two members join;
  - one writes a post with a heading, a list, a cover, an embedded video and a PDF, and the hosts-only category is not offered;
  - the other likes it and replies;
  - the author edits it;
  - the host pins it and removes the reply;
  - pinned-first list, Best this week, an empty category;
  - the API refuses a member post into the hosts-only category;
  - Members and About; the phone bar's 44px target;
  - a non-member is sent to the public page;
  - axe and no horizontal scroll at 390/768/1440 in light and dark; screenshots in `docs/screenshots/communities-pr4b/`.
- **Regression:** `community-joining`, `community-applications`, `community-editor` (Channels is now live) and `layout`.

## Activation gates (added by this PR)

- **Malware scanner for member uploads:** in production, covers and attachments stay quarantined until a real scanner returns `clean`. Today's scanner returns `skipped`, which is released only outside production.
- **Rate limits on member writes:** posts, replies, likes and uploads, as for the PR 3 public routes.
- Still open from earlier PRs: scheduling the daily applications purge, the email-hash pepper, and the five HC-02 decisions.

## Deferred

- Chat channels (C11), reports and the moderation queue (C12), notifications (C15).
- Mentions, scheduled posts, search, nested replies.
- A ministry staff moderation console in `withTenant`. Today, community hosts moderate from the member area.
- Image resizing and thumbnails. Covers are served as uploaded.

## Gates

No merge, deployment or activation is authorized by this PR. Production migrations 0031–0038 are not applied. Communities remain off in production.
