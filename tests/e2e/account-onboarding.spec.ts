import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// HC-08: a new personal account is offered onboarding once, can skip it, and keeps editing its profile.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/hc-08";
const sizes = [["phone", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;

async function shoot(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.waitForFunction(s => { const t = document.documentElement.dataset.theme; return !t || t === s; }, scheme);
    // These pages choose their colour scheme at load, so reload to capture the real dark and light renders.
    await page.reload();
    await page.waitForTimeout(500);
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("a new account completes onboarding; another skips and can finish later", async ({ page, browser }) => {
  test.setTimeout(300000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);

  // Pending accounts are sent from the welcome page to onboarding.
  await page.goto("/account/welcome");
  await expect(page).toHaveURL(/\/account\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Set up your account", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Explore later" })).toBeChecked();
  for (const label of ["Find a free community", "Start a Bible course", "Find a church"]) await expect(page.getByRole("radio", { name: new RegExp(label) })).toBeDisabled();
  await expect(page.getByText("Coming soon")).toHaveCount(3);
  await shoot(page, "onboarding");

  await page.getByLabel("Name", { exact: true }).fill("Maria Example");
  await page.getByLabel("City (optional)", { exact: true }).fill("Berlin");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/welcome$/);
  await expect(page.getByRole("heading", { name: "Welcome to Harvest", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Finish setup", exact: true })).toHaveCount(0);

  // The profile page shows the saved values and keeps saving without changing onboarding status.
  await page.goto("/account/profile");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Maria Example");
  await expect(page.getByLabel("City (optional)", { exact: true })).toHaveValue("Berlin");
  await page.getByLabel("City (optional)", { exact: true }).fill("Hamburg");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  await shoot(page, "profile");
  expect((await (await page.request.get("/api/account/profile")).json()).cityRegion).toBe("Hamburg");

  // Invalid input is refused by the API.
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name: "", locale: null, cityRegion: null } })).status()).toBe(400);

  // A second account skips and sees "Finish setup" afterwards.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  try {
    const other = await context.newPage();
    await signIn(other);
    await other.goto("/account/welcome");
    await other.getByRole("button", { name: "Skip for now", exact: true }).click();
    await expect(other.getByRole("heading", { name: "Welcome to Harvest", exact: true })).toBeVisible();
    await shoot(other, "welcome-skipped");
    await other.getByRole("link", { name: "Finish setup", exact: true }).click();
    await expect(other).toHaveURL(/\/account\/onboarding$/);
    // Skipping never blocks the free resources.
    await other.goto("/resources/start");
    await expect(other).toHaveURL(/\/resources\/start$/);
  } finally { await context.close(); }
  expect(errors).toEqual([]);
});
