# Communities C04 — shared EditorShell and community editor: acceptance record

Builds on C01–C03 (PR #57). Design of Eden (editor with steps, settings and live preview), style of Studio Admin (shared shadcn components, theme tokens, floating shell). Communities stay off in production (`HARVEST_COMMUNITIES=enabled` activates them; local and tests have them on).

## What shipped

- **Shared `EditorShell`** (`src/components/editor/editor-shell.tsx`): step rail (scrollable bar on small screens), centre settings, live preview (sheet on small screens), always-visible header actions. Reusable by courses and products.
- **Shared `useUnsavedChangesGuard`** (`src/hooks/use-unsaved-changes-guard.ts`): extracted unchanged from the Connect landing editor, which now uses it; its five browser tests pass, including the history-warning cases.
- **Owner pages:** `/workspaces/[id]/communities` (list and "New community" dialog with an address suggested from the name) and `/workspaces/[id]/communities/[community]/edit`. A "Communities" navigation entry appears only when the flag is on (new optional `feature` on registry entries).
- **Community editor:** all nine steps shown; Offer (Free; Paid "Coming soon"), Basics (name, tagline, address), Joining (visibility, ways to join), People (members with role and status, invite "Coming soon"), Publish (checklist) work; Channels, Messages, Products and Page are disabled with "Coming soon". Save draft, Publish/Unpublish, optimistic-version conflicts with a reload option, read-only mode for ministry members and viewers.
- **`CommunityJoinCard`**: live preview now; reused by the public page in C05.
- **Server and API:** flag `communitiesEnabled()`, publish checklist enforced server-side (`publishCommunity`), `getCommunity`, `listCommunityMembers` (name, role, status; no contact details), routes `GET/POST /api/workspaces/[id]/communities`, `GET/PATCH …/[communityId]`, `POST …/[communityId]/publish`, all 404 when the flag is off.

## Validation (author-executed, local)

- Lint and source guards, typecheck, 352 unit tests (editor steps, checklist, flag), integration `communities` (9, incl. publish checklist, members without contact details, viewer and other-ministry denials).
- Browser `community-editor`: create (taken address refused), coming-soon steps disabled, live preview, unsaved-changes dialog, save, joining and visibility, publish/unpublish, people, stale-edit conflict with reload, paid refused by the API, viewer read-only with API 403s; axe and no horizontal scroll at 390/768/1440 in light and dark; screenshots in `docs/screenshots/communities-c04/` viewed.
- Regression: `connect-landing` (5), `campaigns` (navigation link count 12 → 13 for the new entry), `layout`, `foundation`. The `layout` spec failed once on its first run alongside the expected campaigns count failure; it then passed in two consecutive clean runs and the cause was not captured.

## Not covered

Public page, Discover, joining, invitations, applications, member shell, feed, moderation, notifications (C05–C15); course, product and event links. Channels, Messages, Products and Page steps are placeholders until their slices.

## Gates

No merge, deployment or activation is authorized. No migration in C04.
