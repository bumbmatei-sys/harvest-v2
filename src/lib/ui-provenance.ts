/**
 * Provenance record for files derived from the Shadcn UI Kit (see docs/ui-sources.md, "Shadcn UI Kit provenance").
 * Rule: every kit-derived file starts with the header below AND is listed in `kitProvenance`.
 * Tests enforce both directions. Kit PR 1 adopts four items, Kit PR 2 two premium items and Kit PR 3 four (two premium, two free) and Kit PR 4 four (two premium, two free) and Kit PR 5 three (premium) and Kit PR 6 three (premium) and Kit PR 7 four (premium; tables14 gains a second file) as references; the stock primitives they depend on are hand-written
 * (docs/ui-sources.md) and are not kit-derived.
 */
export type KitItemRecord = {
  /** Registry item name exactly as in the registry, for example `stat-card1`. */
  item: string;
  tier: "free" | "premium";
  /** The kit has no version number: the date the registry entry was retrieved (YYYY-MM-DD). */
  registryRetrieved: string;
  installed: string;
  approvedBy: string;
  approvedOn: string;
  /** Harvest-side changes made to the item (conversion notes). */
  localChanges: string;
  /** Repository-relative destination files; each must start with the provenance header. */
  files: readonly string[];
};

const approved = { registryRetrieved: "2026-11-16", installed: "2026-11-16", approvedBy: "founder", approvedOn: "2026-11-16" } as const;
export const kitProvenance: readonly KitItemRecord[] = [
  { ...approved, item: "toast1", tier: "free", files: ["src/components/dev/kit-toast-example.tsx"],
    localChanges: "The kit demo (a button that shows a toast with a description and an Undo action) is kept as the showcase example; copy from the catalogue, no sample date. The sonner wrapper (src/components/ui/sonner.tsx) and helper (src/lib/toast.ts) are Harvest-written, not kit code: theme tokens instead of next-themes, catalogue strings, 44px action target." },
  { ...approved, item: "spinner1", tier: "free", files: ["src/components/dev/kit-spinner-example.tsx"],
    localChanges: "The kit demo (one small spinner) is widened to Harvest's three sizes in the showcase. The spinner primitive is hand-written: role=status with a catalogue label, decorative mode, no rotation under reduced motion." },
  { ...approved, item: "scroll-area1", tier: "free", files: ["src/components/dev/kit-scroll-area-example.tsx"],
    localChanges: "The kit demo (a fixed-height list with separators) is kept as the showcase example; version-tag sample data replaced by catalogue rows; the viewport is focusable with a region name because its rows are plain text. The scroll area primitive is hand-written on radix-ui with token-based scrollbars." },
  { ...approved, item: "drawer1", tier: "free", files: ["src/components/dev/kit-bottom-sheet-example.tsx"],
    localChanges: "Visual reference only; no kit code, no drawer library (vaul is not an approved dependency). The composition (title, body, stacked actions) is built on the existing Sheet as a bottom sheet with a handle, safe-area padding and a 44px close target." },
  { ...approved, item: "dashboard-shell8", tier: "premium", files: ["src/components/app-shell.tsx"],
    localChanges: "Visual reference only; no kit code was copied. Harvest keeps its own AppShell, floating sidebar and typed navigation registry (the file carries the header because the provenance test requires it). The only change inspired by the item is the optional header composition slots (page actions, page search), which render nothing unless a page passes them. Kit demo copy, sample images and hard-coded colors are not used. Not chosen: dashboard-shell1, sidebar-layout, dashboard-shell2, dashboard-shell3." },
  { ...approved, item: "dashboard-dropdown7", tier: "premium", files: ["src/components/ministry-switcher.tsx"],
    localChanges: "Pattern reference only; no kit code was copied. The kit item is a Popover with Command; Harvest places the same pattern (search, initials marks, role and member count per ministry, a check on the current one) inside the account menu's DropdownMenu so the menu stays one keyboard-navigable role=menu, and the search field appears only above five ministries. Create-ministry dialog, plan badges and sample data are not used. Not chosen: dashboard-dropdown1 to dashboard-dropdown6, dashboard-dropdown8 to dashboard-dropdown10." },
  { ...approved, item: "tables14", tier: "premium", files: ["src/components/data-table.tsx", "src/components/communities/moderation-panel.tsx"],
    localChanges: "Visual reference only; no kit code was copied and TanStack Table is not used (the kit item depends on it; no new dependency is approved). Harvest's DataTable is a presentational shell on the existing Table, Tabs, Checkbox, Skeleton and DropdownMenu primitives: toolbar slots, status tabs with counts, sortable headers (aria-sort), optional row selection with a bulk bar, loading, empty and error slots, a pagination slot and a stacked card list below 768px. The kit's demo data, CSV export, assignee and billing filters and the card header are not used. Not chosen: tables5, tables7. Kit PR 7 reuses the same reference for the community moderation queue: the five moderation tables (reports, held, members, appeals, history) sit on the DataTable shell with type and appeal-state tabs and phone cards. The kit's row selection and bulk actions are not used: no bulk moderation endpoint exists and none was added." },
  { ...approved, item: "empty-state15", tier: "premium", files: ["src/components/empty-state.tsx"],
    localChanges: "Visual reference only; no kit code was copied. EmptyState composes the existing Empty primitive: icon, title, optional description, one primary action and an optional secondary one, in compact and standard sizes. The kit's section wrapper, sample copy and two-button demo are not used. Not chosen: empty-state1, empty-state2, empty1." },
  { ...approved, item: "badge1", tier: "free", files: ["src/components/status-badge.tsx"],
    localChanges: "Visual reference only; no kit code was copied. StatusBadge wraps the existing Badge with a typed tone map (neutral, success, warning, danger, info, pending) on theme tokens and an optional dot; callers map their own statuses to tones (src/lib/status-tone.ts). Not chosen: badge2, badge6." },
  { ...approved, item: "alert-dialog1", tier: "free", files: ["src/components/confirm-dialog.tsx"],
    localChanges: "Visual reference only; no kit code was copied. ConfirmDialog wraps the existing AlertDialog with a destructive or neutral tone, caller-supplied text, an async confirm with a busy state (both buttons aria-disabled so focus stays put, dismissal blocked), an inline failure message and an optional focus-return target. Not chosen: alert-dialog2, alert-dialog5." },
  { ...approved, item: "stepper1", tier: "free", files: ["src/components/stepper.tsx"],
    localChanges: "Visual reference only; no kit code was copied and the kit's @base-ui/react dependency is not used. Harvest's Stepper is a hand-written numbered list: a wizard layout (horizontal with connectors from 768px; a compact Step n of m line with a progress bar below) and a nav layout of buttons for editors (vertical from 1024px, scrollable bar below). aria-current=\"step\", done/active/upcoming as text for screen readers, 28px indicators inside 44px targets on phones, no JS motion. Not chosen: stepper2, stepper4." },
  { ...approved, item: "form-layout20", tier: "premium", files: ["src/components/wizard-layout.tsx"],
    localChanges: "Visual reference only; no kit code was copied. WizardLayout is the step frame of the kit's three-step onboarding wizard (stepper, step heading and content, Back and Next) rebuilt on Harvest's Card, Button, Spinner and the Stepper: a validate hook before Next, busy states, focus on the step heading after Back, Next or Finish, no react-hook-form inside (the caller owns values). The kit's account, company and plan fields, sample copy and the react-hook-form and zod 3 demo are not used. Not chosen: onboarding-screen9, form-layout21." },
  { ...approved, item: "form-layout1", tier: "premium", files: ["src/components/form-section.tsx"],
    localChanges: "Visual reference only; no kit code was copied. FormSection is the titled section of the kit's settings form: a named region with a heading and optional actions, a split layout (title beside fields from 1024px), or a labelled fieldset for radio and checkbox groups. The kit's fields, avatar upload, sticky save bar and copy are not used. Not chosen: form-layout15." },
  { ...approved, item: "field1", tier: "free", files: ["src/components/dev/kit-field-example.tsx"],
    localChanges: "The kit demo (a labelled input in a field group) is kept as the showcase example with Harvest's existing Field, FieldLabel, Input and FieldError and catalogue copy, shown inside a FormSection. The Field primitive itself is Harvest's own and is unchanged. Not chosen: field2, field4." },
  { ...approved, item: "tables19", tier: "premium", files: ["src/components/crm/list-row-summary.tsx"],
    localChanges: "Visual reference only (Kit PR 5); no kit code copied. RowSummary is the phone card layout of the kit's people directory: under a row's name, a consent status badge and tappable email, phone, domain or people-count links (44px), shown only while the list card is narrower than its first extra column. People and Organizations keep ListPage, the shared filter popover and chips, saved views and the keyboard grid (RecordGrid); the kit's table, side sheet, sample people, bulk bar and pagination are not used (no bulk action exists server-side). Not chosen: tables5, tables7." },
  { ...approved, item: "tables21", tier: "premium", files: ["src/components/copy-button.tsx", "src/components/crm/contact-actions.tsx"],
    localChanges: "Visual reference only (Kit PR 5); no kit code copied. CopyButton (icon button, toast confirmation, 44px below 1024px) and ContactActions (email and phone as mailto and tel links with copy buttons in the person header) follow the kit's contact record. The record keeps RecordLayout, inline per-field editing and the permission-gated consent controls; the kit's whole-record edit mode, avatar upload and sample data are not used." },
  { ...approved, item: "todo-app6", tier: "premium", files: ["src/components/status-tracker.tsx", "src/components/crm/activity-timeline.tsx", "src/components/crm/tasks/task-rows.tsx"],
    localChanges: "Visual reference only (Kit PR 5); no kit code copied and no vaul drawer. StatusTracker is the kit's segmented step bar as a read-only component (used for a deal's stage progress). The activity timeline keeps its data, grouping, paging and note permissions and takes the kit's rail, right-aligned time, bordered note panel with icon actions and the grouped note composer (textarea with Add note in one frame; Ctrl or Cmd plus Enter hint as keys). Task rows keep the completion checkbox and dialog and show overdue and priority as StatusBadge. The kit's attachments, links, sample tasks and drawer are not used. kanban-board3 was an optional reference and the deal board is unchanged." },
  { ...approved, item: "chat-ui4", tier: "premium", files: ["src/components/connect-admin/follow-up-timeline.tsx", "src/app/workspaces/[tenantId]/connect/follow-up/[caseId]/page.tsx"],
    localChanges: "Visual reference only (Kit PR 6); no kit code copied, no @shadcn/react message scroller, drawer, sonner or sample data. The follow-up case detail takes the shared inbox's thread-and-side-panel layout: a case header with the state badge, a details panel, and an event timeline on a rail (opened, assigned, state changed) built only from the timestamps the case API returns. The kit's message composer, internal note, attachments and reactions are not used: the case holds no notes and no server contract exists for them. Layout composes Harvest's RecordGrid, Card, StatusTracker and StatusBadge. Not chosen: chat-ui5." },
  { ...approved, item: "tables15", tier: "premium", files: ["src/components/connect-admin/follow-up-queue.tsx"],
    localChanges: "Visual reference only (Kit PR 6); no kit code copied and no TanStack Table. The follow-up queue is Harvest's DataTable shell (state tabs, cards on phones) with a state badge per row, the case reference and a link to the CRM contact. The kit's stage tabs with counts are kept as state tabs without counts (the case API returns no totals); the kit's row selection, bulk stage moves, search and client-side sorting are not used (no bulk server action exists, and paging is a server cursor). Not chosen: tables14." },
  { ...approved, item: "switch-card1", tier: "premium", files: ["src/components/permission-card.tsx"],
    localChanges: "Visual reference only (Kit PR 6); no kit code copied and no react-hook-form, zod 3 or Switch. PermissionCard is the label, description and state card of the kit's notification settings, as display only: the state is a text badge (never a switch, since consent changes by recording a new event) with an optional meta line and a slot for the record buttons a role may use. Used by the person page's contact permissions and the follow-up case's consent cards." },
  { ...approved, item: "tables9", tier: "premium", files: ["src/components/communities/member-list.tsx"],
    localChanges: "Visual reference only (Kit PR 7); no kit code copied, no TanStack Table, no sample members. Member list: avatar mark with name, role badge with an icon for hosts, status badge, status tabs with counts and a name search for owners and admins, phone cards below 768px. The kit's featured switch, channel icons, reputation and trend columns are not used: no server contract or data exists for them. Not chosen: tables5." },
  { ...approved, item: "form-layout11", tier: "premium", files: ["src/components/communities/create-community-dialog.tsx"],
    localChanges: "Visual reference only (Kit PR 7); no kit code copied, no react-hook-form or zod 3. The new-community form takes the kit's address field with a visible prefix (/communities/) and the suggested address from the name; the community details step of the editor groups its fields in a FormSection. The cover dropzone, visibility choice, topic and invite fields are not used: the create API takes only a name and an address and no cover upload exists. Not chosen: form-layout15." },
  { ...approved, item: "product-list7", tier: "premium", files: ["src/components/communities/discover-card.tsx"],
    localChanges: "Visual reference only (Kit PR 7); no kit code copied, no remote images or prices. Discover result card: a token-coloured band with the community's initials in place of the product photo, name, tagline, host, free and open badges and a View link; the type switcher is a segmented control. Filtering stays in the URL (search, open to join) with server results; the kit's client-side category tabs and price are not used. Not chosen: product-list1." },
  { ...approved, item: "social-media-post1", tier: "premium", files: ["src/components/forum/post-card.tsx"],
    localChanges: "Visual reference only (Kit PR 7); no kit code copied, no remote avatar or image, no share, save or edit menu. Forum feed card: author mark, name and date in the header, optional cover above the title, excerpt, and a footer bar with replies and likes. Pinned, held, category and video markers are kept as badges. Likes, reporting and editing keep their existing controls and server checks. Not chosen: chat-ui3." },
];

