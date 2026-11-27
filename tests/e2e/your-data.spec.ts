import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// "Your data" (27 Nov): download my data from the profile page.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const shots = process.env.YOUR_DATA_SHOTS ?? "test-results/your-data";

async function check(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload();
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("downloads my data from the profile page", async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const email = await signIn(page);
  await page.goto("/account/profile");
  await expect(page.getByRole("heading", { name: "Your data", exact: true })).toBeVisible();
  const button = page.getByRole("button", { name: "Download my data", exact: true });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await check(page, "profile-your-data");
  const download = page.waitForEvent("download");
  await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^harvest-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(data).toMatchObject({ format: "harvest-your-data", account: { email } });
  for (const section of ["ministries", "communities", "posts", "replies", "chatMessages", "directMessages", "courseProgress", "courseNotes", "files"]) expect(Array.isArray(data[section])).toBe(true);
  await expect(page.getByText("Your data was downloaded.", { exact: true })).toBeVisible();
  // The route refuses other origins, and the hourly limit applies.
  expect((await page.request.post("/api/account/data", { headers: { origin: "https://evil.example.invalid" } })).status()).toBe(403);
  expect((await page.request.post("/api/account/data", { headers: { origin } })).status()).toBe(200);
  expect((await page.request.post("/api/account/data", { headers: { origin } })).status()).toBe(200);
  const limited = await page.request.post("/api/account/data", { headers: { origin } });
  expect(limited.status()).toBe(429);
  expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
  await button.click();
  await expect(page.getByRole("alert").filter({ hasText: "3 times an hour" })).toBeVisible();
});
