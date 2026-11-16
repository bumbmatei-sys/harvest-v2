/**
 * Provenance record for files derived from the Shadcn UI Kit (see docs/ui-sources.md, "Shadcn UI Kit provenance").
 * Rule: every kit-derived file starts with the header below AND is listed in `kitProvenance`.
 * The record starts empty: no kit item is adopted yet. Tests enforce both directions.
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

export const kitProvenance: readonly KitItemRecord[] = [];

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
