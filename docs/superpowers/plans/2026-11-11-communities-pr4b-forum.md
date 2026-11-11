# Communities PR 4b (C09 + C10, full Eden post) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** a member layout and a forum with full Eden posts (rich text, cover, embedded video, attachments, comments and likes switches), likes, replies, pinning and removal, plus Members and About pages and forum-category setup for owners.

**Architecture:** migration 0038 adds five tables:
- each has FORCE RLS;
- staff tenant policies and a member read policy through `community_can_read`;
- every member write goes through an audited SECURITY DEFINER function with settings-keyed owner policies (0036/0037 pattern).

Rich text is Tiptap JSON, validated by a shared zod schema and rendered by a React renderer. Uploads reuse the storage adapter and `FileScanner`, and are released only on `clean` in production.

**Spec:** `docs/superpowers/specs/2026-11-11-communities-pr4b-forum-design.md`

## Global Constraints

- **Branch and migration:** branch `c09-c10-community-forum`; migration `0038_community_forum`.
- **Flag:** everything sits behind `communitiesEnabled()`.
- **Copy and layout:** copy in `messages/en.json` and provider-neutral; full width; 44px targets; light and dark; Eden design, Studio Admin style.
- **No raw user HTML is ever rendered.** Links allow only http, https or mailto. Iframes go only to the two allow-listed privacy-enhanced embed hosts, and are sandboxed.
- **Neutral answers:** non-readers get 404 for every forum route.
- **Tests:** restricted-owner suites run as `tester`; browser tests run with `--trace off`.

## Tasks

### Task 1: Shared libraries (pure)

**Files:**
- `src/lib/rich-text.ts`: `richTextDoc` (zod), `plainText(doc)` and `richTextLimits`;
- `src/lib/video-embed.ts`: `videoEmbed(url): { kind: "embed", src, provider } | { kind: "link", href } | null`;
- `src/lib/forum.ts`: post and comment input schemas, plus the file kinds and MIME rules for covers and attachments;
- `tests/unit/rich-text.test.ts`, `tests/unit/video-embed.test.ts`.

**Steps:**
- [ ] Write the tests: allowed nodes pass; unknown node, unknown mark, `javascript:` link, depth > 12 and size > 100 KB fail; `plainText` joins paragraphs and list items; the video URL forms (watch, short and share links, the alternative platform's numeric id) map to privacy-enhanced embed URLs; other https URLs become links; non-https or garbage URLs return null.
- [ ] Implement, run the tests, commit.

### Task 2: Migration 0038 and database tests

**Files:** `src/db/schema.ts` (5 tables), `drizzle/0038_community_forum.sql` (generated plus hand-written), `tests/integration/community-forum-db.test.ts`, `tests/integration/community-joining-definer-owner.test.ts` (extend with the new definers and tables).

**Steps:**
- [ ] Add the schema, then run generate (answer prompts through `script` if needed).
- [ ] Hand-written SQL:
  - "General" category for existing communities, under a migration-local owner policy;
  - RLS: staff policies, plus a member SELECT policy through `community_can_read` on all 5 tables;
  - owner policies keyed on `app.community_definer_tenant`, with the reset function extended;
  - the definers: `community_post_save`, `community_post_delete`, `community_comment_save`, `community_comment_delete`, `community_like_toggle`, `community_moderate`, `community_file_create`, `community_file_set_status`;
  - grants.
- [ ] Database tests for the read rules, hosts-only, the comments/likes switches, own-content edits, moderation by role, attachment rules and like idempotence.
- [ ] Run the restricted-owner suite as `tester`, then commit.

### Task 3: Services and routes

**Files:**
- `src/server/community-forum.ts`: `forumHome`, `listPosts`, `getPost`, `savePost`, `deletePost`, `saveComment`, `deleteComment`, `toggleLike`, `moderate`, `listMembersForMembers`;
- `src/server/community-files.ts`: `createCommunityUpload`, `confirmCommunityUpload` and `communityFileUrl`;
- `src/server/communities.ts`: category CRUD for owners (`listCategories`, `saveCategory`, `deleteCategory`, `moveCategory`), plus "General" on create;
- API routes under `src/app/api/communities/[slug]/...` and `src/app/api/workspaces/[tenantId]/communities/[communityId]/categories`;
- `tests/integration/community-forum.test.ts`; `tests/unit/communities-flag.test.ts` extended.

**Steps:**
- [ ] Service tests: list and sort (New with pinned first, Best this week by likes in the last 7 days); removed content is hidden from members but visible to staff; uploads with the mocked storage and scanner (clean leads to ready; skipped leads to ready only outside production; quarantined files can't attach); category CRUD with permissions.
- [ ] Implement, then run typecheck and lint, then commit.

### Task 4: UI

**Files:**
- `src/components/communities/community-shell.tsx` (rail plus mobile tab bar);
- `src/components/forum/*`: post list, post card, the new/edit post dialog (Tiptap editor, cover upload, video field, attachments, switches), the post view (renderer, embed, attachments), replies and like button;
- `src/components/rich-text/rich-text-editor.tsx` and `rich-text-view.tsx` (shared);
- `src/components/communities/forum-categories-editor.tsx` (editor Channels card);
- pages under `src/app/communities/[slug]/(member)/`: `layout`, `forum`, `posts/[postId]`, `members`, `about`; the old `home` page redirects to `/forum`;
- `src/lib/community-editor.ts`: the Channels step is no longer "Coming soon";
- `messages/en.json`.

**Steps:**
- [ ] Install `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` and `@tiptap/extension-link` at the exact version 3.33.1.
- [ ] Build the components, then run lint, source guards and typecheck, then commit.

### Task 5: Browser test, evidence, records, PR, CI, review

- [ ] `tests/e2e/community-forum.spec.ts`, following the spec's browser scenario, with screenshots in `docs/screenshots/communities-pr4b/`.
- [ ] Regression runs: `community-joining`, `community-applications`, `community-editor`, `layout`.
- [ ] Write `docs/acceptance/communities-c09-c10.md`; update ADR 0013's status, `CLAUDE.md` (0038) and the feature-flag doc (scanner gate for member uploads).
- [ ] Open the draft PR, then run CircleCI, Neon from `main` and the independent review.
