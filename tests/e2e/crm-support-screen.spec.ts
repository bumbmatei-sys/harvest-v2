import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// Import and sync status screen: empty state, one import row without its file name, link from Imports,
// axe and overflow at 360, 768 and 1280 in light and dark. Run with and without HARVEST_SHELL_MODES=disabled.
const expect = baseExpect.configure({ timeout: 20_000 });
const evidence = "docs/screenshots/crm-support-screen";
test.use({ reducedMotion: "reduce", actionTimeout: 20_000, navigationTimeout: 60_000 });

async function api(page: Page, method: "get" | "post", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") === mode) return;
  await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}
async function check(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator("body").innerText()).not.toContain("MISSING_MESSAGE");
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: "disabled" });
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), name).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${name} overflow`).toBeLessThanOrEqual(0);
}

test("import and sync status shows lifecycle only, honest empty state, and passes axe", async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest support screen workspace" });
  expect(workspace.status).toBe(201);
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${root}/crm/imports`);
  await page.getByRole("link", { name: "Import status" }).click();
  await expect(page).toHaveURL(`${root}/crm/imports/status`);
  await expect(page.getByRole("heading", { name: "Import and sync status" })).toBeVisible();
  await expect(page.getByText("No imports yet")).toBeVisible();
  await check(page, "empty-1280-light");

  expect((await api(page, "post", `${apiRoot}/crm/imports`, { entity: "person", clientKey: randomUUID(), fileName: "synthetic-secret-name.csv", csv: "Name\nSynthetic A" })).status).toBe(201);
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${root}/crm/imports/status`);
    for (const mode of ["light", "dark"] as const) {
      await setMode(page, mode);
      await expect(page.getByText("Mapping")).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain("synthetic-secret-name");
      await check(page, `list-${width}-${mode}`);
    }
  }
  expect(pageErrors).toEqual([]);
});
