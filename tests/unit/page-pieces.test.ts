import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { cardParts, nextSortDirection, resolveLayout, selectionState, toggleAll, toggleRow } from "../../src/lib/data-table";
import { defineStatusTones, statusTones } from "../../src/lib/status-tone";
import { runConfirm } from "../../src/lib/confirm-flow";
import { DataTable, type DataTableColumn, type DataTableRow } from "../../src/components/data-table";
import { EmptyState } from "../../src/components/empty-state";
import { StatusBadge } from "../../src/components/status-badge";
import { ConfirmDialog } from "../../src/components/confirm-dialog";

const render = (element: ReactElement) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, children: element }));

describe("data table helpers", () => {
  it("cycles sort direction none, ascending, descending, none", () => {
    expect(nextSortDirection("none")).toBe("ascending");
    expect(nextSortDirection("ascending")).toBe("descending");
    expect(nextSortDirection("descending")).toBe("none");
  });
  it("resolves the layout: auto follows the viewport, the others are fixed", () => {
    expect(resolveLayout("auto", true)).toBe("cards");
    expect(resolveLayout("auto", false)).toBe("table");
    expect(resolveLayout("table", true)).toBe("table");
    expect(resolveLayout("cards", false)).toBe("cards");
  });
  it("derives the header checkbox state from visible rows only", () => {
    expect(selectionState([], ["x"])).toBe("none");
    expect(selectionState(["a", "b"], [])).toBe("none");
    expect(selectionState(["a", "b"], ["a"])).toBe("some");
    expect(selectionState(["a", "b"], ["a", "b", "elsewhere"])).toBe("all");
    expect(selectionState(["a", "b"], ["elsewhere"])).toBe("none");
  });
  it("toggles one row or all visible rows without losing selections outside the page", () => {
    expect(toggleRow(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleRow(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleAll(["a", "b"], ["z"])).toEqual(["z", "a", "b"]);
    expect(toggleAll(["a", "b"], ["z", "a", "b"])).toEqual(["z"]);
    expect(toggleAll(["a", "b"], ["a"])).toEqual(["a", "b"]);
  });
  it("splits columns into a card: one title, labelled meta lines, one actions area", () => {
    const columns = [{ id: "name" }, { id: "role" }, { id: "email", card: "hidden" as const }, { id: "go", card: "actions" as const }];
    const parts = cardParts(columns);
    expect(parts.title?.id).toBe("name");
    expect(parts.meta.map((column) => column.id)).toEqual(["role"]);
    expect(parts.actions?.id).toBe("go");
    expect(cardParts([{ id: "a", card: "meta" as const }, { id: "b", card: "title" as const }]).title?.id).toBe("b");
  });
});

describe("status tones", () => {
  const tone = defineStatusTones({ published: "success", draft: "neutral", broken: "danger" });
  it("maps the caller's statuses and falls back to neutral for unknown or inherited keys", () => {
    expect(tone("published")).toBe("success");
    expect(tone("broken")).toBe("danger");
    expect(tone("something-new")).toBe("neutral");
    expect(tone("toString")).toBe("neutral");
  });
  it("lists the six tones", () => { expect([...statusTones]).toEqual(["neutral", "success", "warning", "danger", "info", "pending"]); });
});

describe("StatusBadge", () => {
  it("renders every tone with token classes only, and always the visible label", () => {
    for (const tone of statusTones) {
      const html = render(h(StatusBadge, { tone, label: "Label" }));
      expect(html).toContain(`data-tone="${tone}"`);
      expect(html).toContain("Label");
      expect(html).not.toMatch(/(?:bg|text)-(?:red|green|amber|yellow|blue|gray|slate)-\d/);
      expect(html).not.toContain("status-dot");
    }
    expect(render(h(StatusBadge, { tone: "success", label: "Ready" }))).toContain("bg-success-tint text-success");
    expect(render(h(StatusBadge, { tone: "danger", label: "Failed" }))).toContain("text-destructive");
  });
  it("shows an optional decorative dot", () => {
    const html = render(h(StatusBadge, { tone: "warning", label: "Late", dot: true }));
    expect(html).toContain('data-slot="status-dot"');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("EmptyState", () => {
  it("renders icon, title, description and one primary plus one secondary action", () => {
    const html = render(h(EmptyState, { title: "Nothing yet", description: "Add one.", action: h("button", null, "Add"), secondary: h("button", null, "Import") }));
    expect(html).toContain("Nothing yet"); expect(html).toContain("Add one."); expect(html).toContain("Add"); expect(html).toContain("Import");
    expect(html).toContain('data-size="standard"');
  });
  it("omits the description and the action area when they are not given", () => {
    const html = render(h(EmptyState, { title: "No match", size: "compact" }));
    expect(html).toContain('data-size="compact"');
    expect(html).not.toContain("empty-description");
    expect(html).not.toContain("empty-content");
  });
  it("exposes the title as a heading only when asked", () => {
    expect(render(h(EmptyState, { title: "T", headingLevel: 2 }))).toContain('role="heading" aria-level="2"');
    expect(render(h(EmptyState, { title: "T" }))).not.toContain('role="heading"');
  });
});

const columns: DataTableColumn[] = [
  { id: "name", header: "Name", card: "title", sort: { direction: "ascending", href: "?sort=name" } },
  { id: "status", header: "Status", sort: { direction: "none", onSort: () => undefined } },
  { id: "role", header: "Role", showFrom: "@md" },
  { id: "actions", header: "Actions", srOnlyHeader: true, align: "end", card: "actions" },
];
const rows: DataTableRow[] = [
  { id: "a", label: "Ada", cells: { name: "Ada", status: "Open", role: "Lead", actions: h("button", null, "Open Ada") } },
  { id: "b", label: "Ben", cells: { name: "Ben", status: "Done", role: "Member", actions: h("button", null, "Open Ben") } },
];
const table = (props: Partial<Parameters<typeof DataTable>[0]> = {}) => render(h(DataTable, { label: "People", columns, rows, ...props }));

describe("DataTable table layout", () => {
  it("is a named table with aria-sort on sortable headers and an sr-only actions header", () => {
    const html = table();
    expect(html).toContain('<table');
    expect(html).toContain('aria-label="People"');
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('href="?sort=name"');
    expect(html).toContain('<span class="sr-only">Actions</span>');
    expect(html).toContain("hidden @md:table-cell");
    expect(html).not.toContain("data-slot=\"data-table-cards\"");
  });
  it("adds select-all and per-row checkboxes with names, and a bulk bar only while rows are selected", () => {
    const none = table({ selection: { selected: [], onChange: () => undefined }, bulk: { label: "Selected people", actions: h("button", null, "Archive") } });
    expect(none).toContain('aria-label="Select all"'); expect(none).toContain('aria-label="Select Ada"'); expect(none).not.toContain('data-slot="data-table-bulk"');
    const some = table({ selection: { selected: ["a"], onChange: () => undefined }, bulk: { label: "Selected people", actions: h("button", null, "Archive") } });
    expect(some).toContain('data-slot="data-table-bulk"'); expect(some).toContain('aria-label="Selected people"'); expect(some).toContain("1 selected");
    expect(some).toContain('data-state="selected"'); expect(some).toContain('aria-checked="mixed"');
    const all = table({ selection: { selected: ["a", "b"], onChange: () => undefined } });
    expect(all).toContain('aria-checked="true"'); expect(all).not.toContain('aria-checked="mixed"');
  });
  it("renders tabs with counts, a named tablist and one tab panel", () => {
    const html = table({ tabs: { label: "Status", value: "all", onValueChange: () => undefined, items: [{ value: "all", label: "All", count: 2 }, { value: "open", label: "Open", count: 1 }] } });
    expect(html).toContain('role="tablist"'); expect(html).toContain('aria-label="Status"');
    expect(html).toContain('aria-selected="true"'); expect(html).toContain('role="tabpanel"');
    expect(html).toContain(">2<"); expect(html).toContain(">1<");
  });
  it("renders toolbar slots, the pagination slot and a visible note", () => {
    const html = table({ toolbar: { search: h("input", { "aria-label": "Search" }), filters: h("button", null, "Filter"), actions: h("button", null, "Export") }, pagination: h("nav", null, "Pages"), note: "Showing 2" });
    for (const text of ["Search", "Filter", "Export", "Pages", "Showing 2"]) expect(html).toContain(text);
  });
  it("shows the empty, loading and error slots instead of the rows, and no rows in those states", () => {
    const empty = table({ rows: [], empty: h("p", null, "Nothing here") });
    expect(empty).toContain("Nothing here"); expect(empty).not.toContain("<table");
    const loading = table({ state: "loading", loadingLabel: "Loading people" });
    expect(loading).toContain('role="status"'); expect(loading).toContain('aria-label="Loading people"'); expect(loading).not.toContain("Ada");
    const failed = table({ state: "error", error: h("p", { role: "alert" }, "Could not load") });
    expect(failed).toContain("Could not load"); expect(failed).not.toContain("Ada");
    expect(table({ state: "loading" })).toContain('aria-label="Loading"');
  });
});

describe("DataTable card layout", () => {
  it("renders the same data as a labelled list with the title, meta lines and a 44px actions area", () => {
    const html = table({ layout: "cards" });
    expect(html).not.toContain("<table");
    expect(html).toContain('<ul aria-label="People"');
    expect(html).toContain('data-slot="data-table-card"');
    for (const text of ["Ada", "Ben", "Open Ada", "Open Ben"]) expect(html).toContain(text);
    expect(html).toContain("<dt");
    for (const label of ["Status", "Role"]) expect(html).toContain(`>${label}</dt>`);
    expect(html).not.toContain(">Name</dt>"); expect(html).not.toContain(">Actions</dt>");
    expect(html).toContain("min-h-11");
  });
  it("offers sorting through a Sort menu because the column headers are gone", () => {
    expect(table({ layout: "cards" })).toContain(">Sort<");
    expect(table({ layout: "cards", rows: [] })).not.toContain(">Sort<");
    expect(table({ layout: "table" })).not.toContain(">Sort<");
  });
  it("keeps selection in the card layout", () => {
    const html = table({ layout: "cards", selection: { selected: ["b"], onChange: () => undefined } });
    expect(html).toContain('aria-label="Select all"'); expect(html).toContain('aria-label="Select Ben"'); expect(html).toContain('data-state="selected"');
  });
});

describe("ConfirmDialog", () => {
  it("renders only its trigger while closed, and nothing from the dialog", () => {
    const html = render(h(ConfirmDialog, { trigger: h("button", null, "Delete"), title: "Delete?", confirmLabel: "Yes", cancelLabel: "No", onConfirm: () => undefined }));
    expect(html).toContain("Delete"); expect(html).not.toContain("Delete?"); expect(html).toContain('aria-haspopup="dialog"');
  });
});

describe("confirm flow", () => {
  it("treats nothing as success", async () => { expect(await runConfirm(() => undefined, "fallback")).toEqual({ ok: true }); expect(await runConfirm(async () => undefined, "fallback")).toEqual({ ok: true }); });
  it("treats a returned message as a failure that keeps the dialog open", async () => { expect(await runConfirm(async () => "No permission", "fallback")).toEqual({ ok: false, message: "No permission" }); });
  it("treats an empty message as success", async () => { expect(await runConfirm(() => "", "fallback")).toEqual({ ok: true }); });
  it("turns a thrown error, sync or async, into the fallback message", async () => {
    expect(await runConfirm(() => { throw new Error("boom"); }, "fallback")).toEqual({ ok: false, message: "fallback" });
    expect(await runConfirm(async () => { throw new Error("boom"); }, "fallback")).toEqual({ ok: false, message: "fallback" });
  });
  it("waits for the handler", async () => {
    let finished = false;
    const pending = runConfirm(() => new Promise<void>((resolve) => setTimeout(() => { finished = true; resolve(); }, 5)), "fallback");
    expect(finished).toBe(false); await pending; expect(finished).toBe(true);
  });
});
