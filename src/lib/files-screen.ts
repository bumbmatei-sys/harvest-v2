import type { DriveItem } from "@/lib/office/files";

/**
 * Pure model of the unified Files screen: three sources (Harvest's own uploads, Google Drive, OneDrive), their entries, the source filter and the merge and sort
 * rules. Product names live here and in the logo registry, never in the message catalogue.
 *
 * Merge rules (also in docs/acceptance/files-screen.md):
 *  - Entries from different sources are never merged: a folder or file with the same name in two sources stays two entries, each with its own key.
 *  - Folders are ordered by source (Harvest first, then the connected drives in connection order) and by name inside a source.
 *  - Recent files are ordered newest first among entries that carry a date (only Harvest uploads do); entries without a date follow, in source order, each keeping
 *    the order the provider returned.
 *  - Inside a folder or a search, folders come first, then files in the source's own order.
 */
export type SourceKind = "harvest" | "google" | "microsoft";
export type Source = { id: string; kind: SourceKind; name: string };
export const sourceNames: Record<SourceKind, string> = { harvest: "Harvest", google: "Google Drive", microsoft: "OneDrive" };
export const harvestSource: Source = { id: "harvest", kind: "harvest", name: sourceNames.harvest };
export const driveSource = (connection: { id: string; platform: "google" | "microsoft" }): Source => ({ id: connection.id, kind: connection.platform, name: sourceNames[connection.platform] });

/** A Harvest upload as the Files page lists it (scan status and visibility are the existing server rules). */
export type HarvestFile = { id: string; name: string; mime: string; size: number; status: string; visibility: string; createdAt: string | Date; canConfirm: boolean; publicUrl: string | null };
export type HarvestGroup = "images" | "documents" | "text";
/** Harvest keeps uploads flat. The folder cards group them by type (derived from the file type, not stored folders). */
export const harvestGroups: readonly HarvestGroup[] = ["images", "documents", "text"];
export const harvestGroupOf = (mime: string): HarvestGroup => mime.startsWith("image/") ? "images" : mime === "application/pdf" ? "documents" : "text";

export type EntryKind = "file" | "folder";
export type FileEntry = {
  key: string; source: Source; ref: string; name: string; kind: EntryKind; mime: string | null; size: number | null; addedAt: string | null;
  harvest?: HarvestFile; group?: HarvestGroup;
};

export const harvestEntry = (file: HarvestFile, source: Source = harvestSource): FileEntry => ({
  key: `${source.id}:${file.id}`, source, ref: file.id, name: file.name, kind: "file", mime: file.mime, size: file.size,
  addedAt: new Date(file.createdAt).toISOString(), harvest: file, group: harvestGroupOf(file.mime),
});
export const driveEntry = (source: Source, item: DriveItem): FileEntry => ({
  key: `${source.id}:${item.ref}`, source, ref: item.ref, name: item.name, kind: item.kind === "folder" ? "folder" : "file",
  mime: item.mimeType ?? null, size: item.size ?? null, addedAt: null,
});
/** A derived Harvest folder card. */
export const harvestFolderEntry = (group: HarvestGroup, name: string, count: number, size: number, source: Source = harvestSource): FileEntry & { count: number } => ({
  key: `${source.id}:group:${group}`, source, ref: group, name, kind: "folder", mime: null, size, addedAt: null, group, count,
});

export function groupStats(files: readonly HarvestFile[]) {
  const stats: Record<HarvestGroup, { count: number; size: number }> = { images: { count: 0, size: 0 }, documents: { count: 0, size: 0 }, text: { count: 0, size: 0 } };
  for (const file of files) { const group = stats[harvestGroupOf(file.mime)]; group.count += 1; group.size += file.size; }
  return stats;
}
export const totalBytes = (files: readonly HarvestFile[]) => files.reduce((sum, file) => sum + file.size, 0);

/** The unit and value to show for a byte count (binary units, as the existing list does). */
export function byteSize(bytes: number): { value: number; unit: "B" | "KiB" | "MiB" | "GiB" } {
  if (bytes < 1024) return { value: bytes, unit: "B" };
  if (bytes < 1024 ** 2) return { value: bytes / 1024, unit: "KiB" };
  if (bytes < 1024 ** 3) return { value: bytes / 1024 ** 2, unit: "MiB" };
  return { value: bytes / 1024 ** 3, unit: "GiB" };
}

/** Source filter. An empty selection means All. Selecting every source is the same as All. */
export type Selection = ReadonlySet<string>;
export function toggleSource(selection: Selection, id: string, all: readonly string[]): Selection {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next.size === 0 || all.every((source) => next.has(source)) ? new Set() : next;
}
/** Sources to show, in source order; a selection that no longer names a connected source falls back to All. */
export function shownSources(all: readonly Source[], selection: Selection): Source[] {
  const picked = all.filter((source) => selection.has(source.id));
  return picked.length > 0 ? picked : [...all];
}
/** A mark sits on each icon only while more than one source is shown. */
export const showMarks = (shown: readonly Source[]) => shown.length > 1;

const byName = (a: FileEntry, b: FileEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
const sourceRank = (sources: readonly Source[]) => (entry: FileEntry) => Math.max(0, sources.findIndex((source) => source.id === entry.source.id));

/** Folders ordered by source, then name. Same-named folders from different sources stay separate. */
export function orderFolders(entries: readonly FileEntry[], sources: readonly Source[]): FileEntry[] {
  const rank = sourceRank(sources);
  return entries.filter((entry) => entry.kind === "folder").sort((a, b) => rank(a) - rank(b) || byName(a, b));
}
/** Files newest first, then undated files in source order (stable, so each provider's own order is kept). */
export function orderRecent(entries: readonly FileEntry[], sources: readonly Source[]): FileEntry[] {
  const rank = sourceRank(sources);
  const files = entries.filter((entry) => entry.kind === "file");
  const dated = files.filter((entry) => entry.addedAt).sort((a, b) => Date.parse(b.addedAt!) - Date.parse(a.addedAt!));
  const undated = files.filter((entry) => !entry.addedAt).map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index).map((row) => row.entry);
  return [...dated, ...undated];
}
/** Folders first (by source, then name), then files as {@link orderRecent} does. */
export const orderListing = (entries: readonly FileEntry[], sources: readonly Source[]): FileEntry[] => [...orderFolders(entries, sources), ...orderRecent(entries, sources)];

export const matchesSearch = (name: string, query: string) => name.toLowerCase().includes(query.toLowerCase());

export type Glyph = "folder" | "image" | "pdf" | "text" | "file";
export function glyphOf(entry: Pick<FileEntry, "kind" | "mime" | "name">): Glyph {
  if (entry.kind === "folder") return "folder";
  const mime = entry.mime ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  return "file";
}
/** Only http and https links are ever opened from provider data. */
export const safeUrl = (value: string | null | undefined) => { try { const url = new URL(value ?? ""); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; } };
