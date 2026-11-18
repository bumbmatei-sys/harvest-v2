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
 * Layout references where no kit code was copied and the file carries no kit header (so they are not in `kitProvenance`).
 * Communities C11b chat: exception to the use-kit rule approved by the founder on 18 November 2026 for this screen. Composed from
 * Harvest shared components; bubble reimplemented as a small component. DMs, profile and events adopt the real kit blocks from the start.
 */
export const kitLayoutReferences = [
  { item: "chat-ui10", tier: "premium", files: ["src/components/communities/chat/chat-layout.tsx", "src/components/communities/chat/chat-composer.tsx", "src/components/communities/chat/message-pane.tsx", "src/components/communities/chat/chat-message.tsx", "src/components/communities/chat/channel-sheet.tsx"] },
  { item: "chat-ui4", tier: "premium", files: ["src/components/communities/chat/channel-list.tsx"] },
  { item: "bubble1", tier: "free", files: ["src/components/ui/bubble.tsx"] },
] as const;

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

// The header is the first comment of the file, starting with: Derived from Shadcn UI Kit item <name> (free|premium).
const headerPattern = /^\s*\/\*\*\s*Derived from Shadcn UI Kit item ([a-z][a-z0-9-]*) \((free|premium)\)/;
/** Returns the kit item named by a file's leading provenance header, or null when the file has none. */
export function kitHeaderItem(source: string): string | null {
  return headerPattern.exec(source)?.[1] ?? null;
}
