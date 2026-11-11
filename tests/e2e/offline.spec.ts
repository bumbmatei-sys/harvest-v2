import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signIn, origin } from "./helpers/session";
import AxeBuilder from "@axe-core/playwright";
import { BRAND_THEMES, COLOR_MODES } from "../../src/lib/theme-registry";

test("offline navigation uses a public fallback without caching workspace or API responses", async ({ page, context }) => {
  await page.goto("/sign-in");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await signIn(page);
  const response = await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name: "Private offline test workspace" } });
  expect(response.status()).toBe(201);
  const workspace = (await response.json()).tenantId;
  await page.goto(`/workspaces/${workspace}/crm/people`);
  await page.evaluate(async () => { await fetch("/api/profile"); await fetch("/api/workspaces"); });
  await context.setOffline(true);
  await page.goto(`/workspaces/${workspace}/crm/people`);
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (await Promise.all(keys.map(async (key) => (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname)))).flat();
  });
  expect(cached.sort()).toEqual(["/offline.css", "/icons/icon-192.png", "/icons/icon-512.png", "/offline.html"].sort());
  await mkdir("docs/screenshots/pr03", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/pr03/offline.png", fullPage: true });
  for (const brand of BRAND_THEMES) for (const mode of COLOR_MODES) {
    await page.evaluate(({ brand, mode }) => {
      localStorage.setItem("harvest-brand-theme", brand);
      localStorage.setItem("harvest-color-mode", mode);
    }, { brand, mode });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-brand-theme", brand);
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `docs/screenshots/pr03/offline-${brand}-${mode}.png`, fullPage: true });
  }
});
