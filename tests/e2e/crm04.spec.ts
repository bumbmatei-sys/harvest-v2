import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";

// CRM-04 browser proof: pipelines, deals, Kanban moves (pointer and keyboard), list,
// deal detail, related deals, pipeline settings, responsive board and isolation.
const expect = baseExpect.configure({ timeout: 20_000 });
const evidence = "docs/screenshots/crm04";
test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/Berlin", actionTimeout: 20_000, navigationTimeout: 60_000 });

async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") === mode) return;
  const toggle = page.getByRole("button", { name: new RegExp(`^Switch to ${mode}`) }).first();
  if (await toggle.isVisible()) await toggle.click();
  else { await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode); await page.reload(); }
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator("body").innerText()).not.toContain("MISSING_MESSAGE");
  const size = page.viewportSize()!;
  const overflow = await page.evaluate(() => { const main = document.querySelector("main"); return main ? main.scrollHeight - main.clientHeight : 0; });
  if (overflow > 0) await page.setViewportSize({ width: size.width, height: size.height + overflow });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: "disabled" });
  if (overflow > 0) await page.setViewportSize(size);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), name).toEqual([]);
}
async function both(page: Page, name: string) {
  for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `${name}-${mode}`); }
  await setMode(page, "light");
}
async function api(page: Page, method: "get" | "post" | "put" | "patch", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
/**
 * The board scrolls its columns sideways by design. Everything else keeps the
 * full-width shell contract: no page overflow, nothing outside the content edge
 * except inside the board's own scroller, and the shell gutters unchanged.
 */
async function expectBoardShell(page: Page) {
  const metrics = await page.evaluate(() => {
    const content = document.querySelector("[data-shell-content]")!, main = document.querySelector("main#main-content")!;
    const board = document.querySelector('[role="region"][aria-label="Deals board"]');
    const right = content.getBoundingClientRect().right;
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth, mainScroll: main.scrollWidth - main.clientWidth,
      maxWidth: getComputedStyle(content).maxWidth,
      clipped: [...content.querySelectorAll("*")].filter((element) => !board?.contains(element) && element !== board && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().right > right + 1).length,
      boardInside: board ? board.getBoundingClientRect().right <= right + 1 : null, boardScrolls: board ? board.scrollWidth > board.clientWidth : null,
    };
  });
  expect(metrics.maxWidth).toBe("none");
  expect(metrics.overflow).toBeLessThanOrEqual(0);
  expect(metrics.mainScroll).toBeLessThanOrEqual(1);
  expect(metrics.clipped).toBe(0);
  expect(metrics.boardInside).toBe(true);
  return metrics;
}
const column = (page: Page, stage: string) => page.getByRole("region", { name: "Deals board" }).locator("[data-board-column]").filter({ has: page.getByRole("heading", { name: stage, exact: true }) });
const card = (page: Page, deal: string) => page.locator("[data-deal-card]").filter({ hasText: deal });

