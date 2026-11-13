import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// C04: owners create a community and edit it in the shared EditorShell; viewers see it read-only.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/communities-c04";
const sizes = [["phone", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;

async function shoot(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    // These pages choose their colour scheme at load, so reload to capture the real dark and light renders.
    await page.reload(); await page.waitForTimeout(500);
    await prepare?.();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("create, edit, guard, conflict and publish a community; viewers are read-only", async ({ page, browser }) => {
  test.setTimeout(300000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;

  await page.goto(`/workspaces/${tenant}/crm/people`);
  await page.getByRole("navigation", { name: "Ministry navigation" }).getByRole("link", { name: "Communities", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Communities", exact: true })).toBeVisible();
  await expect(page.getByText("No communities yet. Create your first one.")).toBeVisible();
  await shoot(page, "list-empty");

  // A taken address is refused in the dialog; the address follows the name until edited.
  expect((await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Taken", slug: "grace-bible-study" } })).status()).toBe(201);
  await page.getByRole("button", { name: "New community", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Grace Bible Study");
  await expect(page.getByLabel("Address", { exact: true })).toHaveValue("grace-bible-study");
  await page.getByRole("button", { name: "Create community", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "That community address is taken." })).toBeVisible();
  await page.getByLabel("Address", { exact: true }).fill("grace-bible-study-2");
  await page.getByRole("button", { name: "Create community", exact: true }).click();
  await expect(page).toHaveURL(/\/communities\/[0-9a-f-]{36}\/edit$/);
  const editUrl = page.url(), communityId = editUrl.split("/communities/")[1].split("/")[0];

  // Editor: steps, coming-soon steps, live preview.
  await expect(page.getByRole("heading", { name: "Grace Bible Study", level: 1 })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  const steps = page.getByRole("navigation", { name: "Community setup" });
  for (const label of ["Messages", "Products", "Page"]) await expect(steps.getByRole("button", { name: new RegExp(label) })).toHaveAttribute("aria-disabled", "true");
  await page.getByLabel("Tagline (optional)", { exact: true }).fill("Weekly study and prayer");
  await expect(page.getByRole("complementary", { name: "Preview" }).getByText("Weekly study and prayer")).toBeVisible();
  await shoot(page, "editor-basics");
  await page.getByLabel("Tagline (optional)", { exact: true }).fill("Weekly study and prayer");

  // Unsaved changes are guarded.
  await page.getByRole("link", { name: "Communities", exact: true }).first().click();
  await expect(page.getByRole("alertdialog", { name: "Leave without saving?" })).toBeVisible();
  await page.getByRole("button", { name: "Stay", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  // Joining and publishing.
  await steps.getByRole("button", { name: /Joining/ }).click();
  await page.getByLabel("Anyone can join", { exact: true }).click();
  await page.getByLabel("Listed: appears in Discover", { exact: true }).click();
  await steps.getByRole("button", { name: /Publish/ }).click();
  await expect(page.getByRole("list", { name: "Before you publish" }).getByRole("listitem")).toHaveCount(3);
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await header.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
  const people = async () => { await steps.getByRole("button", { name: /People/ }).click(); await expect(page.getByRole("cell", { name: "Owner", exact: true })).toBeVisible(); await expect(page.getByRole("cell", { name: "No name", exact: true })).toBeVisible(); };
  await people();
  await shoot(page, "editor-published", people);

  // A stale edit is refused with a reload option.
  const current = await (await page.request.get(`/api/workspaces/${tenant}/communities/${communityId}`)).json();
  expect((await page.request.patch(`/api/workspaces/${tenant}/communities/${communityId}`, { headers: { origin }, data: { version: current.version, name: "Changed elsewhere" } })).status()).toBe(200);
  await steps.getByRole("button", { name: /Basics/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("My stale edit");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "changed by someone else" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeVisible();

  // Paid pricing is refused by the API; the Offer step shows it as coming soon.
  expect((await page.request.patch(`/api/workspaces/${tenant}/communities/${communityId}`, { headers: { origin }, data: { version: current.version + 1, pricing: "paid" } })).status()).toBe(409);

  // A ministry viewer sees the editor read-only and cannot change anything through the API.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  try {
    const viewer = await context.newPage(), email = await signIn(viewer);
    expect((await page.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email, role: "viewer" } })).status()).toBe(200);
    await viewer.goto(editUrl);
    await expect(viewer.getByText("Only owners and admins can edit communities.")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
    await expect(viewer.getByLabel("Name", { exact: true })).toBeDisabled();
    // The member roster is for owners and admins only.
    await viewer.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /People/ }).click();
    await expect(viewer.getByText("Only owners and admins can see members.", { exact: true })).toBeVisible();
    await expect(viewer.getByRole("cell", { name: "Owner", exact: true })).toHaveCount(0);
    await viewer.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /Basics/ }).click();
    expect((await viewer.request.patch(`/api/workspaces/${tenant}/communities/${communityId}`, { headers: { origin }, data: { version: 99, name: "Viewer" } })).status()).toBe(403);
    expect((await viewer.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "No", slug: "viewer-no" } })).status()).toBe(403);
    await shoot(viewer, "editor-viewer");
  } finally { await context.close(); }
  expect(errors).toEqual([]);
});