/**
 * Files really copied from the founder-supplied premium Shadcn UI Kit chat app (repository bumbmatei-sys/chat-app, commit 66fd523, approved
 * 19 November 2026) for Communities C11b and C11c. Each file starts with: Derived from bumbmatei-sys/chat-app (Shadcn UI Kit, premium,
 * founder-supplied 19 Nov 2026): <source>. A test checks the header in both directions. bubble.tsx is a near-verbatim copy (97% of lines).
 * The two C11c files were made by editing the kit file text in place and rewriting what depended on the mock store: the share of lines still
 * identical to the kit file is stated per file (measured on trimmed lines of 12 or more characters). Not copied: status and stories, calls,
 * contacts, media lightbox, authentication pages, and the zustand mock store.
 */
export const chatAppProvenance = {
  repository: "bumbmatei-sys/chat-app", commit: "66fd523", tier: "premium", approvedBy: "founder", approvedOn: "2026-11-19",
  files: [
  { file: "src/components/ui/bubble.tsx", source: "components/ui/bubble.tsx", localChanges: "Copied; the header is added and the tinted variant uses a primary tint token instead of an oklch literal (source guard). Uses @base-ui/react use-render and merge-props. Own messages use the default variant, others muted." },
  { file: "src/components/communities/chat/dm-new-message-dialog.tsx", source: "app/(auth)/chats/components/new-message-dialog.tsx", localChanges: "Adapted copy (C11c): the kit dialog skeleton, search field, person rows, selected-person footer and Continue button are kept; about 27% of lines are still identical to the kit file. Group mode, logo upload, the contact and chat stores and the demo copy are removed. The people list comes from the existing server search, one person is chosen, a message field is added because starting a conversation sends its first message, and every refusal shows one neutral message. Copy comes from the catalogue; targets are 44px." },
  { file: "src/components/communities/chat/dm-list.tsx", source: "app/(auth)/chats/components/chat-list.tsx, app/(auth)/chats/components/chat-list-item.tsx", localChanges: "Adapted copy (C11c): the kit list and row are kept in structure and class names; about 24% of lines are still identical to the two kit files. The chat store, status icons, message preview, online indicator and group items are removed. Rows are real buttons (the kit row is a clickable div), show the other person's name, time and an unread badge, and carry a 44px options menu (Mute, Hide). Blocked and read-only conversations show a short label." }
  ],
} as const;

