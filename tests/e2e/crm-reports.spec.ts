import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";
import { settleForAxe } from "./helpers/settle";

// CRM reports browser proof: figures from seeded data, role scopes, period switching by keyboard, the "fewer than 5" display, access denial,
// and axe plus overflow checks at 360, 768 and 1280 in light and dark. Run it with and without HARVEST_SHELL_MODES=disabled.
const expect = baseExpect.configure({ timeout: 20_000 });
const evidence = "docs/screenshots/crm-reports";
test.use({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 }, actionTimeout: 20_000, navigationTimeout: 60_000 });

async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") === mode) return;
  await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}
async function settled(page: Page) {
  await expect(page.getByTestId("reports-page")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => document.fonts.ready);
  await settleForAxe(page);
}
async function capture(page: Page, name: string) {
  await settled(page);
  expect(await page.locator("body").innerText()).not.toContain("MISSING_MESSAGE");
  await expectFullWidthShell(page);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: "disabled" });
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  // Each node carries axe's measured data (for color-contrast: fgColor, bgColor and ratio), so a CI failure says what was compared.
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => `${node.target.join(" ")} ${JSON.stringify(node.any.map((check) => check.data))}`).join(", ")}`), name).toEqual([]);
}
async function api(page: Page, method: "get" | "post" | "put" | "patch", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
const stat = (page: Page, metric: string) => page.locator(`[data-testid="report-stat"][data-metric="${metric}"]`);

test("CRM reports: owner totals, member scope, periods, suppression and access", async ({ page, browser }) => {
  test.setTimeout(600_000);
  await mkdir(evidence, { recursive: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest reports browser ministry" });
  expect(workspace.status).toBe(201);
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;

  const memberContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const member = await memberContext.newPage();
  const memberEmail = await signIn(member);
  const memberId = (await (await member.request.get("/api/auth/get-session")).json()).user.id as string;
  const viewerContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const viewer = await viewerContext.newPage();
  const viewerEmail = await signIn(viewer);
  expect((await api(page, "put", `${apiRoot}/members`, { email: memberEmail, role: "member" })).status).toBe(200);
  expect((await api(page, "put", `${apiRoot}/members`, { email: viewerEmail, role: "viewer" })).status).toBe(200);

  // Seed: 6 deals (3 owned by the member), 6 open tasks (due later), 5 completed tasks and 6 people, all synthetic.
  const company = (await api(page, "post", `${apiRoot}/companies`, { name: "Synthetic Hope Chapel" })).body.id as string;
  expect((await api(page, "get", `${apiRoot}/crm/pipelines`)).status).toBe(200);
  for (let n = 0; n < 6; n++) expect((await api(page, "post", `${apiRoot}/crm/deals`, { name: `Synthetic deal ${n}`, companyId: company, ownerUserId: n < 3 ? memberId : undefined })).status).toBe(201);
  const later = new Date(Date.now() + 14 * 86_400_000).toISOString();
  for (let n = 0; n < 6; n++) expect((await api(page, "post", `${apiRoot}/crm/tasks`, { title: `Synthetic open task ${n}`, assigneeUserId: n < 3 ? memberId : undefined, dueAt: later })).status).toBe(201);
  for (let n = 0; n < 5; n++) {
    const task = await api(page, "post", `${apiRoot}/crm/tasks`, { title: `Synthetic done task ${n}` });
    expect((await api(page, "patch", `${apiRoot}/crm/tasks/${task.body.id}`, { status: "done", version: task.body.version })).status).toBe(200);
  }
  for (let n = 0; n < 6; n++) expect((await api(page, "post", `${apiRoot}/contacts`, { name: `Synthetic person ${n}`, email: `reports${n}@example.test` })).status).toBe(201);

  // Owner: sidebar entry, ministry totals, real numbers.
  await page.goto(`${root}/crm/tasks`);
  await page.getByRole("navigation", { name: "Ministry navigation" }).getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(`${root}/crm/reports`);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1, name: /Reports/ })).toBeVisible();
  await expect(page.getByTestId("report-scope")).toHaveText("Ministry totals");
  await expect(page.getByTestId("reports-page")).toHaveAttribute("data-period", "last30");
  await expect(stat(page, "deals").getByTestId("report-value")).toHaveText("6");
  await expect(stat(page, "completed").getByTestId("report-value")).toHaveText("5");
  await expect(stat(page, "overdue").getByTestId("report-value")).toHaveText("0");
  await expect(stat(page, "contacts").getByTestId("report-value")).toHaveText("6");
  await expect(page.getByTestId("report-table-sources")).toContainText("Added by hand");
  await expect(page.getByTestId("report-footer")).toContainText("UTC");
  await expect(page.getByTestId("report-footer")).toContainText("Connect follow-up cases");
  // Unknown, CSV, Connect and Forms sources have no contacts: zero is shown as zero.
  await expect(page.getByTestId("report-table-sources").getByRole("row", { name: /Forms/ })).toContainText("0");

  // Period switch by keyboard: arrow keys move between periods and each change is one GET.
  const tab = page.getByTestId("period-last30");
  await tab.focus();
  const reads: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/crm/reports")) reads.push(`${request.method()} ${new URL(request.url()).search}`); });
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("reports-page")).toHaveAttribute("data-period", "last7");
  await settled(page);
  await expect(stat(page, "deals").getByTestId("report-value")).toHaveText("6");
  await page.getByTestId("period-lastMonth").click();
  await expect(page.getByTestId("reports-page")).toHaveAttribute("data-period", "lastMonth");
  await settled(page);
  await expect(stat(page, "deals").getByTestId("report-value")).toHaveText("0");
  await expect(stat(page, "conversion").getByTestId("report-value")).toHaveText("–");
  await expect(stat(page, "completed").getByTestId("report-value")).toHaveText("0");
  await expect(stat(page, "overdue").getByTestId("report-value")).toHaveText("0");
  await page.getByTestId("period-last30").click();
  await settled(page);
  expect(reads.every((read) => read.startsWith("GET ?period="))).toBe(true);
  expect(reads).toHaveLength(3);

  // Layout, axe and overflow: three widths, light and dark.
  for (const [width, height] of [[1280, 900], [768, 1024], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `owner-${width}-${mode}`); }
  }
  await setMode(page, "light");
  await page.setViewportSize({ width: 360, height: 800 });
  for (const period of ["last7", "last30", "last90", "thisMonth", "lastMonth"]) {
    const box = await page.getByTestId(`period-${period}`).boundingBox();
    expect(box!.height, period).toBeGreaterThanOrEqual(43.5);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Member: own work only, no contact sections, and three of six deals read "Fewer than 5".
  await member.goto(`${root}/crm/reports`);
  await settled(member);
  await expect(member.getByTestId("report-scope")).toHaveText("Your own work");
  await expect(member.getByTestId("report-card-sources")).toHaveCount(0);
  await expect(stat(member, "contacts")).toHaveCount(0);
  await expect(stat(member, "deals").getByTestId("report-hidden")).toHaveText("Fewer than 5");
  await expect(member.getByTestId("report-table-deals").getByTestId("report-hidden").first()).toBeVisible();
  await expect(stat(member, "completed").getByTestId("report-value")).toHaveText("0");
  for (const mode of ["light", "dark"] as const) { await setMode(member, mode); await capture(member, `member-suppressed-${mode}`); }
  const memberReport = await api(member, "get", `${apiRoot}/crm/reports?period=last30`);
  expect(memberReport.status).toBe(200);
  expect(memberReport.body.scope).toBe("own");
  expect(memberReport.body.deals.created).toBeNull();
  expect(memberReport.body).not.toHaveProperty("contacts");
  expect(JSON.stringify(memberReport.body)).not.toMatch(/Synthetic|@example/);

  // A ministry with nothing yet: an honest empty state, not a wall of zero charts.
  const empty = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest reports empty ministry" });
  await page.goto(`/workspaces/${empty.body.tenantId}/crm/reports`);
  await settled(page);
  await expect(page.getByRole("heading", { name: "Nothing to report in this period" })).toBeVisible();
  for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `owner-empty-${mode}`); }
  await setMode(page, "light");

  // Viewer and strangers: no link, neutral page, 403 from the route; bad period is 400.
  await viewer.goto(`${root}/crm/tasks`);
  await expect(viewer.getByRole("navigation", { name: "Ministry navigation" }).getByRole("link", { name: "Reports", exact: true })).toHaveCount(0);
  await viewer.goto(`${root}/crm/reports`);
  await expect(viewer.getByTestId("reports-page")).toHaveCount(0);
  expect((await api(viewer, "get", `${apiRoot}/crm/reports`)).status).toBe(403);
  expect((await api(page, "get", `${apiRoot}/crm/reports?period=bad`)).status).toBe(400);
  const owner = await page.request.get(`${apiRoot}/crm/reports?period=last30`);
  expect(owner.headers()["cache-control"]).toBe("private, no-store");
  expect(pageErrors).toEqual([]);
  await memberContext.close(); await viewerContext.close();
});
