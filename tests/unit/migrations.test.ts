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
  expect(journal.entries[21].tag).toBe("0021_campaigns");
  expect(journal.entries[22].tag).toBe("0022_crm_imports");
  expect(journal.entries[23].tag).toBe("0023_crm_imports_policies_merge");
  expect(snapshots[21].id).toBe("0228b207-6f38-4b55-a8ce-3938525f2747");
  expect(Object.keys(snapshots[21].tables)).toHaveLength(30);
  expect(Object.keys(snapshots[22].tables)).toHaveLength(32);
  expect(snapshots[22].tables["public.campaigns"]).toBeDefined();
  expect(snapshots[22].tables["public.crm_imports"]).toBeDefined();
  expect(snapshots[22].tables["public.crm_import_rows"]).toBeDefined();
  expect(snapshots[23].tables).toEqual(snapshots[22].tables);
  // HC-02 Connect data foundation follows CRM-08 (0025) as 0026 and only adds tables.
  expect(journal.entries[26].tag).toBe("0026_hc02_connect_intake");
  const hc02Tables = ["public.privacy_notice_versions", "public.forms", "public.form_versions", "public.campaign_response_links", "public.campaign_responses", "public.campaign_response_contact_methods", "public.campaign_response_consents"];
  expect(Object.keys(snapshots[26].tables).sort()).toEqual([...Object.keys(snapshots[25].tables), ...hc02Tables].sort());
  for (const table of Object.keys(snapshots[25].tables)) expect(snapshots[26].tables[table], table).toEqual(snapshots[25].tables[table]);
  // HC-03 follows HC-02 (0026) as 0027: one new table (the code registry); only campaign_response_links changes.
  expect(journal.entries[27].tag).toBe("0027_hc03_connect_links");
  expect(Object.keys(snapshots[27].tables).sort()).toEqual([...Object.keys(snapshots[26].tables), "public.campaign_response_link_codes"].sort());
  for (const table of Object.keys(snapshots[26].tables)) if (table !== "public.campaign_response_links") expect(snapshots[27].tables[table], table).toEqual(snapshots[26].tables[table]);
  expect(journal.entries[28].tag).toBe("0028_hc05_connect_intake");
  expect(Object.keys(snapshots[28].tables).sort()).toEqual([...Object.keys(snapshots[27].tables), "public.connect_intake_receipts", "public.connect_intake_limits", "public.connect_intake_events"].sort());
  const links = snapshots[27].tables["public.campaign_response_links"];
  expect(Object.keys(links.columns)).toEqual(expect.arrayContaining(Object.keys(snapshots[26].tables["public.campaign_response_links"].columns)));
  expect(links.columns.short_code.notNull).toBe(true);
});
