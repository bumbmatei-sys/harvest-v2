# Communities PR 4b — C09 member layout + C10 forum (full Eden post) — design

Status: approved by the founder on 11 Nov 2026 ("full Eden post", "do full now"; covers and attachments included; embedded video). Plan: `docs/superpowers/plans/2026-11-11-communities-pr4b-forum.md`. Migration `0038_community_forum`.

References:
- Eden screens in `Harvest-agent` `docs/prd/screenshots/05-communities/`: forum list, new-post window, post detail, members, and setup → channels and forum categories;
- PRD §5.3, §6.1, §6.3;
- ADR 0013 §2, §4, §4a.

Design is Eden's, style is Studio Admin's.

## Scope

**In:**
- the member layout (`CommunityShell`);
- forum categories (owner setup);
- posts with title, rich text, cover image, video link (embedded), attachments, and switches to turn off comments and likes;
- pinned posts;
- likes on posts and replies;
- one level of replies;
- edit and delete of the member's own posts and replies;
- hosts pin and remove;
- Members and About pages.

**Out:**
- chat channels (C11), reports and the moderation queue (C12);
- events, products and messages (later; shown as "Coming soon");
- mentions, notifications (C15), post scheduling, search.

## Member layout

Route group `src/app/communities/[slug]/(member)/` with `layout.tsx`. It is reached only by active members who hold a valid grant; everyone else is sent to the public page.

- **Icon rail** (desktop, left): Forum, Members and About are live. Chat, Events, Products and Messages are disabled and marked "Coming soon". At the bottom: My communities and the ministry name.
- **Phones:** a bottom tab bar with the same items; 44px targets.
- **Forum:** a category column (All posts, then categories with emoji and a "Hosts only" lock), then the post list with New and Best this week tabs.
- **Pages:**
  - `/communities/:slug/home` redirects to `/forum`;
  - `/forum?category=&sort=new|best`;
  - `/posts/:postId`;
  - `/members`;
  - `/about`.

## Data (migration 0038)

All tables carry `tenant_id` and `community_id`, have FORCE RLS, and use a staff tenant policy plus a member read policy that calls one shared predicate.

**`community_categories`**
- Columns: `id`, `name` (1–60 characters), `emoji` (≤ 16 characters, optional), `position`, `hosts_only`, `created_at`.
- At most 30 per community.
- Every community gets "General" (in the migration for existing communities, and in `createCommunity`).

**`community_posts`**
- Content: `id`, `category_id`, `author_id` (users, set null on delete), `title` (1–200), `body` (jsonb; validated rich text, ≤ 100 KB), `body_text` (derived plain text, ≤ 20,000 characters), `video_url` (≤ 500 characters, validated https URL), `cover_file_id`.
- Flags: `pinned`, `comments_off`, `likes_off`.
- Timestamps: `created_at`, `updated_at`, `edited_at`.
- Removal: `removed_at` and `removed_by`.

**`community_comments`**
- Columns: `id`, `post_id`, `author_id`, `body` (plain text, 1–5,000), `created_at`, `updated_at`, `removed_at`, `removed_by`.

**`community_likes`**
- Columns: `target_type` (post or comment), `target_id`, `user_id`, `created_at`.
- Primary key: `(target_type, target_id, user_id)`.

**`community_files`** (member uploads; ministry `files` require ministry membership)
- Columns: `id`, `uploader_id`, `key` (`communities/<tenant>/<community>/files/<id>`), `name`, `mime`, `size`, `checksum`, `status` (pending, uploaded, quarantined or ready), `kind` (cover or attachment), `post_id`, `created_at`, `updated_at`.
- Allowed types: covers must be jpeg, png or webp; attachments may also be pdf or txt. At most 10 MB each, and at most 5 attachments per post.

**Read predicate.** `public.community_can_read(p_tenant uuid, p_community uuid)` is a STABLE invoker function with a fixed `search_path`. It returns true when the caller (`app.user_id`) has an active membership and either a staff community role or a valid, unrevoked grant from the same ministry. Every member read policy uses it (ADR §4a). Removed posts and replies are hidden by the services, not by RLS, so staff can still see them.

