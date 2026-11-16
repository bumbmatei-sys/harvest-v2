/**
 * Provenance record for files derived from the Shadcn UI Kit (see docs/ui-sources.md, "Shadcn UI Kit provenance").
 * Rule: every kit-derived file starts with the header below AND is listed in `kitProvenance`.
 * Tests enforce both directions. Kit PR 1 adopts the four items below; the stock primitives they depend on are hand-written
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