/**
 * Files whose layout and behaviour are modelled on the same chat app but whose code was written for Harvest: no kit code is copied
 * (a 50-character window comparison against commit 66fd523 found no shared code). Each starts with: Layout and behaviour modelled on
 * bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): <source>; code written for Harvest, no kit code
 * copied. The founder accepted this result on 19 November 2026; the DM, profile and events screens adopt real kit code from the start (the C11c new-message dialog and conversation list are listed in chatAppProvenance above).
 */
export const kitChatAppReferences = {
  repository: "bumbmatei-sys/chat-app", commit: "66fd523", tier: "premium", acceptedBy: "founder", acceptedOn: "2026-11-19",
  files: [
  { file: "src/components/user-avatar.tsx", source: "components/user-avatar.tsx", localChanges: "Initials or the channel emoji in a round avatar on Harvest's Avatar. The kit's image and online indicator are removed: members have no photo or presence. Reused unchanged as the avatar block of the Settings pop-up (profile and account panels)." },
  { file: "src/components/settings/settings-dialog.tsx", source: "components/settings-dialog.tsx", localChanges: "Settings pop-up shell (founder-approved kit item, 20 Nov): title header, section list beside scrolling content. Written on Harvest's Radix Dialog (the kit uses base-ui Dialog and Tabs); full-screen sheet below 768px; sections are Harvest's (You, Ministry), not the kit's switch rows. scripts/ui-identical.sh: 4 of 40 non-blank lines (10%), imports and closing tags only; no kit code copied." },
  { file: "src/components/communities/chat/channel-list.tsx", source: "app/(auth)/chats/components/chat-list.tsx, app/(auth)/chats/components/chat-list-item.tsx, app/(auth)/chats/components/chat-list-item-dropdown.tsx", localChanges: "Channel list with search, unread and mention badges, mute marker and a 44px options menu (Edit, Move up, Move down, Archive, Delete) for roles that manage channels. Mock chat store, status, archive and block items removed; real channels from the chat state." },
  { file: "src/components/communities/chat/chat-header.tsx", source: "app/(auth)/chats/components/chat-header.tsx", localChanges: "Back, mark, name and subtitle. Call buttons removed. The channel name opens the channel info." },
  { file: "src/components/communities/chat/chat-layout.tsx", source: "app/(auth)/chats/components/chats-view.tsx", localChanges: "Two-pane list and channel layout, single pane on phones with the community header and bottom bar hidden. Status strip, call screen and mock store removed; the Harvest polling hook supplies data." },
  { file: "src/components/communities/chat/message-pane.tsx", source: "app/(auth)/chats/components/chat-content.tsx", localChanges: "Header, message viewport and composer composition. Scroll handling uses the shared message scroller and the real polling hook; no mock messages." },
  { file: "src/components/communities/chat/chat-message.tsx", source: "app/(auth)/chats/components/chat-bubbles.tsx", localChanges: "Text bubbles with a time line and a hover and focus action menu. Image, video, file and voice bubbles and the lightbox are not adopted (attachments wait for the malware scanner). Reactions, replies, reports and moderation use the real routes." },
  { file: "src/components/communities/chat/chat-composer.tsx", source: "app/(auth)/chats/components/chat-footer.tsx", localChanges: "Card composer with a round send button. The input is a single 44px line that grows to four lines. Emoji picker, file picker and voice recording are not adopted; a mention picker is added." },
  { file: "src/components/communities/chat/channel-info.tsx", source: "app/(auth)/chats/components/group-detail-drawer.tsx", localChanges: "Channel info panel: avatar, name, member count, notifications, members, pinned messages, links, and empty media and documents sections. Leave group is not offered." },
  { file: "src/components/communities/chat/member-profile-sheet.tsx", source: "app/(auth)/chats/components/user-detail-sheet.tsx", localChanges: "Member profile sheet with name, role and joined date only; no phone, country, website or shared files. C11c adds a Message action that opens a compose dialog; it does not vary with the other person. C09b screens extract the header as MemberSummary (shared with the profile page) and add a link to the full profile." },
  { file: "src/components/communities/chat/message-list.tsx", source: "app/(auth)/chats/components/chat-content.tsx", localChanges: "The scrolling message list, read mark and screen reader notice moved out of the channel pane so channels and private messages share them (C11c). Nothing from the kit file is copied." },
  { file: "src/components/communities/chat/dm-message.tsx", source: "app/(auth)/chats/components/chat-bubbles.tsx", localChanges: "Private message row: text bubble, time, edited marker, deleted placeholder, author menu (edit, delete, restore) and a report action on the other person's messages. No reactions, replies, media, voice or status ticks." },
  { file: "src/components/communities/chat/dm-pane.tsx", source: "app/(auth)/chats/components/chat-content.tsx", localChanges: "Private conversation: shared message list and composer with the real polling hook, an inline not-available state, a read-only banner, a blocked banner with Unblock and a delete confirmation. No mock messages, calls or attachments." },
  { file: "src/components/communities/chat/dm-layout.tsx", source: "app/(auth)/chats/components/chats-view.tsx", localChanges: "Conversation list beside the open conversation (one pane at a time on phones, no bottom bar). Header actions: mute, profile, hide, block. Status strip and call screen are not used." }
  ],
} as const;

