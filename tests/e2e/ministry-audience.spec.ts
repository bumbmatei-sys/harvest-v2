import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// PR B + C: a ministry records its type at creation; owners and admins change it in Ministry settings.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/ministry-audience";
const sizes = [["phone", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;

async function shoot(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForTimeout(300);
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("ministry type at creation, in settings, and read-only for viewers", async ({ page, browser }) => {
  test.setTimeout(300000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await page.goto("/workspaces");

  // The API refuses a ministry without a type; the form asks for one.
  expect((await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "No type" } })).status()).toBe(400);
  await page.getByLabel("Ministry name").fill("Grace Mission");
  await expect(page.getByRole("radiogroup", { name: "Ministry type" })).toBeVisible();
  await shoot(page, "create");
  await page.getByRole("radio", { name: "Evangelist or missionary", exact: true }).check();
  await page.getByRole("button", { name: "Create ministry", exact: true }).click();
  await expect(page.getByText("Grace Mission", { exact: true })).toBeVisible();

  const tenant = (await (await page.request.get("/api/workspaces")).json()).find((item: { name: string }) => item.name === "Grace Mission").tenantId as string;
  await page.goto(`/workspaces/${tenant}/crm/people`);
  await page.getByRole("navigation", { name: "Ministry navigation" }).getByRole("link", { name: "Ministry settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ministry settings", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Evangelist or missionary", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Church", exact: true }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Ministry type saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Church", exact: true })).toBeChecked();
  await shoot(page, "settings-owner");

  // A viewer sees the type but cannot change it, in the form or through the API.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  try {
    const viewer = await context.newPage(), email = await signIn(viewer);
    expect((await page.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email, role: "viewer" } })).status()).toBe(200);
    await viewer.goto(`/workspaces/${tenant}/settings`);
    await expect(viewer.getByRole("radio", { name: "Church", exact: true })).toBeChecked();
    await expect(viewer.getByRole("radio", { name: "Church", exact: true })).toBeDisabled();
    await expect(viewer.getByText("Only owners and admins can change the ministry type.", { exact: true })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    expect((await viewer.request.patch(`/api/workspaces/${tenant}/audience`, { headers: { origin }, data: { audience: "ministry_nonprofit" } })).status()).toBe(403);
    await shoot(viewer, "settings-viewer");
  } finally { await context.close(); }
  expect(errors).toEqual([]);
});