**Writes go through definers.** These follow ADR §4a: narrow, audited functions with owner policies keyed on settings, the 0036/0037 pattern. They check the posting capability, hosts-only categories, banned or inactive membership, and the comments-off and likes-off switches.
- `community_post_save(slug, post_id|null, category_id, title, body, body_text, video_url, cover_file_id, attachment_ids[], comments_off, likes_off)` creates a post or edits the author's own post. Files must be the caller's own, `ready`, in the same community and not attached elsewhere.
- `community_post_delete(post_id)` is the author's own delete, and soft: it sets `removed_at`.
- `community_comment_save(post_id, comment_id|null, body)` and `community_comment_delete(comment_id)`.
- `community_like_toggle(target_type, target_id)`.
- `community_moderate(action pin|unpin|remove_post|remove_comment, target_id)` requires the `community:moderate` capability: community owner, admin or moderator. Ministry staff use the same action through a staff service in `withTenant`.
- `community_file_create(...)` records an upload intent. `community_file_set_status(file_id, status)` is limited to the uploader and allowed transitions.

## Rich text

The editor is Tiptap 3 (MIT) with a restricted extension set: paragraph, heading (levels 2 and 3), bold, italic, strike, bullet and ordered lists, blockquote, hard break, and link (http, https or mailto, opening in a new tab with `rel="nofollow noopener noreferrer ugc"`). Stored content is Tiptap JSON. A recursive zod schema allows only those nodes, marks and attributes, and caps depth and size. The server derives `body_text`. Display uses a React renderer over the validated JSON, never raw HTML.

## Video

- **Embedded players:** links from the two largest video platforms play inside the post. The server turns a recognised URL into a privacy-enhanced embed URL (no-cookie or "do not track" form). It is shown in a sandboxed `iframe` (`allow-scripts allow-same-origin allow-presentation`, lazy loading, `strict-origin-when-cross-origin` referrer, and an accessible title).
- **Other links:** any other https URL is shown as a link card.
- **Copy:** UI text stays provider-neutral ("Paste a video link").

## Uploads (covers and attachments)

- **Flow:** the existing storage adapter (presigned PUT, then `inspect`, which checks size, MIME and checksum) and the `FileScanner` interface.
- **Release rule:** a file becomes `ready` only on a `clean` verdict. Outside production, a `skipped` verdict also counts, so the feature can be developed and tested.
- **Production:** files stay quarantined until a real malware scanner is wired. That scanner is an activation gate, recorded in the acceptance doc and the feature-flag doc.
- **Downloads:** only for readers of the community (the read predicate), through short-lived presigned URLs and only for `ready` files. Covers display through the same route.

## Owner setup

- **Channels step:** the editor's Channels step becomes active with a **Forum categories** card. Owners can add a category, rename it, set its emoji, switch "Hosts only", reorder with Move up/down, and delete it when it has no posts. Chat channels in that step stay "Coming soon".
- **People step:** unchanged.

## Testing

**Integration (two ministries):**
- read rules: active plus grant; pending, banned, left and other-community members read nothing; a ministry viewer reads as staff;
- hosts-only categories;
- comments-off and likes-off;
- authors edit and delete only their own content;
- moderators pin and remove; members cannot;
- uploads: an attachment must be the caller's own and ready, at most 5, cover must be an image;
- likes toggle, and are idempotent per person;
- the rich-text validator rejects unknown nodes, `javascript:` links and oversize content;
- video URL parsing;
- restricted owner for the definers.

**Unit:** the rich-text schema and plain-text extraction, video URL parsing, and the forum sort.

**Browser:**
- the owner creates categories, including a hosts-only one;
- a member writes a post with headings and a list, a cover image, an embedded video link and a PDF attachment;
- another member likes it and replies;
- the author edits it; a host pins it and removes a reply;
- the member cannot post in the hosts-only category;
- Members and About pages;
- phone bottom bar;
- axe, no horizontal scroll, light and dark at three sizes.