/**
 * Files really copied from the founder-supplied premium Shadcn UI Kit admin dashboard (repository bumbmatei-sys/admin-dashboard, commit
 * 1631106, apps/calendar) for Events C14. Each starts with: Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium,
 * founder-supplied): <source>. Harvest changes: docs/ui-sources.md. `identical` is the share of the file's non-blank lines (at least 12
 * characters) that also appear, character for character after trimming, in the source file; it is measured, not estimated.
 * Not copied: drag and drop, the week, day and agenda views, the event dialog, the colour classes (raw palette colours) and the visibility hook.
 */
export const adminDashboardProvenance = {
  repository: "bumbmatei-sys/admin-dashboard", commit: "1631106", tier: "premium", approvedBy: "founder", approvedOn: "2026-11-19",
  files: [
  { file: "src/lib/calendar-days.ts", source: "app/dashboard/(auth)/apps/calendar/utils.ts", identical: 95, localChanges: "Five day-bucketing helpers copied (isMultiDayEvent, getEventsForDay, sortEvents, getSpanningEventsForDay, getAllEventsForDay); only the CalendarEvent import changed. Colour, border-radius, agenda and add-hours helpers not copied." },
  { file: "src/components/events/month-calendar.tsx", source: "app/dashboard/(auth)/apps/calendar/components/month-view.tsx", identical: 47, localChanges: "Month grid structure, week and day computation and cell classes kept. Social Publish extends it (optional namespace, chip renderer, native drag-and-drop day targets and a weekStartsOn option, Monday for Social; 68 of 144 lines, 47%, by scripts/ui-identical.sh). Kit drag and drop (dnd-kit), create-on-click, the overflow popover and the visibility hook removed; cells are buttons that select a day (dots on phones, titled chips from 640px), a header with previous and next month links added, raw palette colours replaced by theme tokens, today applied after mount, copy from the catalogue." },
  { file: "src/components/ui/hover-card.tsx", source: "components/ui/hover-card.tsx", identical: 94, localChanges: "Copied for the Social Publish platform rings (hover, focus and tap popup with the character limit). Only change: the kit's data-open and data-closed state variants became data-[state=open] and data-[state=closed], because the Radix hover card sets data-state." },
  { file: "src/components/ui/attachment.tsx", source: "components/ui/attachment.tsx", identical: 95, localChanges: "Copied (95% is the independent reviewer's count of 80 of 84 lines against the public registry item, with 3 class-string differences; not reproduced here because the registry did not answer; against the founder's kit repo copy at 1631106 the file is 99%, only the header line added). Used for the Social Publish media strip cards (idle, uploading, processing, error and done states). The kit's shimmer, scroll-fade-x and scrollbar-none utility classes are not defined in Harvest and have no effect." },
  { file: "src/components/social/week-calendar.tsx", source: "app/dashboard/(auth)/apps/calendar/components/week-view.tsx", identical: 71, localChanges: "Social Publish week of posts (225 of 313 lines by scripts/ui-identical.sh against kit commit 1631106). Kept: the header row, hour column, per-day columns, event positioning and overlap grouping, the quarter-hour cells and the current-time line. Changed: the week starts on Monday (the planner API groups weeks that way); the all-day section is removed (posts have no all-day form); dnd-kit (DraggableEvent, DroppableCell) is replaced by native HTML drag-and-drop on a post button and on each quarter-hour cell, which report the drop to the planner; overlapping posts collapse into the first one plus a \"+N\" button with a Popover list (the kit shows side-by-side slivers); the block content is supplied by the planner." },
  { file: "src/hooks/use-current-time-indicator.ts", source: "app/dashboard/(auth)/apps/calendar/hooks/use-current-time-indicator.ts", identical: 88, localChanges: "Copied for the week view's current-time line; the week starts on Monday and the start and end hours are local constants." },
  { file: "src/components/ui/chart.tsx", source: "components/ui/chart.tsx", identical: 99, localChanges: "Copied for the Social Analytics charts (334 of 337 lines by scripts/ui-identical.sh against kit commit 1631106). The thrown error text became a catalogue-style code and the recharts default-colour selectors that name raw hex colours were removed (the source guard forbids them); charts set their own grid stroke from the border token." },
  { file: "src/components/social/analytics/count-up.tsx", source: "components/ui/custom/count-animation.tsx", identical: 57, localChanges: "Count-up number (8 of 14 lines). Takes a formatter, runs 0.4 s with ease-out and is the only file that imports motion; it is fetched on demand (React.lazy) while the entrance plays and never otherwise." },
  { file: "src/components/social/analytics/stat-card.tsx", source: "app/dashboard/(auth)/finance/components/kpi-cards.tsx", identical: 23, localChanges: "Summary card (14 of 60 lines): the Card, CardAction badge, large figure and bar sparkline of the kit's KPI card, rewritten around real readings, a status-badge delta, an explicit Unavailable value, a Partial marker and the entrance rules. The kit's sample data, buttons and other three cards are not used." },
  { file: "src/components/social/analytics/series-card.tsx", source: "app/dashboard/(auth)/sales/components/revenue-chart.tsx", identical: 16, localChanges: "Time series card (10 of 61 lines, mostly shared imports): the kit's titled card with the measure switch in CardAction, as an area chart with gaps for unavailable days, a compact axis, and a screen-reader table. The kit's sample series is not used." },
  ],
} as const;

