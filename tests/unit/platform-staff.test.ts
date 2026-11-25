import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(__dirname, "../../drizzle/0102_platform_staff.sql"), "utf8");
const script = readFileSync(join(__dirname, "../../scripts/platform-staff.ts"), "utf8");
describe("platform staff migration", () => {
  it("forces row security, has no application policy or grant on the staff tables, and no current_user policy", () => {
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).not.toMatch(/TO current_user|TO %I/);
    expect(migration).toContain("current_user <> ''harvest_app''");
    expect(migration).toMatch(/REVOKE ALL ON public\.%I FROM PUBLIC, harvest_app/);
    expect(migration).not.toMatch(/GRANT [A-Z, ]+ ON (TABLE )?public\.platform_staff/);
  });
  it("fixes the search path on every definer and revokes every function from PUBLIC and the application role", () => {
    const fns = migration.match(/CREATE FUNCTION[\s\S]*?\$\$;/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(11);
    for (const fn of fns) if (/SECURITY DEFINER/.test(fn)) expect(fn).toContain("SET search_path = pg_catalog, pg_temp");
    for (const name of ["platform_staff_grant", "platform_staff_revoke", "platform_staff_role", "platform_staff_log", "platform_staff_me", "platform_discover_queue", "platform_discover_decide", "platform_discover_reports",
      "platform_discover_resolve_report", "platform_discover_standing", "discover_communities_approved"]) expect(migration.match(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC, harvest_app;/)![0]).toContain(`public.${name}(`);
  });
  it("grants the web application only the staff-checked Discover functions and the caller's own role", () => {
    const grant = migration.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO harvest_app;/)![0];
    for (const allowed of ["platform_staff_me", "platform_discover_queue", "platform_discover_decide", "platform_discover_reports", "platform_discover_resolve_report", "platform_discover_standing", "discover_communities_approved"]) expect(grant).toContain(allowed);
    for (const forbidden of ["platform_staff_grant", "platform_staff_revoke", "platform_staff_role", "platform_staff_log"]) expect(grant).not.toContain(forbidden);
    expect(migration).not.toMatch(/TO harvest_worker/);
  });
  it("checks the staff role in every staff-facing function and never returns member data", () => {
    for (const name of ["queue", "decide", "reports", "resolve_report", "standing"]) {
      const fn = migration.match(new RegExp(`CREATE FUNCTION public\\.platform_discover_${name}[\\s\\S]*?\\$\\$;`))![0];
      expect(fn).toContain("platform_staff_role(actor)");
      expect(fn).toMatch(/platform_staff_log/);
    }
    expect(migration).not.toMatch(/community_memberships|workspace_members|contacts|entitlements/i);
  });
});
describe("platform staff ops script", () => {
  it("is the only grant path: it calls the owner-only functions and takes the operator's name", () => {
    expect(script).toContain("platform_staff_grant"); expect(script).toContain("--by");
    expect(script).toContain("DATABASE_URL_UNPOOLED");
    expect(script).not.toMatch(/process\.env\.[A-Z_]*(PASSWORD|SECRET|TOKEN)/);
  });
});
