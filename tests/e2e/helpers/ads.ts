import { mkdir } from "node:fs/promises";
import { expect as base, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./session";
import { settleForAxe } from "./settle";
import { releaseSocialConnectionsAfterEach } from "./social-accounts";

// Shared by the Ads browser specs: a ministry with a connected test social account, and the axe, overflow and screenshot audit at three widths in both colour schemes.
export const expect = base.configure({ timeout: 30_000 });
export const shots = "docs/screenshots/ads";
export const releaseAfterEach = releaseSocialConnectionsAfterEach;
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;

export async function adsWorkspace(page: Page, release: (tenant: string) => void) {
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  release(tenant);
  const link = await page.request.post(`/api/workspaces/${tenant}/social/connections`, { headers: { origin }, data: { provider: "fake", credential: "harvest-test-credential", accountRef: "test-facebook" } });
  expect(link.status()).toBe(201);
  return tenant;
}
/** Finds the ad accounts through the connected social account and reads the campaigns, so the screens have the invented data to work with. */
export async function adsSynced(page: Page, tenant: string) {
  await page.goto(`/workspaces/${tenant}/social/ads`);
  await page.locator("[data-ads-find]").click();
  await expect(page.locator("[data-ads-account]")).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).first().click();
  await expect(page.locator('[data-ads-ready="true"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Easter service invitation", exact: true })).toBeVisible();
}

export async function audit(page: Page, name: string) {
  await mkdir(shots, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll("*").forEach((el) => { if (el.scrollTop) el.scrollTop = 0; }); });
      await settleForAxe(page);
      const found = (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
      expect(found.map((v) => `${label}/${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${shots}/${name}-${label}-${scheme}.png`, fullPage: true, animations: "disabled" });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}
