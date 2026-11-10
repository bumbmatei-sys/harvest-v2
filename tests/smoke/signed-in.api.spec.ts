import { expect, test, type APIRequestContext } from "@playwright/test";
import { smokeConfig } from "./smoke-config";
import { signedInConfig, signedInRequest, verifiedSmokeWorkspace, type SmokeWorkspace } from "./signed-in";

const config = signedInConfig(smokeConfig());
test.describe("smoke church, signed in (read-only API)", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!config, "Signed-in smoke settings are not configured.");
  let api: APIRequestContext, workspace: SmokeWorkspace;
  test.beforeAll(async () => { api = await signedInRequest(config!); workspace = await verifiedSmokeWorkspace(api, config!); });
  test.afterAll(async () => { await api?.dispose(); });

  for (const path of ["contacts", "companies", "crm/pipelines", "crm/tasks", "campaigns"]) {
    test(`reads ${path}`, async () => {
      const response = await api.get(`/api/workspaces/${workspace.tenantId}/${path}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/json");
    });
  }
});
