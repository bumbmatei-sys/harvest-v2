# C11b — pinned source audit and implementation gate

17 Nov 2026. **Preparation only: no UI is delivered by this record.** C11a is draft PR [#121](https://github.com/bumbmatei-sys/harvest-v2/pull/121); C11b follows its server contract. The licence is settled (founder, 17 Nov: “License settled, go ahead”); premium kit blocks may land with provenance recorded. The founder owns the licence consequences.

## Source evidence

Studio Admin was cloned read-only, outside Harvest, with `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/arhamkhnz/next-shadcn-admin-dashboard`. HEAD exactly matches the spec's pin: **`c16e1af271a1c522a01feb43074b32abfe114241`**. Its [MIT licence](https://github.com/arhamkhnz/next-shadcn-admin-dashboard/blob/c16e1af271a1c522a01feb43074b32abfe114241/LICENSE) names copyright 2024 Mohammed Arham Khan; adopted substantial code must retain that notice.

The real app is `src/app/(main)/chat/`; its `_components/chat.tsx` supplies the responsive list/pane and Sheet composition. `chat-conversation-list.tsx` supplies list rows; `chat-thread.tsx` supplies the bubble/message hierarchy and InputGroup composer. The dashboard chat page is a preview/link, not the app source. The mock `data.ts`, contact details, avatars, branding sidebar and zustand mock-data store must not be adopted.

The free `bubble1` registry item was fetched using **plain curl, no Authorization header**, only into `/tmp/harvest-c11b-kit-audit/`. It is `registry:component`, with files `contents/components/bubble/1/index.tsx` and `components/ui/bubble.tsx`, and dependencies `class-variance-authority@0` and `radix-ui` (both families already installed). No premium item, registry JSON or downloaded source is in Harvest. No token was printed, searched for or stored.

## Exact planned item per area

These choices apply the standing kit-first rule. They are not a licence confirmation or a claim that a component is installed.

| Area | Selected source and preview | Alternative / approved fallback | Harvest composition |
| --- | --- | --- | --- |
| Channel list + message pane + thread panel | [`chat-ui10`](https://shadcnuikit.com/blocks/application-ui/chat-ui#chat-ui-10) | `chat-ui4`; pinned MIT `chat.tsx` if the kit cannot be used | `CommunityShell`, `Sheet`, `Tabs` |
| Channel rows | [`chat-ui4`](https://shadcnuikit.com/blocks/application-ui/chat-ui#chat-ui-4) | [`chat-ui5`](https://shadcnuikit.com/blocks/application-ui/chat-ui#chat-ui-5); pinned `chat-conversation-list.tsx` | `Item`, `Avatar`, `Badge`, `DropdownMenu` |
| Composer | InputGroup composer inside [`chat-ui10`](https://shadcnuikit.com/blocks/application-ui/chat-ui#chat-ui-10), not a standalone registry item | pinned `chat-thread.tsx` InputGroup pattern | `InputGroup`, `Textarea`, `Command`, `Popover` |
| Bubbles/reactions | [`bubble1`–`bubble7`](https://shadcnuikit.com/components/bubble), approved free family | pinned MIT `components/ui/bubble.tsx` | `Avatar`, semantic tokens, shared action menus |
| Scroller/jump to latest | `message-scroller`, dependency file inside the chosen block; [chat preview](https://shadcnuikit.com/dashboard/apps/chat) | approved pinned MIT `components/ui/message-scroller.tsx` | `ScrollArea` where appropriate; labelled message log |
| Editor channel settings | Existing `EditorShell` Channels step and forum-category management pattern | existing shared Field controls | `StickySaveBar`, `ConfirmDialog`, member picker |
| Report/held sources | Existing moderation views and `ReportDialog` | existing shared empty/error states | C11a Chat source endpoints, `NotificationBell`, `MemberList` |

## Dependency/adaptation findings

- Studio's scroller is a wrapper around **`@shadcn/react/message-scroller`**, not a standalone React implementation. The pinned project specifies `@shadcn/react ^0.3.1`, `@base-ui/react ^1.9.0` and `zustand ^5.1.0`; Harvest has none of those packages. Do not copy the scroller and leave an unresolved import, replace its behavior with a hand-built scroller, or import the mock zustand store. Verify the required primitive package/its licence before adding the actual dependency; do not install unrelated packages merely because the template has them.
- `cn` imports become Harvest's utility import. The Bubble implementation already uses radix Slot and cva; retain Harvest's installed shared primitives and tokens.
- The source is a one-to-one mock inbox. Channel eligibility, threads, validated mentions, pins, read/mute, polling, moderation and idempotency are Harvest logic, bound to C11a. Contact profile data, online/typing/read receipts, attachments and provider buttons are outside this slice.
- All adopted files require provenance entries in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`, catalogue copy, semantic tokens, no sample data or remote avatar requests, full-width composition, reduced motion and 44px phone targets. Use the existing shared component rather than importing its template duplicate.
- The schema includes later modes; tier/tag controls remain disabled with concise “Coming soon” copy. No new navigation registry/AppShell changes are needed.

## Remaining implementation and evidence

C11b still needs the adopted layout/pane/composer/rows, visibility-aware polling with backoff and Retry-After, drafts/retry, thread/pin/reaction/mention controls, channel management, Chat moderation source, unread/mute and live rail/bottom navigation. DMs remain C11c. The final C11b PR must name the exact adopted item per area and record provenance.

No runtime, browser or accessibility check is claimed for this documentation-only preparation. No screenshots exist yet. Required evidence remains multi-session chat and unread/mute/reconnect checks, axe, overflow and keyboard behavior, 44px targets, and light/dark screenshots at **360/768/1280** in `docs/screenshots/communities-c11b/`. Run the repository's required static/unit/integration/build checks after implementation. A separate fresh session must review the finished PR.

The licence is settled (founder, 17 Nov). Premium kit blocks may be used wherever they fit, with provenance recorded; approved free primitives and the MIT fallback remain available. No merge, deployment, production activation or HC-02 approval is requested or claimed.
