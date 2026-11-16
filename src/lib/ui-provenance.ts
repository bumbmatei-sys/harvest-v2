/**
 * Provenance record for files derived from the Shadcn UI Kit (see docs/ui-sources.md, "Shadcn UI Kit provenance").
 * Rule: every kit-derived file starts with the header below AND is listed in `kitProvenance`.
 * Tests enforce both directions. Kit PR 1 adopts four items, Kit PR 2 two premium items and Kit PR 3 four (two premium, two free) and Kit PR 4 four (two premium, two free) and Kit PR 5 three (premium) as references; the stock primitives they depend on are hand-written
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
  { ...approved, item: "tables14", tier: "premium", files: ["src/components/data-table.tsx"],
    localChanges: "Visual reference only; no kit code was copied and TanStack Table is not used (the kit item depends on it; no new dependency is approved). Harvest's DataTable is a presentational shell on the existing Table, Tabs, Checkbox, Skeleton and DropdownMenu primitives: toolbar slots, status tabs with counts, sortable headers (aria-sort), optional row selection with a bulk bar, loading, empty and error slots, a pagination slot and a stacked card list below 768px. The kit's demo data, CSV export, assignee and billing filters and the card header are not used. Not chosen: tables5, tables7." },
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
];

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
