import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { previewPublicCode } from "../../src/lib/connect-public";

const landing = `/c/${previewPublicCode}`;
const evidence = "docs/screenshots/connect/hc-04";

async function expectPublicLayout(page: Page) {
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);
  await expect(page.locator("form, input, video, iframe, audio")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const link of await page.getByRole("main").getByRole("link").all()) {
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
}

test("guest landing → resources → leave: no identity, tracking, or background resource fetches", async ({ page, context }) => {
  test.setTimeout(90_000);
  await mkdir(evidence, { recursive: true });
  const requests: { method: string; path: string; origin: string; prefetch: boolean }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname, origin: url.origin, prefetch: request.headers()["next-router-prefetch"] === "1" || request.headers().purpose === "prefetch" });
  });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  // Unsupported language follows the existing English-only catalogue fallback.
  await context.setExtraHTTPHeaders({ "accept-language": "ro-RO, en;q=0.8", "x-harvest-workspace": "00000000-0000-0000-0000-000000000001" });
  const axe: Record<string, unknown> = {};
  for (const [name, width, height] of [["mobile", 390, 844], ["desktop", 1440, 1000]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(landing);
    await expect(page.getByRole("heading", { name: "A place to begin." })).toBeVisible();
    await expect(page).toHaveTitle("Welcome · Harvest Connect");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Coming soon" })).toHaveCount(2);
    for (const button of await page.getByRole("button", { name: "Coming soon" }).all()) await expect(button).toBeDisabled();
    await expectPublicLayout(page);
    if (name === "mobile") expect(requests.filter(({ path }) => path.startsWith("/resources/start"))).toEqual([]);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    const landingAxe = await new AxeBuilder({ page }).analyze();
    expect(landingAxe.violations).toEqual([]);
    axe[`landing-${name}`] = landingAxe.violations;
    await page.screenshot({ path: `${evidence}/landing-${name}.png`, fullPage: true });
    await page.getByRole("link", { name: "Browse resources" }).click();
    await expect(page.getByRole("heading", { name: "Start where you are." })).toBeVisible();
    await expect(page).toHaveTitle("Free starter resources · Harvest Connect");
    await expectPublicLayout(page);
    if (name === "mobile") expect(requests.filter(({ path }) => path.startsWith("/resources/start/"))).toEqual([]);
    const resourcesAxe = await new AxeBuilder({ page }).analyze();
    expect(resourcesAxe.violations).toEqual([]);
    axe[`resources-${name}`] = resourcesAxe.violations;
    await page.screenshot({ path: `${evidence}/resources-${name}.png`, fullPage: true });
    for (const [action, title] of [["Open reading guide", "Your first Bible reading"], ["Read common questions", "Common questions"], ["Explore next steps", "Keep exploring"]]) {
      await page.getByRole("link", { name: action }).click();
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      // Next streams metadata separately from the visible page during navigation.
      await expect(page).toHaveTitle(title);
      await expectPublicLayout(page);
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
      axe[`${action}-${name}`] = result.violations;
      if (action === "Open reading guide") await page.screenshot({ path: `${evidence}/reading-${name}.png`, fullPage: true });
      await page.getByRole("link", { name: "All resources" }).click();
    }
  }
  // Also check small screens, zoom-equivalent reflow, and dark mode.
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(landing);
  await expect(page).toHaveTitle("Welcome · Harvest Connect");
  await expectPublicLayout(page);
  const darkLanding = await new AxeBuilder({ page }).analyze();
  expect(darkLanding.violations).toEqual([]);
  axe["landing-320-dark"] = darkLanding.violations;
  await page.getByRole("link", { name: "Browse resources" }).click();
  await expect(page).toHaveTitle("Free starter resources · Harvest Connect");
  await expectPublicLayout(page);
  const darkResources = await new AxeBuilder({ page }).analyze();
  expect(darkResources.violations).toEqual([]);
  axe["resources-320-dark"] = darkResources.violations;
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.goto("about:blank");
  expect(requests.filter(({ origin }) => origin !== "http://127.0.0.1:3100")).toEqual([]);
  expect(requests.filter(({ method, path }) => method !== "GET" || path.startsWith("/api/"))).toEqual([]);
  expect(requests.filter(({ path }) => path === "/sign-in" || path.startsWith("/workspaces"))).toEqual([]);
  expect(requests.filter(({ prefetch }) => prefetch)).toEqual([]);
  expect((await context.cookies()).filter(({ name }) => name !== "__next_hmr_refresh_hash__")).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(`${evidence}/axe-results.json`, `${JSON.stringify(axe, null, 2)}\n`);
});

test("mobile guides work without JavaScript, media, or fonts on a slow connection", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route("**/*", (route) => ["script", "font", "image", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue());
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024 });
  await page.goto(landing, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "A place to begin." })).toBeVisible();
  await page.getByRole("link", { name: "Browse resources" }).click();
  await page.getByRole("link", { name: "Open reading guide" }).click();
  await expect(page.getByRole("heading", { name: "1. A welcome home · Luke 15:11–32" })).toBeVisible();
  await page.getByRole("link", { name: "All resources" }).click();
  await page.getByRole("link", { name: "Read common questions" }).click();
  await expect(page.getByRole("heading", { name: "Do I need to sign up to keep reading?" })).toBeVisible();
  await page.goto("about:blank");
  await context.close();
});

test("unknown public codes and resource ids expose only a safe resource fallback", async ({ page }) => {
  for (const path of ["/c/1", `/c/${"0".repeat(32)}`, "/resources/start/private"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "This page isn’t available." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse resources" })).toHaveAttribute("href", "/resources/start");
    await expect(page.locator("form, input")).toHaveCount(0);
  }
});
