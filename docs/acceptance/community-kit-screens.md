# Community screens rebuilt from the UI kit (27 Nov 2026)

Founder approval of 27 Nov 2026: eleven Shadcn UI Kit items for the community member area, the owner forum categories editor, the notification settings sheet, the email frequency choice and the unsubscribe page, started from the real kit code (registry `files[].content`). Provenance: `src/lib/ui-provenance.ts` (`kitProvenance` rows and the "Community screens" `kitApprovals` entry) and `docs/ui-sources.md`, "Community screens". No migration, no dependency, no new route.

## Acceptance

| # | Requirement | Delivered | State |
| --- | --- | --- | --- |
| 1 | Community header and icon rail from dashboard-shell4; phone bottom bar Harvest-owned | `community-shell.tsx`: inset sidebar with round icon buttons (primary when active), muted site header with the name, the current section and the bell; Harvest bottom bar below 1024px | Done |
| 2 | Feed post card from social-media-post2, props unchanged for PR #339 | `post-card.tsx` | Done |
| 3 | Category pills from product-list5 | `category-pills.tsx` (links with `aria-current`) | Done |
| 4 | Newer and Older from pagination1 | `forum-pager.tsx` | Done |
| 5 | Post page and replies from social-media-post3 | `post-thread.tsx`; `PostComments` and `PostComment` moved here with the same props | Done |
| 6 | Owner forum categories editor from list-block29 | `forum-categories-editor.tsx`: hosts-only switch and a row menu (Edit, Move up, Move down, Delete) | Done |
| 7 | Classroom from chart69 (course rows with lesson count and progress) | `community-classroom.tsx`: rows with filter, sort, marks and the access step | Partly: lesson count and progress deferred (no read exists; needs a definer read and a migration) |
| 8 | Products from product-list1 | `community-products.tsx`: grid of tiles (no product images exist yet) | Done |
| 9 | Notification switches sheet from list-block3 | `notification-settings-sheet.tsx` | Done |
| 10 | Email frequency from dashboard-modal15 | `email-frequency-dialog.tsx`, opened from the sheet's Email row; saves the email route on its own | Done (flow change: the sheet's Save now sends only the switches) |
| 11 | Unsubscribe page from dashboard-modal12 | `unsubscribe-confirm.tsx`: an always-open, non-dismissable confirmation window; token handling unchanged | Done |
| 12 | Behaviour unchanged | Routes, permissions, held and removed states, Former member, likes and replies, enrolment, unsubscribe token and chat polling untouched; ListingCard (PR #338) and the composer (PR #339) untouched | Done |

## Shared change

`SidebarProvider` gains `persist` (default true). The community shell passes `persist={false}`, so its rail never writes the `sidebar_state` cookie or takes the Ctrl+B shortcut that the main app sidebar uses.

## Evidence

Screenshots (device scale 2, 390 and 1440 wide, light and dark): `docs/screenshots/community-kit/` — feed, post, classroom, products, categories-editor, notification-sheet, email-frequency, unsubscribe. Produced by `tests/e2e/community-kit-screens.spec.ts` with `COMMUNITY_KIT_SHOTS=1` (skipped otherwise).

Selector changes in the existing specs (behaviour unchanged): the categories editor's emoji, move and edit actions are reached from the row menu (`community-forum.spec.ts`); the email frequency radios are in the "Email frequency" window opened from the sheet, and the neutral unsubscribe result is read from the window (`community-email-screens.spec.ts`).