/**
 * Files modelled on the same dashboard (the calendar for Events C14; pages/profile for the Communities C09b member profile screens),
 * written for Harvest with no kit code copied; the kit fixtures (contacts, transactions, release notes) are not used. Same repository,
 * commit and founder approval as `adminDashboardProvenance`. Each starts with: Layout and behaviour modelled on
 * bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied[ 19 Nov 2026]): <source>; code written for Harvest, no kit code copied.
 */
export const adminDashboardReferences = {
  repository: "bumbmatei-sys/admin-dashboard", commit: "1631106", tier: "premium",
  files: [
  { file: "src/components/communities/member-profile-view.tsx", source: "app/dashboard/(auth)/pages/profile/page.tsx, components/profile-card.tsx, components/latest-activity.tsx", localChanges: "Profile page: a two-column grid with the profile card (shared member summary, post and reply counts) and a latest-activity timeline of the member's posts and replies, with tabs for the viewer's own page. The kit's contact details, skills, connections, transaction table and download buttons are not used; counts and activity come from the existing forum data." },
  { file: "src/components/communities/member-profile-settings.tsx", source: "app/dashboard/(auth)/pages/profile/components/complete-your-profile.tsx", localChanges: "Settings card of rows that open the service owning each setting (account name, notification switches, member messages). The kit's progress checklist is not used." },
  { file: "src/components/settings/settings-nav.tsx", source: "app/dashboard/(auth)/pages/settings/components/sidebar-nav.tsx", localChanges: "Settings pop-up section list (founder-approved kit item, 20 Nov): icon rows with a muted active state, grouped You and Ministry, a scrollable tab row on phones, roving arrow-key focus. Buttons instead of route links (the sections are not routes). scripts/ui-identical.sh against the kit sidebar-nav.tsx: 4 of 43 lines (9%); no kit code copied." },
  { file: "src/components/settings/settings-panels.tsx", source: "app/dashboard/(auth)/pages/settings/account/page.tsx, app/dashboard/(auth)/pages/settings/notifications/page.tsx", localChanges: "Settings panels (founder-approved kit items, 20 Nov): profile form layout (account/page.tsx) and bordered link rows (notifications/page.tsx). Written for Harvest on its Field, Input and RadioGroup without react-hook-form or zod; real member-profile and account routes. scripts/ui-identical.sh: 4 of 149 (2%) and 6 of 149 (4%); no kit code copied." },
  { file: "src/components/social/option-rows.tsx", source: "app/dashboard/(auth)/pages/settings/notifications/page.tsx", localChanges: "The composer's option rows (first comment, auto repost, made with AI, link, TikTok consent) take the kit settings form's bordered switch row: title and a line about where it applies on the left, the switch on the right, details below when on. Written for Harvest on its Switch, Input and Textarea without react-hook-form or zod." },
  { file: "src/components/events/events-board.tsx", source: "app/dashboard/(auth)/apps/calendar/components/agenda-view.tsx", localChanges: "Upcoming list grouped under day headings, beside the month calendar and a list and calendar switch kept in the URL. The kit's agenda view is a client-side range of days; Harvest's list is server data." },
  ],
} as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
/** Returns human-readable problems with a record; an empty array means valid. */
export function validateKitRecord(record: KitItemRecord): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(record.item)) problems.push("item must be a registry name");
  if (record.tier !== "free" && record.tier !== "premium") problems.push("tier must be free or premium");
  for (const key of ["registryRetrieved", "installed", "approvedOn"] as const) if (!datePattern.test(record[key])) problems.push(`${key} must be YYYY-MM-DD`);
  if (!record.approvedBy.trim()) problems.push("approvedBy is required");
  if (!record.localChanges.trim()) problems.push("localChanges is required");
  if (record.files.length === 0) problems.push("at least one destination file is required");
  for (const file of record.files) if (file.startsWith("/") || file.includes("..")) problems.push(`file must be repository-relative: ${file}`);
  return problems;
}

