import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionInput, decodeCursor, encodeCursor, materialHash, publicSummary, reportInput, searchInput } from "../../src/lib/discover";
import { parseSearch } from "../../src/server/discover/public";
import { DISCOVER_SERVER_ENABLED, defaultDiscoverDeps } from "../../src/server/discover/registry";

const base = { type: "course" as const, name: "Bible basics", summary: "Learn", category: "bible_study", language: "en", free: true, host: "Grace", audience: "church" };
describe("discover rules", () => {
  it("hashes only the public fields a reviewer approves", () => {
    expect(materialHash(base)).toBe(materialHash({ ...base }));
    for (const change of [{ name: "Other" }, { summary: "More" }, { category: "prayer" }, { language: "es" }, { free: false }, { host: "Other host" }, { audience: "creator" }, { type: "product" as const }])
      expect(materialHash({ ...base, ...change })).not.toBe(materialHash(base));
    expect(materialHash({ ...base, summary: null })).toBe(materialHash({ ...base, summary: "" }));
  });
  it("bounds the cursor and refuses anything but an exact page offset", () => {
    expect(decodeCursor(undefined)).toBe(0); expect(decodeCursor(encodeCursor(24))).toBe(24); expect(decodeCursor(encodeCursor(960))).toBe(960);
    for (const bad of [encodeCursor(961), "!!", Buffer.from("-1").toString("base64url"), Buffer.from("1.5").toString("base64url"), Buffer.from("007").toString("base64url"), "x".repeat(60)])
      expect(() => decodeCursor(bad), bad).toThrow();
  });
  it("validates search, report and decision input", () => {
    expect(searchInput.parse({})).toMatchObject({ sort: "relevance" });
    expect(parseSearch(new URLSearchParams("q=grace&type=course&free=1&sort=newest")).free).toBe(true);
    for (const bad of ["type=video", "free=yes", "language=en-US", "sort=hot", "q=" + "x".repeat(81), "audience=pastor", "a=1", "type=course&type=product"]) expect(() => parseSearch(new URLSearchParams(bad)), bad).toThrow();
    expect(reportInput.safeParse({ type: "course", id: "11111111-1111-4111-8111-111111111111", reason: "spam" }).success).toBe(true);
    expect(reportInput.safeParse({ type: "course", id: "x", reason: "spam" }).success).toBe(false);
    expect(decisionInput.safeParse({ decision: "reject" }).success).toBe(false);
    expect(decisionInput.safeParse({ decision: "suspend", reason: "  " }).success).toBe(false);
    expect(decisionInput.safeParse({ decision: "approve" }).success).toBe(true);
    expect(publicSummary("x".repeat(400))).toHaveLength(280); expect(publicSummary("  ")).toBeNull();
  });
  it("is hard-off by a literal constant", () => { expect(DISCOVER_SERVER_ENABLED).toBe(false); expect(defaultDiscoverDeps().enabled).toBe(false); });
});

describe("discover migration guards", () => {
  const sql = readFileSync(join(__dirname, "../../drizzle/0100_discover_server.sql"), "utf8");
  it("forces row security, has no current_user policy, fixes search paths and grants the platform functions to the worker only", () => {
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/TO current_user|TO %I/);
    expect(sql).toContain("current_user <> ''harvest_app''");
    for (const fn of sql.match(/CREATE FUNCTION[\s\S]*?\$\$;/g) ?? []) if (/SECURITY DEFINER/.test(fn)) expect(fn).toContain("SET search_path = pg_catalog, pg_temp");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.discover_can[\s\S]*discover_platform_queue[\s\S]*FROM PUBLIC, harvest_app/);
    const appGrant = sql.match(/GRANT EXECUTE ON FUNCTION[^;]*TO harvest_app;/g)?.join(" ") ?? "";
    expect(appGrant).toContain("discover_search"); expect(appGrant).not.toMatch(/discover_platform/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.discover_platform_queue[\s\S]*TO harvest_worker/);
    expect(sql).not.toMatch(/contacts|contact_id/i);
  });
  it("exposes no member, payment or tenant data from the public function", () => {
    const search = sql.match(/CREATE FUNCTION public\.discover_search[\s\S]*?\$\$;/)![0];
    expect(search).not.toMatch(/tenant_id',|email|member|payment|enrol/i);
    expect(search).toContain("c.reviewed_hash = d.content_hash");
    expect(search).toContain("coalesce(s.suspended, false) = false");
  });
});
