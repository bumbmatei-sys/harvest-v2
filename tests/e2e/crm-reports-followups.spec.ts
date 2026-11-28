import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";
import { settleForAxe } from "./helpers/settle";

// CRM reports follow-ups: ministry time zone (creation, settings, report footer), stage-to-stage movement, CSV export for owners and admins.
// Axe and overflow at 360, 768 and 1280 in light and dark. Run it with and without HARVEST_SHELL_MODES=disabled.
const expect = baseExpect.configure({ timeout: 20_000 });
const evidence = "docs/screenshots/crm-reports-followups";
test.use({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 }, timezoneId: "Pacific/Auckland", actionTimeout: 20_000, navigationTimeout: 60_000 });

async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") === mode) return;
  await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}
async function capture(page: Page, name: string, ready: () => Promise<void>) {
  await ready();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400); // let the theme and stat-card styles finish (axe samples computed colours)
  await settleForAxe(page);
  expect(await page.locator("body").innerText()).not.toContain("MISSING_MESSAGE");
  await expectFullWidthShell(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: "disabled" });
  const run = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  let result = await run();
  // The stat cards (shared, unchanged) fade their figures in once per visit; a contrast reading taken mid-fade is not a finding, so read again once.
  if (result.violations.length && result.violations.every((violation) => violation.id === "color-contrast")) { await page.waitForTimeout(1500); result = await run(); }
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), name).toEqual([]);
}
async function api(page: Page, method: "get" | "post" | "put" | "patch", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
const ready = (page: Page) => async () => { await expect(page.getByTestId("reports-page")).toHaveAttribute("data-ready", "true"); };

test("CRM reports follow-ups: time zone, stage movement and export", async ({ page, browser }) => {
  test.setTimeout(600_000);
  await mkdir(evidence, { recursive: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signIn(page);

  // A ministry made in the browser takes the browser's time zone; one made through the API with no zone reads UTC.
  await page.goto("/workspaces");
  await page.getByLabel("Ministry name").fill("Harvest follow-ups browser ministry");
  await page.getByRole("radio", { name: "Church", exact: true }).check();
  await page.getByRole("button", { name: "Create ministry", exact: true }).click();
  await expect(page.getByText("Harvest follow-ups browser ministry", { exact: true }).first()).toBeVisible();
  const list = (await (await page.request.get("/api/workspaces")).json()) as { name: string; tenantId: string; timeZone: string }[];
  const created = list.find((item) => item.name === "Harvest follow-ups browser ministry")!;
  expect(created.timeZone).toBe("Pacific/Auckland");
  const plain = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest follow-ups API ministry" });
  expect(plain.status).toBe(201);
  expect(plain.body.timeZone).toBe("UTC");
  const tenantId = created.tenantId, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;

  const memberContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const member = await memberContext.newPage();
  const memberEmail = await signIn(member);
  const viewerContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const viewer = await viewerContext.newPage();
  const viewerEmail = await signIn(viewer);
  expect((await api(page, "put", `${apiRoot}/members`, { email: memberEmail, role: "member" })).status).toBe(200);
  expect((await api(page, "put", `${apiRoot}/members`, { email: viewerEmail, role: "viewer" })).status).toBe(200);

  // Seed: six deals, five moved from the first stage to the second (a count that is not small), one left where it is.
  const company = (await api(page, "post", `${apiRoot}/companies`, { name: "Synthetic Hope Chapel" })).body.id as string;
  const stages = (await api(page, "get", `${apiRoot}/crm/pipelines`)).body[0].stages as { id: string; name: string }[];
  for (let n = 0; n < 6; n++) {
    const deal = await api(page, "post", `${apiRoot}/crm/deals`, { name: `Synthetic deal ${n}`, companyId: company, stageId: stages[0]!.id });
    expect(deal.status).toBe(201);
    if (n < 5) expect((await api(page, "post", `${apiRoot}/crm/deals/${deal.body.id}/move`, { stageId: stages[1]!.id, version: deal.body.version })).status).toBe(200);
  }

  // Owner: the footer names the ministry zone, the stage card carries every figure, and each table has a CSV.
  await page.goto(`${root}/crm/reports`);
  await ready(page)();
  await expect(page.getByTestId("report-footer")).toContainText("Times are in Pacific/Auckland");
  await expect(page.getByTestId("report-footer")).not.toContainText("Times are in UTC");
  await expect(page.getByTestId("report-stages-tracked")).toContainText("Movement is tracked from");
  const firstStep = page.getByTestId("report-table-stages").getByRole("row").filter({ hasText: `${stages[0]!.name} → ${stages[1]!.name}` });
  await expect(firstStep.getByTestId("report-value")).toHaveText("5");
  await expect(firstStep.getByRole("cell").last()).toHaveText(/^\d/);
  for (const table of ["deals", "tasks", "sources", "stages"]) await expect(page.getByTestId(`report-export-${table}`)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("report-export-stages").click()]);
  expect(download.suggestedFilename()).toMatch(/^crm-report-stages-last30-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = (await (await page.request.get(`${apiRoot}/crm/reports/export?table=stages&period=last30`)).text()).replace(/^﻿/, "");
  expect(csv.split("\r\n")[0]).toBe("Period start,Period end,Time zone,Pipeline,From stage,To stage,Moved,Median days in stage");
  expect(csv).toContain(`Pacific/Auckland`);
  expect(csv).not.toMatch(/Synthetic|@example/);
  const deals = await page.request.get(`${apiRoot}/crm/reports/export?table=deals&period=last7`);
  expect(deals.status()).toBe(200);
  expect(deals.headers()["content-type"]).toContain("text/csv");
  for (const [width, height] of [[1280, 900], [768, 1024], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `reports-owner-${width}-${mode}`, ready(page)); }
  }
  await setMode(page, "light");
  await page.setViewportSize({ width: 360, height: 800 });
  expect((await page.getByTestId("report-export-stages").boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Settings: the zone is a field of Ministry settings for owners and admins.
  await page.goto(`${root}/settings`);
  const zone = page.getByRole("combobox", { name: /Time zone/ });
  await expect(zone).toContainText("Pacific/Auckland");
  await expect(zone).toContainText(/UTC\+1[23]/); // local time and offset are shown
  await zone.click();
  await page.getByPlaceholder("Search time zones").fill("New York");
  await page.getByRole("option", { name: /New York/ }).click();
  await expect(zone).toContainText("America/New_York");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Ministry settings saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: /Time zone/ })).toContainText("America/New_York");
  for (const [width, height] of [[1280, 900], [768, 1024], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `settings-owner-${width}-${mode}`, async () => { await expect(page.getByRole("combobox", { name: /Time zone/ })).toBeVisible(); }); }
  }
  await setMode(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${root}/crm/reports`);
  await ready(page)();
  await expect(page.getByTestId("report-footer")).toContainText("Times are in America/New_York");
  expect((await api(page, "patch", `${apiRoot}/time-zone`, { timeZone: "Mars/Olympus" })).status).toBe(400);
  expect((await api(page, "patch", `${apiRoot}/time-zone`, { timeZone: "EST" })).status).toBe(400);

  // Member: own work, no stage card, no export button, and the route refuses.
  await member.goto(`${root}/crm/reports`);
  await ready(member)();
  await expect(member.getByTestId("report-card-stages")).toHaveCount(0);
  for (const table of ["deals", "tasks", "sources", "stages"]) await expect(member.getByTestId(`report-export-${table}`)).toHaveCount(0);
  expect((await api(member, "get", `${apiRoot}/crm/reports/export?table=deals`)).status).toBe(403);
  expect((await api(member, "patch", `${apiRoot}/time-zone`, { timeZone: "UTC" })).status).toBe(403);
  // Viewer: sees the zone, cannot change it, no export.
  await viewer.goto(`${root}/settings`);
  await expect(viewer.getByRole("combobox", { name: /Time zone/ })).toBeDisabled();
  expect((await api(viewer, "get", `${apiRoot}/crm/reports/export?table=deals`)).status).toBe(403);
  expect((await api(viewer, "patch", `${apiRoot}/time-zone`, { timeZone: "UTC" })).status).toBe(403);
  expect(pageErrors).toEqual([]);
  await memberContext.close(); await viewerContext.close();
});