const modelledHeader = /^\s*\/\*\*\s*Layout and behaviour modelled on bumbmatei-sys\/chat-app \(Shadcn UI Kit, premium, founder-supplied 19 Nov 2026\): (.+?); code written for Harvest, no kit code copied\./;
/** Returns the chat-app source a file is modelled on, or null. */
export function modelledHeaderSource(source: string): string | null { return modelledHeader.exec(source)?.[1] ?? null; }

const chatAppHeader = /^\s*\/\*\*\s*Derived from bumbmatei-sys\/chat-app \(Shadcn UI Kit, premium, founder-supplied 19 Nov 2026\): (.+?)\. Harvest changes:/;
/** Returns the chat-app source named by a file's leading header, or null. */
export function chatAppHeaderSource(source: string): string | null { return chatAppHeader.exec(source)?.[1] ?? null; }

// The header is the first comment of the file, starting with: Derived from Shadcn UI Kit item <name> (free|premium).
const headerPattern = /^\s*\/\*\*\s*Derived from Shadcn UI Kit item ([a-z][a-z0-9-]*) \((free|premium)\)/;
/** Returns the kit item named by a file's leading provenance header, or null when the file has none. */
export function kitHeaderItem(source: string): string | null {
  return headerPattern.exec(source)?.[1] ?? null;
}

