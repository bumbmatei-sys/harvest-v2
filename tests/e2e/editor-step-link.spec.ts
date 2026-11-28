import { randomUUID } from "node:crypto";
import { expect as playwrightExpect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Shell slice S8: `?step=<id>` opens that step of the shared EditorShell (community editor, campaign wizard), falls back for unknown or
// locked steps, and the address follows every step change without adding history entries.
const expect = playwrightExpect.configure({ timeout: 15_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const stepHeading = (page: Page, name: string) => page.getByRole("heading", { name, level: 2, exact: true });
const current = (page: Page) => page.locator('[aria-current="step"]:visible');
const search = (page: Page) => new URL(page.url()).search;

async function community(page: Page) {
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Church", audience: "church" } })).json()).tenantId as string;
  const created = await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Grace Bible Study", slug: `grace-${randomUUID().slice(0, 8)}` } });
  expect(created.status()).toBe(201);
  return { tenant, url: `/workspaces/${tenant}/communities/${(await created.json()).id}/edit` };
}

test("community editor: ?step= opens the step, falls back safely and follows step changes", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { url } = await community(page);

  // Without the parameter the editor opens on its own first step and the address stays plain.
  await page.goto(url);
  await expect(stepHeading(page, "Basics")).toBeVisible();
  await expect(current(page).first()).toContainText("Basics");
  expect(search(page)).toBe("");

  // A known step: it opens, is marked current and its heading takes focus.
  await page.goto(`${url}?step=joining`);
  await expect(stepHeading(page, "Joining")).toBeFocused();
  await expect(current(page)).toHaveCount(1);
  await expect(current(page)).toContainText("Joining");
  expect(search(page)).toBe("?step=joining");
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);

  // Changing step replaces the parameter; no history entry is added, so Back leaves the editor.
  const length = await page.evaluate(() => history.length);
  await page.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /Channels/ }).click();
  await expect(stepHeading(page, "Channels")).toBeVisible();
  await expect(page).toHaveURL(/\?step=channels$/);
  expect(await page.evaluate(() => history.length)).toBe(length);

  // Reloading keeps the step.
  await page.reload();
  await expect(stepHeading(page, "Channels")).toBeFocused();

  // A locked (coming soon) step and an unknown one fall back to the first step and drop the parameter; other parameters stay.
  for (const value of ["messages", "nope", "JOINING"]) {
    await page.goto(`${url}?step=${value}&from=test`);
    await expect(stepHeading(page, "Basics")).toBeVisible();
    await expect(page).toHaveURL(/\?from=test$/);
    await expect(current(page)).toContainText("Basics");
  }

  // Phone: the step bar shows the linked step.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}?step=publish`);
  await expect(stepHeading(page, "Publish")).toBeFocused();
  await expect(page.locator('[data-slot="editor-step-bar"]')).toContainText("Step 9 of 9");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("campaign wizard: ?step= opens a step of a draft and follows Next", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`;
  const draft = await (await page.request.post(`/api${root}/drafts`, { headers: { origin, "Idempotency-Key": `step-link-${randomUUID()}` }, data: { type: "local_outreach" } })).json();

  await page.goto(`${root}/drafts/${draft.id}?step=leaders`);
  await expect(stepHeading(page, "Teams & Leadership")).toBeFocused();
  await expect(current(page)).toContainText("Teams & Leadership");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(stepHeading(page, "Location & Dates")).toBeVisible();
  await expect(page).toHaveURL(/\?step=place$/);

  await page.goto(`${root}/drafts/${draft.id}?step=unknown`);
  await expect(page.locator('[data-slot="wizard-heading"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/drafts/${draft.id}$`));
  expect(errors).toEqual([]);
});
