import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const evidence = "docs/screenshots/campaign-wizard";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
/** In dark mode no card edge may be near-white: every visible border or outline of the matched elements stays below 60% relative luminance. */
async function expectNoLightEdges(page: Page, selector: string) {
  const light = await page.locator(selector).evaluateAll((nodes) => nodes.flatMap((node) => {
    const style = getComputedStyle(node), canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const edges = [parseFloat(style.borderTopWidth) ? style.borderTopColor : "", parseFloat(style.borderLeftWidth) ? style.borderLeftColor : "",
      style.outlineStyle !== "none" && parseFloat(style.outlineWidth) ? style.outlineColor : ""].filter(Boolean);
    return edges.filter((color) => {
      canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = "#000"; canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data; if (a < 40) return false;
      const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) >= 0.6;
    }).map((color) => `${node.tagName.toLowerCase()}.${(node.getAttribute("data-slot") ?? node.getAttribute("role") ?? "")} ${color}`);
  }));
  expect(light, `near-white edges in ${selector}`).toEqual([]);
}
/** The dev server renders first and hydrates after: a click before React attaches is lost. */
const hydrated = (page: Page) => page.waitForFunction(() => { const field = document.querySelector("input,textarea,select,[role=radio],[role=switch]"); return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps")); });

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
      if (scheme === "dark") await expectNoLightEdges(page, 'button:has([data-campaign-type-art]), [data-slot="card"], [data-slot="accent-icon"]');
      // The art has real height and fills its card's width.
      const sizes = await page.locator("[data-campaign-type-art]").evaluateAll((nodes) => nodes.map((node) => {
        const art = node.getBoundingClientRect(), card = node.closest("button")!.getBoundingClientRect();
        return { height: Math.round(art.height), fills: Math.abs(art.width - card.width) <= 2 };
      }));
      for (const size of sizes) { expect(size.height).toBeGreaterThanOrEqual(100); expect(size.fills).toBe(true); }
      await page.evaluate(() => { scrollTo(0, 0); document.querySelectorAll("*").forEach((node) => { if (node.scrollTop) node.scrollTop = 0; }); }); // the sticky phone step bar overlaps controls once scrolled
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Only the selected card is highlighted: no hover or focus left over from earlier steps, and an unselected card never wears the selected border.
      await page.mouse.move(0, 0); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const selectedBorder = await page.getByRole("radio", { name: /Mission Trip/ }).evaluate((node) => getComputedStyle(node).borderTopColor);
      await page.getByRole("radio", { name: /Local Outreach/ }).hover();
      expect(await page.getByRole("radio", { name: /Local Outreach/ }).evaluate((node) => getComputedStyle(node).borderTopColor)).not.toBe(selectedBorder);
      await page.mouse.move(0, 0);
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
      await expect(page.locator('[data-campaign-accent="primary"]')).toHaveCount(1);
      await expect(heading("Location & Dates")).toBeVisible();
      await hydrated(page);
      for (const [name, step] of [["place", "Location & Dates"], ["basics", "Basic Information"], ["type", "Campaign Type"]] as const) {
        if (name !== "place") await page.getByRole("button", { name: "Back", exact: true }).click();
        await expect(heading(step)).toBeVisible();
        await expect(page.locator('[data-slot="card-header"] [data-slot="accent-icon"]')).toHaveCount(1);
        if (scheme === "dark") await expectNoLightEdges(page, '[data-slot="card"], button:has([data-campaign-type-art]), [data-slot="accent-icon"], input, textarea, label');
        await page.evaluate(() => { scrollTo(0, 0); document.querySelectorAll("*").forEach((node) => { if (node.scrollTop) node.scrollTop = 0; }); }); // the sticky phone step bar overlaps controls once scrolled
        await settleForAxe(page);
        expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${evidence}/accent-step-${name}-${label}-${scheme}.png`, fullPage: true });
      }
      await page.goto(`${root}/drafts`);
      await expect(page.locator('[data-slot="item-group"] > [role="listitem"]')).toHaveCount(3);
      if (scheme === "dark") await expectNoLightEdges(page, '[data-slot="item"], [data-slot="accent-icon"], [data-campaign-type-art]');
      await page.evaluate(() => { scrollTo(0, 0); document.querySelectorAll("*").forEach((node) => { if (node.scrollTop) node.scrollTop = 0; }); }); // the sticky phone step bar overlaps controls once scrolled
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/accent-drafts-${label}-${scheme}.png`, fullPage: true });
    }
  }
});

// Phase 2: each department on step 4 and each feature on step 5 carries its own accent icon chip.
test("campaign accents: department and feature chips on steps 4 and 5 at desktop and phone in light and dark", async ({ page }) => {
  test.setTimeout(600_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Chips Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "chips-1" }, data: { type: "evangelistic_crusade" } })).json();
  let current = draft;
  for (const [step, data] of [["basics", { name: "City Harvest Night", description: null, mission: null }], ["place", { country: "Chile", cityRegion: "Santiago", startDate: "2027-05-01", endDate: "2027-05-02", timeZone: "America/Santiago", structure: "single" }]] as const) {
    current = await (await page.request.patch(`${api}/${draft.id}`, { headers: { origin }, data: { version: current.version, step, data } })).json();
  }
  const heading = (name: string) => page.getByRole("heading", { name, level: 2, exact: true });
  const check = async (name: string) => {
    await page.evaluate(() => { scrollTo(0, 0); document.querySelectorAll("*").forEach((node) => { if (node.scrollTop) node.scrollTop = 0; }); }); // the sticky phone step bar overlaps controls once scrolled
      await settleForAxe(page);
    expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  };
  for (const scheme of ["light", "dark"] as const) for (const [label, width, height] of [["desktop", 1280, 900], ["phone", 360, 800]] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width, height });
    await page.goto(`${root}/drafts/${draft.id}`);
    await expect(heading("Teams & Leadership")).toBeVisible();
    await hydrated(page);
    await expect(page.locator('section[aria-labelledby^="department-"] [data-slot="accent-icon"][data-accent]')).toHaveCount(13);
    if (scheme === "dark") await expectNoLightEdges(page, '[data-slot="card"], section[aria-labelledby^="department-"], [data-slot="accent-icon"]');
    await check(`accent-step-teams-${label}-${scheme}`);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(heading("Campaign Features")).toBeVisible();
    await expect(page.locator('[role="group"] label [data-slot="accent-icon"][data-accent]')).toHaveCount(18);
    if (scheme === "dark") await expectNoLightEdges(page, '[data-slot="card"], [role="group"] label, [data-slot="accent-icon"]');
    await check(`accent-step-tools-${label}-${scheme}`);
  }
});