const adminDerivedHeader = /^\s*\/\*\*\s*Derived from bumbmatei-sys\/admin-dashboard \(Shadcn UI Kit, premium, founder-supplied\): (.+?)\. Harvest changes:/i;
const adminModelledHeader = /^\s*\/\*\*\s*Layout and behaviour modelled on bumbmatei-sys\/admin-dashboard \(Shadcn UI Kit, premium, founder-supplied(?: 19 Nov 2026)?\): (.+?); code written for Harvest, no kit code copied\./i;
/** Reads a file's leading admin-dashboard provenance header in either form ("Derived from ..." or "Layout and behaviour modelled on ..."), or null when it has neither. */
export function adminDashboardHeader(source: string): { form: "derived" | "modelled"; source: string } | null {
  const derived = adminDerivedHeader.exec(source)?.[1];
  if (derived) return { form: "derived", source: derived };
  const modelled = adminModelledHeader.exec(source)?.[1];
  return modelled ? { form: "modelled", source: modelled } : null;
}
/** Returns the admin-dashboard source named by a file's leading header (either form), or null. */
export function adminDashboardHeaderSource(source: string): string | null { return adminDashboardHeader(source)?.source ?? null; }

/**
 * Files ported from the founder's own first Harvest version (private repository bumbmatei-sys/harvest-agent, read-only). Its code is the founder's, so it may
 * be ported; only layout, structure and the platform logo marks are taken, never its Firebase, auth or data plumbing. `similarity` is the share of the file's
 * non-blank lines (at least 12 characters) that are identical after trimming, which is low here because the marks are long single-line data in a
 * different file shape; `marks` counts the logo paths that are the same data as the source.
 */
