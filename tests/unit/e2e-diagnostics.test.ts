import { describe, expect, it } from "vitest";
import { e2eDenialDetails, e2eDiagnosticsOn, e2eReason } from "../../src/server/e2e-diagnostics";

const pg = { table: "bio_pages", routine: "ExecWithCheckOptions", message: 'new row violates row-level security policy for table "bio_pages"' };
describe("browser-test 403 diagnostics", () => {
  it("are on only with the flag and outside production", () => {
    expect(e2eDiagnosticsOn({ HARVEST_E2E_MOCK_EMAIL: "1", NODE_ENV: "development" })).toBe(true);
    expect(e2eReason("no_membership", { HARVEST_E2E_MOCK_EMAIL: "1" })).toEqual({ reason: "no_membership" });
    expect(e2eDenialDetails(pg, { HARVEST_E2E_MOCK_EMAIL: "1", NODE_ENV: "test" })).toMatchObject({ sqlstate: "42501", table: "bio_pages" });
    expect(e2eDiagnosticsOn({ NODE_ENV: "development" })).toBe(false);
    expect(e2eReason("no_membership", {})).toBeUndefined();
  });
  it("add nothing in production, even with the flag set", () => {
    for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { HARVEST_ENV: "production" }]) {
      const withFlag = { HARVEST_E2E_MOCK_EMAIL: "1", ...env };
      expect(e2eDiagnosticsOn(withFlag)).toBe(false);
      expect(e2eReason("no_membership", withFlag)).toBeUndefined();
      expect(e2eDenialDetails(pg, withFlag)).toBeUndefined();
    }
  });
});
