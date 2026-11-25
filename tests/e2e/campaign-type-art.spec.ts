import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const evidence = "docs/screenshots/campaign-wizard";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

// The campaign type cards carry decorative, code-drawn header art: present on every card, hidden from assistive technology, no axe findings,
// no horizontal scroll, at 1280, 768 and 360 in light and dark.
test("campaign type art: every card has header art, accessible at three widths in both schemes", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Art Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`;
  const draft = await (await page.request.post(`/api${root}/drafts`, { headers: { origin, "Idempotency-Key": "type-art-1" }, data: { type: "mission_trip" } })).json();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1280, 768, 360]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : width === 768 ? 1024 : 800 });
      await page.goto(`${root}/drafts/${draft.id}`);
      const step = page.getByRole("heading", { name: "Campaign Type", level: 2, exact: true });
      if (!(await step.isVisible().catch(() => false))) {
        await expect(page.getByRole("heading", { name: "Basic Information", level: 2, exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Back", exact: true }).click();
      }
      await expect(step).toBeVisible();
      await expect(page.getByRole("radio")).toHaveCount(5);
      await expect(page.locator("[data-campaign-type-art]")).toHaveCount(5);
      await expect(page.locator('[data-campaign-type-art][aria-hidden="true"]')).toHaveCount(5);
      await expect(page.getByRole("radio", { name: /Mission Trip/ })).toHaveAttribute("aria-checked", "true");
      // The art has real height and fills its card's width.
      const sizes = await page.locator("[data-campaign-type-art]").evaluateAll((nodes) => nodes.map((node) => {
        const art = node.getBoundingClientRect(), card = node.closest("button")!.getBoundingClientRect();
        return { height: Math.round(art.height), fills: Math.abs(art.width - card.width) <= 2 };
      }));
      for (const size of sizes) { expect(size.height).toBeGreaterThanOrEqual(100); expect(size.fills).toBe(true); }
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/type-art-${width}-${scheme}.png`, fullPage: true });
    }
  }
});
