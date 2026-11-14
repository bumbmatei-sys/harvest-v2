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
  expect(journal.entries[29].tag).toBe("0029_hc07_personal_account_claims");
  expect(Object.keys(snapshots[29].tables).sort()).toEqual([...Object.keys(snapshots[28].tables),"public.connect_invitations","public.connect_invitation_flows","public.response_account_claims"].sort());
  for(const table of Object.keys(snapshots[28].tables))expect(snapshots[29].tables[table],table).toEqual(snapshots[28].tables[table]);
  const links = snapshots[27].tables["public.campaign_response_links"];
  expect(Object.keys(links.columns)).toEqual(expect.arrayContaining(Object.keys(snapshots[26].tables["public.campaign_response_links"].columns)));
  expect(links.columns.short_code.notNull).toBe(true);
  // PR B: 0033 adds only the nullable ministry audience to workspaces.
  const audienceIndex = journal.entries.findIndex((entry: { tag: string }) => entry.tag === "0033_workspace_audience");
  expect(audienceIndex).toBeGreaterThan(0);
  const [before, after] = [snapshots[audienceIndex - 1], snapshots[audienceIndex]];
  expect(Object.keys(after.tables).sort()).toEqual(Object.keys(before.tables).sort());
  for (const table of Object.keys(before.tables)) if (table !== "public.workspaces") expect(after.tables[table], table).toEqual(before.tables[table]);
  expect(after.tables["public.workspaces"].columns.audience).toMatchObject({ type: "text", notNull: false });
  expect(Object.keys(after.tables["public.workspaces"].checkConstraints)).toContain("workspace_audience");
  // HC-08: 0034 adds only the owner-only user_profiles table.
  const profilesIndex = journal.entries.findIndex((entry: { tag: string }) => entry.tag === "0034_user_profiles");
  expect(profilesIndex).toBeGreaterThan(0);
  const profilesNew = Object.keys(snapshots[profilesIndex].tables).filter((name) => !(name in snapshots[profilesIndex - 1].tables));
  expect(profilesNew).toEqual(["public.user_profiles"]);
  for (const table of Object.keys(snapshots[profilesIndex - 1].tables)) expect(snapshots[profilesIndex].tables[table], table).toEqual(snapshots[profilesIndex - 1].tables[table]);
  // ADR 0013 (C02/C03): 0035 adds the three community tables and only widens the workspace audience check.
  const communitiesIndex = journal.entries.findIndex((entry: { tag: string }) => entry.tag === "0035_communities");
  expect(communitiesIndex).toBeGreaterThan(0);
  const [cBefore, cAfter] = [snapshots[communitiesIndex - 1], snapshots[communitiesIndex]];
  expect(Object.keys(cAfter.tables).filter((name) => !(name in cBefore.tables)).sort()).toEqual(["public.communities", "public.community_memberships", "public.entitlements"]);
  for (const table of Object.keys(cBefore.tables)) if (table !== "public.workspaces") expect(cAfter.tables[table], table).toEqual(cBefore.tables[table]);
  expect(cAfter.tables["public.workspaces"].checkConstraints.workspace_audience.value).toContain("'creator'");
  // Social provider integration layer: 0049 (0047/0048 are reserved by other open work) adds exactly three tables and changes none.
  const socialIndex = journal.entries.findIndex((entry: { tag: string }) => entry.tag === "0049_social_integration");
  expect(socialIndex).toBeGreaterThan(0);
  expect(journal.entries[socialIndex].idx).toBe(49);
  const [sBefore, sAfter] = [snapshots[socialIndex - 1], snapshots[socialIndex]];
  expect(Object.keys(sAfter.tables).filter((name) => !(name in sBefore.tables)).sort()).toEqual(["public.social_connections", "public.social_posts", "public.social_webhook_events"]);
  for (const table of Object.keys(sBefore.tables)) expect(sAfter.tables[table], table).toEqual(sBefore.tables[table]);
});