export const harvestAgentPorts = {
  repository: "bumbmatei-sys/harvest-agent", approvedBy: "founder", approvedOn: "2026-11-20",
  files: [
    { file: "src/components/social/platform-logo.tsx", source: "src/components/admin/social/PlatformLogo.tsx", similarity: 2, marks: "7 of 20 marks are the source's paths (Facebook, Instagram, Threads, TikTok, YouTube, WordPress, Wix); 13 more from the same Simple Icons 16.36.0 release (CC0-1.0); LinkedIn, Slack, Google Business Profile, SMS and RCS use neutral marks", localChanges: "Ported and extended to every platform the provider layer lists; typed on Harvest's platform keys; labels from the shared label table; neutral fallbacks." },
  ],
  layoutReferences: [
    { file: "src/components/social/composer.tsx, composer-preview.tsx, destination-card.tsx", source: "SocialScheduler.tsx, PostPreview.tsx, MediaAttachments.tsx", note: "Layout and flow only: Post to circles with a dashed connect circle, one text card with media and toolbar inside, option rows, preview with an Each platform list. Code written for Harvest on its shared components and the kit." },
    { file: "src/components/social/planner.tsx, social-nav.tsx", source: "SocialScheduler.tsx (Queue, calendar), PageHeader.tsx, shell-nav.ts", note: "Layout and flow only: the Planner header with Compose, Calendar and Queue tabs, a three-column queue (Drafts, Scheduled by day, Sent), the week grid with a drafts aside, and the Social media sidebar group with Accounts under Settings." },
  ],
} as const;
