/** Pure helpers for the shared DataTable shell. No data fetching and no domain knowledge. */
export type SortDirection = "ascending" | "descending" | "none";
export type TableLayout = "auto" | "table" | "cards";
export type SelectionState = "none" | "some" | "all";

/** Width, in CSS pixels, below which `layout="auto"` renders the stacked card list. */
export const CARD_LAYOUT_MAX_WIDTH = 767;

/** none -> ascending -> descending -> none. */
export function nextSortDirection(direction: SortDirection): SortDirection {
  return direction === "none" ? "ascending" : direction === "ascending" ? "descending" : "none";
}
export function resolveLayout(layout: TableLayout, narrow: boolean): "table" | "cards" {
  return layout === "auto" ? (narrow ? "cards" : "table") : layout === "cards" ? "cards" : "table";
}
/** Only rows that are on screen count, so a stale id from another page never changes the header checkbox. */
export function selectionState(rowIds: readonly string[], selected: readonly string[]): SelectionState {
  if (rowIds.length === 0) return "none";
  const set = new Set(selected);
  const count = rowIds.filter((id) => set.has(id)).length;
  return count === 0 ? "none" : count === rowIds.length ? "all" : "some";
}
export function toggleAll(rowIds: readonly string[], selected: readonly string[]): string[] {
  const outside = selected.filter((id) => !rowIds.includes(id));
  return selectionState(rowIds, selected) === "all" ? outside : [...outside, ...rowIds];
}
export function toggleRow(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}
export type CardRole = "title" | "meta" | "actions" | "hidden";
/** Splits columns into the parts of a card: one title, labelled meta rows, one actions area. */
export function cardParts<Column extends { id: string; card?: CardRole }>(columns: readonly Column[]): { title: Column | undefined; meta: Column[]; actions: Column | undefined } {
  const title = columns.find((column) => column.card === "title") ?? columns.find((column) => column.card !== "actions" && column.card !== "hidden");
  const actions = columns.find((column) => column.card === "actions");
  const meta = columns.filter((column) => column !== title && column !== actions && column.card !== "hidden");
  return { title, meta, actions };
}
