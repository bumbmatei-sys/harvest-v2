import { expect, test } from "@playwright/test";
import { smokeConfig } from "./smoke-config";
import { smokeGet } from "./smoke-http";
import { signedInConfig, verifiedSmokeWorkspace, type SmokeWorkspace } from "./signed-in";

const config = signedInConfig(smokeConfig());
test.describe("smoke church, signed in (read-only API)", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!config, "Signed-in smoke settings are not configured.");
  let workspace: SmokeWorkspace;
  test.beforeAll(async () => { workspace = await verifiedSmokeWorkspace(config!); });

  // GET routes with no side effects. (Pipelines are left out: listing them seeds a default for owners.)
  for (const path of ["contacts", "companies", "crm/tasks", "campaigns"]) {
    test(`reads ${path}`, async () => {
      const response = await smokeGet(config!, `/api/workspaces/${workspace.tenantId}/${path}`, { signedIn: true });
      expect(response.status).toBe(200);
      expect(response.contentType).toContain("application/json");
    });
  }
});
