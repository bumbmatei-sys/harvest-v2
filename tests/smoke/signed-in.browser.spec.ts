import { expect, test } from "@playwright/test";
import { isReadOnlyMethod, smokeConfig } from "./smoke-config";
import { signedInConfig, signedInRequest, verifiedSmokeWorkspace, type SmokeWorkspace } from "./signed-in";

const config = signedInConfig(smokeConfig());
test.describe("smoke church, signed in (read-only pages)", () => {
  test.skip(!config, "Signed-in smoke settings are not configured.");
  let workspace: SmokeWorkspace;
  test.beforeAll(async () => {
    const api = await signedInRequest(config!);
    try { workspace = await verifiedSmokeWorkspace(api, config!); } finally { await api.dispose(); }
  });

  let blocked: string[] = [], crashes: string[] = [];
  test.beforeEach(async ({ context, page }) => {
    blocked = []; crashes = [];
    // Any request that could change data is aborted, and the test then fails.
    await context.route("**/*", (route) => {
      const method = route.request().method();
      if (isReadOnlyMethod(method)) return route.continue();
      blocked.push(`${method} ${new URL(route.request().url()).pathname}`);
      return route.abort("blockedbyclient");
    });
    await context.addCookies([{ ...config!.sessionCookie, url: config!.origin, httpOnly: true, secure: config!.origin.startsWith("https:"), sameSite: "Lax" }]);
    page.on("pageerror", (error) => crashes.push(error.name));
  });
  test.afterEach(() => {
    expect(blocked, "The page tried to change data").toEqual([]);
    expect(crashes, "The page threw in the browser").toEqual([]);
  });

  test("workspace list shows the smoke church", async ({ page }) => {
    await page.goto("/workspaces");
    await expect(page.getByRole("heading", { name: "Your workspaces" })).toBeVisible();
    await expect(page.getByText(workspace.name, { exact: true }).first()).toBeVisible();
  });

  for (const [label, path] of [["People", "crm/people"], ["Organizations", "crm/companies"], ["Campaigns", "campaigns"]] as const) {
    test(`${label} screen loads`, async ({ page }) => {
      const response = await page.goto(`/workspaces/${workspace.tenantId}/${path}`);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("main#main-content")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("Couldn’t load this page")).toHaveCount(0);
      await page.waitForLoadState("networkidle");
    });
  }
});
