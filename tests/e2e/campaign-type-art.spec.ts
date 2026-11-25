import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const evidence = "docs/screenshots/campaign-wizard";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
/** The dev server renders first and hydrates after: a click before React attaches is lost. */
const hydrated = (page: Page) => page.waitForFunction(() => { const field = document.querySelector("input,textarea,select,[role=radio]"); return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps")); });

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
        await hydrated(page);
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

// The chosen type's accent tints the wizard (step chips, the accent line on the step card, the phone progress bar); drafts show the type's artwork.
test("campaign accents: steps 1 to 3 and the drafts list at desktop and phone in light and dark", async ({ page }) => {
  test.setTimeout(300_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Accent Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "accent-1" }, data: { type: "evangelistic_crusade" } })).json();
  expect((await page.request.patch(`${api}/${draft.id}`, { headers: { origin }, data: { version: draft.version, step: "basics", data: { name: "City Harvest Night", mission: "Reach the city" } } })).status()).toBe(200);
  const second = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "accent-2" }, data: { type: "mission_trip" } })).json();
  expect((await page.request.patch(`${api}/${second.id}`, { headers: { origin }, data: { version: second.version, step: "basics", data: { name: "Summer team to Lima" } } })).status()).toBe(200);
  await page.request.post(api, { headers: { origin, "Idempotency-Key": "accent-3" }, data: {} });
  const heading = (name: string) => page.getByRole("heading", { name, level: 2, exact: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of [["desktop", 1280, 900], ["phone", 360, 800]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`${root}/drafts/${draft.id}`);
      await expect(page.locator('[data-campaign-accent="pink"]')).toHaveCount(1);
      await expect(heading("Location & Dates")).toBeVisible();
      await hydrated(page);
      for (const [name, step] of [["place", "Location & Dates"], ["basics", "Basic Information"], ["type", "Campaign Type"]] as const) {
        if (name !== "place") await page.getByRole("button", { name: "Back", exact: true }).click();
        await expect(heading(step)).toBeVisible();
        await expect(page.locator('[data-slot="card-header"] [data-slot="accent-icon"]')).toHaveCount(1);
        await settleForAxe(page);
        expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/accent-step-${name}-${label}-${scheme}.png`, fullPage: true });
      }
      await page.goto(`${root}/drafts`);
      await expect(page.locator('[data-slot="item-group"] > [role="listitem"]')).toHaveCount(3);
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/accent-drafts-${label}-${scheme}.png`, fullPage: true });
    }
  }
});
