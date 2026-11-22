import { describe, expect, it } from "vitest";
import { byteSize, driveEntry, driveSource, groupStats, harvestEntry, harvestFolderEntry, harvestGroupOf, harvestSource, glyphOf, matchesSearch, orderFolders, orderListing, orderRecent, safeUrl, shownSources, showMarks, sourceNames, toggleSource, type HarvestFile } from "../../src/lib/files-screen";

const google = driveSource({ id: "g", platform: "google" }), onedrive = driveSource({ id: "m", platform: "microsoft" });
const sources = [harvestSource, google, onedrive];
const upload = (id: string, name: string, mime: string, size: number, createdAt: string): HarvestFile => ({ id, name, mime, size, status: "ready", visibility: "private", createdAt, canConfirm: false, publicUrl: null });

describe("source model", () => {
  it("names sources in code, not the catalogue", () => {
    expect(sourceNames).toEqual({ harvest: "Harvest", google: "Google Drive", microsoft: "OneDrive" });
    expect(google).toEqual({ id: "g", kind: "google", name: "Google Drive" });
  });
  it("groups Harvest uploads by type", () => {
    expect(["image/png", "image/webp", "application/pdf", "text/plain"].map(harvestGroupOf)).toEqual(["images", "images", "documents", "text"]);
    const stats = groupStats([upload("1", "a.png", "image/png", 10, "2026-01-01"), upload("2", "b.png", "image/png", 5, "2026-01-02"), upload("3", "c.pdf", "application/pdf", 7, "2026-01-03")]);
    expect(stats).toEqual({ images: { count: 2, size: 15 }, documents: { count: 1, size: 7 }, text: { count: 0, size: 0 } });
  });
  it("picks the glyph from kind and type", () => {
    expect([glyphOf({ kind: "folder", mime: null, name: "x" }), glyphOf({ kind: "file", mime: "image/jpeg", name: "x" }), glyphOf({ kind: "file", mime: "application/pdf", name: "x" }), glyphOf({ kind: "file", mime: "text/plain", name: "x" }), glyphOf({ kind: "file", mime: null, name: "x" })]).toEqual(["folder", "image", "pdf", "text", "file"]);
  });
  it("formats sizes in binary units", () => {
    expect(byteSize(0)).toEqual({ value: 0, unit: "B" });
    expect(byteSize(2048)).toEqual({ value: 2, unit: "KiB" });
    expect(byteSize(5 * 1024 ** 2)).toEqual({ value: 5, unit: "MiB" });
    expect(byteSize(3 * 1024 ** 3).unit).toBe("GiB");
  });
});

describe("source filter", () => {
  const ids = sources.map((source) => source.id);
  it("treats an empty selection as All and shows every source", () => {
    expect(shownSources(sources, new Set()).map((source) => source.id)).toEqual(ids);
  });
  it("keeps source order for any combination and drops sources that are no longer connected", () => {
    expect(shownSources(sources, new Set(["m", "harvest"])).map((source) => source.id)).toEqual(["harvest", "m"]);
    expect(shownSources(sources, new Set(["gone"])).map((source) => source.id)).toEqual(ids);
  });
  it("toggles one source, a combination, and falls back to All when every source is picked", () => {
    const one = toggleSource(new Set(), "g", ids);
    expect([...one]).toEqual(["g"]);
    const two = toggleSource(one, "m", ids);
    expect([...two].sort()).toEqual(["g", "m"]);
    expect(toggleSource(two, "harvest", ids).size).toBe(0);
    expect(toggleSource(one, "g", ids).size).toBe(0);
  });
  it("marks icons only while more than one source is shown", () => {
    expect(showMarks([harvestSource])).toBe(false);
    expect(showMarks([google])).toBe(false);
    expect(showMarks([harvestSource, google])).toBe(true);
  });
});

describe("merge and sort rules", () => {
  const photosG = driveEntry(google, { ref: "p", name: "Photos", kind: "folder" });
  const photosM = driveEntry(onedrive, { ref: "p", name: "Photos", kind: "folder" });
  const sermons = driveEntry(google, { ref: "s", name: "Sermons", kind: "folder" });
  const images = harvestFolderEntry("images", "Images", 2, 100);
  it("never merges same-named folders from different sources", () => {
    const folders = orderFolders([photosM, sermons, images, photosG], sources);
    expect(folders.map((folder) => `${folder.source.id}:${folder.name}`)).toEqual(["harvest:Images", "g:Photos", "g:Sermons", "m:Photos"]);
    expect(new Set(folders.map((folder) => folder.key)).size).toBe(4);
  });
  it("orders recent files newest first, then undated files in source order keeping each provider's order", () => {
    const old = harvestEntry(upload("1", "old.txt", "text/plain", 1, "2026-01-01T00:00:00Z"));
    const fresh = harvestEntry(upload("2", "fresh.txt", "text/plain", 1, "2026-03-01T00:00:00Z"));
    const m1 = driveEntry(onedrive, { ref: "1", name: "z.pdf", kind: "file" }), m2 = driveEntry(onedrive, { ref: "2", name: "a.pdf", kind: "file" }), g1 = driveEntry(google, { ref: "1", name: "g.txt", kind: "file" });
    expect(orderRecent([m1, g1, old, m2, fresh], sources).map((entry) => entry.name)).toEqual(["fresh.txt", "old.txt", "g.txt", "z.pdf", "a.pdf"]);
    expect(orderRecent([photosG, fresh], sources).map((entry) => entry.name)).toEqual(["fresh.txt"]);
  });
  it("lists folders first, then files", () => {
    const file = driveEntry(google, { ref: "f", name: "a.txt", kind: "file" });
    expect(orderListing([file, photosG], sources).map((entry) => entry.name)).toEqual(["Photos", "a.txt"]);
  });
  it("searches names without case", () => {
    expect(matchesSearch("Photos", "PHO")).toBe(true);
    expect(matchesSearch("Photos", "xyz")).toBe(false);
  });
});

describe("provider links", () => {
  it("opens only http and https links", () => {
    expect(safeUrl("https://example.test/a")).toBe("https://example.test/a");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });
});
