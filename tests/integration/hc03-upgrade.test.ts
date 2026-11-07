import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { migrationCount, testDatabase } from "../database";
import { listConnectLinks, resolveConnectLink, transitionConnectLink } from "../../src/server/connect-links";

// HC-03 upgrade: links written under 0026 (draft, published, disabled, archived) get a short code,
// lifecycle times and registry rows; only the published one resolves; the lifecycle then works.
it("upgrades 0026 links: short codes, lifecycle backfill, code registry, and the resolver", async () => {
  const tenant = "27272727-2727-4727-8727-272727272727", campaign = "38383838-3838-4838-8838-383838383838";
  const ids = { draft: "a1a1a1a1-0000-4000-8000-000000000001", published: "a1a1a1a1-0000-4000-8000-000000000002", disabled: "a1a1a1a1-0000-4000-8000-000000000003", archived: "a1a1a1a1-0000-4000-8000-000000000004" };
  const codes = { draft: "1".repeat(32), published: "2".repeat(32), disabled: "3".repeat(32), archived: "4".repeat(32) };
  const fixture = await testDatabase({ beforeHc03Migration: async (admin) => {
    expect((await admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(27);
    expect((await admin.query("select to_regclass('public.campaign_response_link_codes') is null as absent")).rows[0].absent).toBe(true);
    await admin.query("insert into users (id,name,email) values ('hc03-upgrade','Owner','hc03-upgrade@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'HC-03 upgrade','hc03-upgrade')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'hc03-upgrade','owner')", [tenant]);
    await admin.query(`insert into campaigns (tenant_id,id,owner_user_id,type,name,idempotency_key,fingerprint) values ($1,$2,'hc03-upgrade','conference','Existing campaign','existing',$3)`, [tenant, campaign, "b".repeat(64)]);
    for (const [state, id] of Object.entries(ids)) {
      await admin.query("insert into campaign_response_links (tenant_id,id,campaign_id,public_code,locale,created_by) values ($1,$2,$3,$4,'en','hc03-upgrade')", [tenant, id, campaign, codes[state as keyof typeof codes]]);
      if (state !== "draft") await admin.query("update campaign_response_links set status = $1 where id = $2", [state === "disabled" ? "published" : state, id]);
      if (state === "disabled") await admin.query("update campaign_response_links set status = 'disabled' where id = $1", [id]);
    }
  } });
  try {
    expect((await fixture.admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(migrationCount);
    const { rows: links } = await fixture.admin.query("select id, status, public_code, short_code, published_at, archived_at, code_generation from campaign_response_links order by id");
    expect(links).toHaveLength(4);
    for (const row of links) {
      expect(row.short_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
      expect(row.code_generation).toBe(1);
      expect(row.published_at !== null).toBe(row.status === "published" || row.status === "disabled");
      expect(row.archived_at !== null).toBe(row.status === "archived");
    }
    // Existing QR codes keep working (printed material survives the upgrade).
    expect(links.map((row) => row.public_code).sort()).toEqual(Object.values(codes).sort());
    expect(new Set(links.map((row) => row.short_code)).size).toBe(4);
    const { rows: registry } = await fixture.admin.query("select link_id, kind, code, retired_at from campaign_response_link_codes order by link_id, kind");
    expect(registry).toHaveLength(8);
    for (const row of registry) expect(row.retired_at !== null).toBe(row.link_id === ids.archived);
    expect((await fixture.admin.query("select relforcerowsecurity from pg_class where relname = 'campaign_response_link_codes'")).rows[0].relforcerowsecurity).toBe(true);
    const shortOf = (id: string) => links.find((row) => row.id === id).short_code as string;
    expect(await resolveConnectLink(fixture.db, "qr", codes.published)).toEqual({ locale: "en", title: null });
    expect(await resolveConnectLink(fixture.db, "short", shortOf(ids.published))).toEqual({ locale: "en", title: null });
    for (const state of ["draft", "disabled", "archived"] as const) {
      expect(await resolveConnectLink(fixture.db, "qr", codes[state])).toBeUndefined();
      expect(await resolveConnectLink(fixture.db, "short", shortOf(ids[state]))).toBeUndefined();
    }
    // The upgraded links use the new lifecycle.
    expect((await transitionConnectLink(fixture.db, "hc03-upgrade", tenant, campaign, ids.disabled, { action: "publish" })).outcome).toBe("published");
    expect(await resolveConnectLink(fixture.db, "qr", codes.disabled)).toBeDefined();
    expect((await transitionConnectLink(fixture.db, "hc03-upgrade", tenant, campaign, ids.published, { action: "rotate", expectedCode: codes.published })).outcome).toBe("rotated");
    expect(await resolveConnectLink(fixture.db, "qr", codes.published)).toBeUndefined();
    expect((await listConnectLinks(fixture.db, "hc03-upgrade", tenant, campaign)).links).toHaveLength(4);
  } finally { await fixture.close(); }
});
