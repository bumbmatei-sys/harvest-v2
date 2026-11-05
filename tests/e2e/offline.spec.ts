import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signIn, origin } from "./helpers/session";
import AxeBuilder from "@axe-core/playwright";

test("offline navigation uses a public fallback without caching workspace or API responses", async ({ page, context }) => {
  await page.goto("/sign-in");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await signIn(page);
  const response = await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Private offline test workspace" } });
  expect(response.status()).toBe(201);
  const workspace = (await response.json()).tenantId;
  await page.goto(`/workspaces/${workspace}/contacts`);
  await page.evaluate(async () => { await fetch("/api/profile"); await fetch("/api/workspaces"); });
  await context.setOffline(true);
  await page.goto(`/workspaces/${workspace}/contacts`);
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (await Promise.all(keys.map(async (key) => (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname)))).flat();
  });
  expect(cached.sort()).toEqual(["/offline.css", "/icons/icon-192.png", "/icons/icon-512.png", "/offline.html"].sort());
  await mkdir("docs/screenshots/pr03", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/pr03/offline.png", fullPage: true });
});
