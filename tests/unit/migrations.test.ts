import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("keeps a single snapshot chain and an ordered migration journal (reserved numbers may be skipped)", async () => {
  const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
  const journal = await read("drizzle/meta/_journal.json");
  const snapshots = await Promise.all(journal.entries.map((entry: { idx: number }) => read(`drizzle/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`)));
  expect(new Set(snapshots.map((snapshot) => snapshot.id)).size).toBe(snapshots.length);
  expect(new Set(snapshots.map((snapshot) => snapshot.prevId)).size).toBe(snapshots.length);
  for (const [index, entry] of journal.entries.entries()) {
    expect(entry.idx).toBeGreaterThan(index > 0 ? journal.entries[index - 1].idx : -1);
    if (index > 0) {
      expect(entry.when).toBeGreaterThan(journal.entries[index - 1].when);
      expect(snapshots[index].prevId).toBe(snapshots[index - 1].id);
      const previousTables = Object.keys(snapshots[index - 1].tables);
      expect(Object.keys(snapshots[index].tables), `snapshot ${entry.idx} must retain every table from its predecessor`)
        .toEqual(expect.arrayContaining(previousTables));
    }
  }
  expect(snapshots[3].id).toMatch(/^3eb73893/);
  expect(journal.entries[4].tag).toBe("0004_files");
  // CW-01 campaigns migration follows CRM-05 (0020) as 0021.
  expect(journal.entries.find((entry: { tag: string }) => entry.tag === "0021_campaigns")?.idx).toBe(21);
});
