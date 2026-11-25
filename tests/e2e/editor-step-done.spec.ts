import { mkdir } from "node:fs/promises";
import { expect as base, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// A finished step shows a green check in the shared editor's step list (the event editor stands for every editor that uses the shared step components).
const expect = base.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });
const prefix = process.env.STEP_SHOT_PREFIX ?? "after";
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

async function audit(page: Page, scheme: "light" | "dark", width: number, height: number) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.setViewportSize({ width, height });
  await settleForAxe(page);
  const found = (await new AxeBuilder({ page }).include(width >= 1024 ? "[data-editor-steps]" : "[data-slot=\"editor-step-bar\"]").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
  expect(found.map((v) => `${width}/${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/screenshots/step-done/${prefix}-${width}-${scheme}.png`, animations: "disabled" });
}

test("a finished step gets a green check in the step list, in both colour schemes, at 1280 and 360", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir("docs/screenshots/step-done", { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  await page.goto(`/workspaces/${tenant}/events/new`);
  await page.getByLabel("Title").fill("Easter service");
  const done = page.locator('[data-editor-steps] [data-slot="editor-step-indicator"][data-state="done"]').first();
  await expect(done).toBeVisible();
  await expect(done.locator("svg")).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload();
    await page.getByLabel("Title").fill("Easter service");
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    const color = await page.locator('[data-editor-steps] [data-slot="editor-step-indicator"][data-state="done"]').first().evaluate((el) => getComputedStyle(el).color);
    if (prefix === "after") expect(color).toBe(rgb(scheme === "light" ? "#18793b" : "#6fd69a"));
    await audit(page, scheme, 1280, 900);
    await audit(page, scheme, 360, 800);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});