test("CRM-04: pipelines, deals, board moves, list, deal detail, related deals, settings and isolation", async ({ page, browser }) => {
  test.setTimeout(480_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { name: "Harvest CRM-04 browser workspace" });
  expect(workspace.status).toBe(201);
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
  const company = (await api(page, "post", `${apiRoot}/companies`, { name: "Synthetic Grace Chapel", domain: "grace-chapel.example" })).body.id as string;
  const person = (await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Abigail Stone", email: "abigail@example.test", companyId: company })).body.id as string;

  // First visit by a writer sets up the default pipeline; the empty board is its own state.
  await page.goto(`${root}/crm/people`);
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Pipelines" }).click();
  await expect(page).toHaveURL(`${root}/crm/pipelines`);
  await expect(page.getByRole("heading", { name: "No deals yet" })).toBeVisible();

  // Create a deal through the dialog, linked to a company picked from the workspace.
  await page.getByRole("button", { name: "New deal" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Deal name").fill("Synthetic roof appeal");
  await dialog.getByLabel("Amount (USD)").fill("12000");
  await dialog.getByRole("button", { name: "Choose company" }).click();
  await page.getByPlaceholder("Search companies").fill("Grace");
  await page.getByRole("option", { name: /Synthetic Grace Chapel/ }).click();
  await expect(dialog.getByText("Synthetic Grace Chapel")).toBeVisible();
  await capture(page, "deal-create-dialog-light");
  await dialog.getByRole("button", { name: "Create deal" }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, "Synthetic roof appeal")).toBeVisible();
  await expect(column(page, "New").locator("[data-deal-card]")).toHaveCount(1);

  // More deals through the API: one stale (open, past close date) and one in Proposal.
  const pipelines = (await api(page, "get", `${apiRoot}/crm/pipelines`)).body as { id: string; stages: { id: string; key: string }[] }[];
  const stageId = (key: string) => pipelines[0].stages.find((stage) => stage.key === key)!.id;
  expect((await api(page, "post", `${apiRoot}/crm/deals`, { name: "Synthetic youth camp sponsor", contactId: person, amount: "4000", stageId: stageId("qualified"), expectedCloseDate: "2026-01-15" })).status).toBe(201);
  expect((await api(page, "post", `${apiRoot}/crm/deals`, { name: "Synthetic hall rental", companyId: company, amount: "2500", stageId: stageId("proposal") })).status).toBe(201);
  await page.reload();
  await expect(card(page, "Synthetic youth camp sponsor").getByText("Stale")).toBeVisible();
  await expect(page.getByText("1 stale deal")).toBeVisible();
  // Open value 18,500; weighted 12,000 × 10% + 4,000 × 50% + 2,500 × 75% = 5,075.
  await expect(page.getByText("Open $18,500")).toBeVisible();
  await expect(page.getByText("Weighted $5,075")).toBeVisible();
  await both(page, "board");

  // Pointer drag: New → Contacted, persisted once; a reload shows it.
  const source = card(page, "Synthetic roof appeal"), target = column(page, "Contacted");
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!;
  const moved = page.waitForResponse((response) => response.url().endsWith("/move") && response.request().method() === "POST");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 12 });
  await page.mouse.up();
  expect((await moved).status()).toBe(200);
  await page.reload();
  await expect(column(page, "Contacted").getByText("Synthetic roof appeal")).toBeVisible();
  await expect(column(page, "New").locator("[data-deal-card]")).toHaveCount(0);

  // Keyboard: Shift+→ moves the focused card one stage; reload preserves it.
  await card(page, "Synthetic roof appeal").focus();
  const keyMove = page.waitForResponse((response) => response.url().endsWith("/move"));
  await page.keyboard.press("Shift+ArrowRight");
  expect((await keyMove).status()).toBe(200);
  await expect(page.getByText("Synthetic roof appeal moved to Qualified.")).toBeAttached();
  await page.reload();
  await expect(column(page, "Qualified").getByText("Synthetic roof appeal")).toBeVisible();
  // Closing asks for an optional reason: Proposal → Won by keyboard.
  await card(page, "Synthetic hall rental").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("dialog").getByLabel(/Reason/).fill("Signed after the open day");
  await page.getByRole("dialog").getByRole("button", { name: "Move deal" }).click();
  await expect(column(page, "Won").getByText("Synthetic hall rental")).toBeVisible();
  await page.reload();
  await expect(column(page, "Won").getByText("Synthetic hall rental")).toBeVisible();
  const moves = await page.request.get(`${apiRoot}/crm/deals?mode=list`).then((response) => response.json());
  expect(moves.deals.find((deal: { name: string }) => deal.name === "Synthetic roof appeal").version).toBe(3);

  // List mode is URL state over the same query; filters keep empty-vs-no-match distinct.
  await page.getByRole("button", { name: "List" }).click();
  await expect(page).toHaveURL(/mode=list/);
  await expect(page.getByRole("table", { name: "Deals" }).getByRole("row")).toHaveCount(4);
  await page.getByRole("button", { name: "Stale only" }).click();
  await expect(page.getByRole("table", { name: "Deals" }).getByRole("row")).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Search deals" }).fill("nothing-like-this");
  await page.getByRole("searchbox", { name: "Search deals" }).press("Enter");
  await expect(page.getByRole("heading", { name: "No matching deals" })).toBeVisible();
  await page.getByRole("link", { name: "Reset filters" }).click();
  await expect(page.getByRole("table", { name: "Deals" }).getByRole("row")).toHaveCount(4);
  await both(page, "list");

  // Deal detail: edit the amount inline, see the stage history from the ledger.
  await page.getByRole("link", { name: "Synthetic roof appeal" }).click();
  await expect(page.getByRole("heading", { name: "Synthetic roof appeal" })).toBeVisible();
  const dealId = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Edit Amount (USD): $12,000.00" }).click();
  await page.getByRole("textbox", { name: "Amount (USD)" }).fill("15000");
  await page.getByRole("textbox", { name: "Amount (USD)" }).press("Enter");
  await expect(page.getByRole("button", { name: "Edit Amount (USD): $15,000.00" })).toBeVisible();
  await expect(page.getByText(/moved it from New to Contacted/)).toBeVisible();
  await expect(page.getByText(/moved it from Contacted to Qualified/)).toBeVisible();
  await both(page, "deal-detail");

  // Related deals on the company (and the person).
  await page.goto(`${root}/crm/companies/${company}`);
  const related = page.getByRole("list", { name: "Deals" });
  await expect(related.getByRole("link", { name: "Synthetic roof appeal" })).toBeVisible();
  await expect(related.getByRole("link", { name: "Synthetic hall rental" })).toBeVisible();
  await capture(page, "company-related-deals-light");
  await page.goto(`${root}/crm/people/${person}`);
  await expect(page.getByRole("list", { name: "Deals" }).getByRole("link", { name: "Synthetic youth camp sponsor" })).toBeVisible();

  // Pipeline settings: reorder a stage, and see it hold after a reload and on the board.
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Pipeline settings" }).click();
  await expect(page).toHaveURL(`${root}/crm/settings/pipelines`);
  const stages = page.getByRole("table", { name: "Stages of Pipeline" });
  await stages.getByRole("button", { name: "Move Proposal up" }).click();
  await expect(stages.getByRole("row").nth(3)).toContainText("Proposal");
  await page.reload();
  await expect(page.getByRole("table", { name: "Stages of Pipeline" }).getByRole("row").nth(3)).toContainText("Proposal");
  // A stage that still has deals cannot be archived.
  await page.getByRole("table", { name: "Stages of Pipeline" }).getByRole("button", { name: "Actions for Qualified" }).click();
  await page.getByRole("menuitem", { name: "Archive stage" }).click();
  await expect(page.getByText("Move the deals out of this stage before archiving it.")).toBeVisible();
  await both(page, "pipeline-settings");
  await page.goto(`${root}/crm/pipelines`);
  await expect(page.getByRole("region", { name: "Deals board" }).getByRole("heading")).toHaveText(["New", "Contacted", "Proposal", "Qualified", "Won", "Lost"]);

  // Responsive: tablet with the sidebar expanded, and a phone. The board scrolls inside itself only.
  for (const viewport of [{ width: 320, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await page.context().addCookies([{ name: "sidebar_state", value: "true", url: origin }]);
    await page.goto(`${root}/crm/pipelines`);
    await expect(page.getByRole("region", { name: "Deals board" })).toBeVisible();
    if (viewport.width >= 1024) await expect(page.locator('[data-slot="sidebar"][data-state="expanded"]')).toBeVisible();
    expect((await expectBoardShell(page)).boardScrolls).toBe(true);
    await capture(page, `board-${viewport.width}-light`);
    await page.goto(`${root}/crm/pipelines?mode=list`);
    await expect(page.getByRole("table", { name: "Deals" })).toBeVisible();
    await expectFullWidthShell(page);
    await page.goto(`${root}/crm/settings/pipelines`);
    await expect(page.getByRole("table", { name: "Stages of Pipeline" })).toBeVisible();
    await expectFullWidthShell(page);
    await page.goto(`${root}/crm/deals/${dealId}`);
    await expect(page.getByRole("heading", { name: "Synthetic roof appeal" })).toBeVisible();
    await expectFullWidthShell(page);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // A second account: two-way isolation over HTTP, then viewer access in A.
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const other = await otherContext.newPage();
  const otherEmail = await signIn(other);
  const own = (await api(other, "post", "/api/workspaces", { name: `CRM-04 second tenant ${randomUUID().slice(0, 8)}` })).body.tenantId as string;
  const otherCompany = (await api(other, "post", `/api/workspaces/${own}/companies`, { name: "Synthetic Other Org" })).body.id as string;
  const dealB = (await api(other, "post", `/api/workspaces/${own}/crm/deals`, { name: "B deal", companyId: otherCompany })).body as { id: string; version: number };
  const dealA = moves.deals[0] as { id: string; version: number };
  expect((await api(other, "get", `${apiRoot}/crm/deals/${dealA.id}`)).status).toBe(403);
  expect((await api(other, "get", `/api/workspaces/${own}/crm/deals/${dealA.id}`)).status).toBe(404);
  expect((await api(other, "post", `/api/workspaces/${own}/crm/deals/${dealA.id}/move`, { stageId: stageId("won"), version: dealA.version })).status).toBe(404);
  expect((await api(other, "post", `/api/workspaces/${own}/crm/deals`, { name: "Cross", companyId: company })).status).toBe(404);
  expect((await api(page, "get", `/api/workspaces/${own}/crm/deals/${dealB.id}`)).status).toBe(403);
  expect((await api(page, "get", `${apiRoot}/crm/deals/${dealB.id}`)).status).toBe(404);
  expect((await api(page, "patch", `${apiRoot}/crm/deals/${dealB.id}`, { name: "Hijack", version: dealB.version })).status).toBe(404);
  // Viewer in A: reads the board, cannot create, move or change settings.
  expect((await api(page, "put", `${apiRoot}/members`, { email: otherEmail, role: "viewer" })).status).toBe(200);
  await other.goto(`${root}/crm/pipelines`);
  await expect(other.getByText("You have view-only access. Ask a workspace owner, admin or member to add or move deals.")).toBeVisible();
  await expect(other.getByRole("button", { name: "New deal" })).toHaveCount(0);
  await expect(other.locator("[data-deal-card]")).toHaveCount(3);
  await capture(other, "board-viewer-light");
  expect((await api(other, "post", `${apiRoot}/crm/deals/${dealA.id}/move`, { stageId: stageId("won"), version: dealA.version })).status).toBe(403);
  expect((await api(other, "post", `${apiRoot}/crm/deals`, { name: "Denied", companyId: company })).status).toBe(403);
  expect((await api(other, "post", `${apiRoot}/crm/pipelines`, { name: "Denied" })).status).toBe(403);
  await other.goto(`${root}/crm/settings/pipelines`);
  await expect(other.getByText("Only workspace owners and admins can change pipelines and stages.")).toBeVisible();
  await expect(other.getByRole("button", { name: "Add stage" })).toHaveCount(0);
  await otherContext.close();
  expect(pageErrors).toEqual([]);
});
