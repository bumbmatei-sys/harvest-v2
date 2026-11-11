import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";

// CRM-05 browser proof: follow-up task from a deal, my tasks, keyboard completion,
// unified timeline (task + note + audit), person note after reload, notifications,
// viewer limits, HTTP isolation, and phone/tablet layout.
const expect = baseExpect.configure({ timeout: 20_000 });
const evidence = "docs/screenshots/crm05";
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
/** Navigate and wait for the header bell's first fetch: it runs in an effect, so the page has hydrated. */
async function gotoHydrated(page: Page, url: string) {
  const ready = page.waitForResponse((response) => response.url().includes("/crm/notifications") && response.request().method() === "GET");
  await page.goto(url); await ready;
}
async function both(page: Page, name: string) {
  for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `${name}-${mode}`); }
  await setMode(page, "light");
}
async function api(page: Page, method: "get" | "post" | "put" | "patch", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
/** Tomorrow at 10:00 in Berlin, as a datetime-local value. */
function tomorrowAtTen() {
  const day = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
  return `${day}T10:00`;
}

test("CRM-05: follow-up task from a deal, my tasks, completion, notes and the unified timeline", async ({ page, browser }) => {
  test.setTimeout(420_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest CRM-05 browser workspace" });
  expect(workspace.status).toBe(201);
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
  const company = (await api(page, "post", `${apiRoot}/companies`, { name: "Synthetic Hope Chapel" })).body.id as string;
  const person = (await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Lois Grant", email: "lois@example.test", companyId: company })).body.id as string;
  expect((await api(page, "get", `${apiRoot}/crm/pipelines`)).status).toBe(200);
  const deal = (await api(page, "post", `${apiRoot}/crm/deals`, { name: "Synthetic building fund", companyId: company, contactId: person, amount: "5000" })).body.id as string;

  // From the deal, add a follow-up assigned to me (the default) with a due date.
  await gotoHydrated(page, `${root}/crm/deals/${deal}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Synthetic building fund")).toBeVisible();
  await dialog.getByLabel("Title").fill("Synthetic follow-up call");
  await dialog.getByLabel("Due").fill(tomorrowAtTen());
  await dialog.getByLabel("Priority").selectOption("high");
  await capture(page, "task-dialog-light");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
  const related = page.getByRole("list", { name: "Tasks for Synthetic building fund" });
  await expect(related.getByText("Synthetic follow-up call")).toBeVisible();
  await expect(related.getByText("Assigned to you")).toBeVisible();
  await both(page, "deal-task-on-record");

  // My tasks: the sidebar entry opens "assigned to me, open".
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Tasks" }).click();
  await expect(page).toHaveURL(`${root}/crm/tasks`);
  const list = page.getByRole("list", { name: "Tasks" });
  await expect(list.getByText("Synthetic follow-up call")).toBeVisible();
  await expect(list.getByRole("link", { name: "Synthetic building fund" })).toBeVisible();
  await both(page, "tasks-list");

  // Complete it from the keyboard (Space on the checkbox); it leaves the open list.
  const check = page.getByRole("checkbox", { name: "Mark Synthetic follow-up call as done" });
  await check.focus();
  const completed = page.waitForResponse((response) => response.url().includes("/crm/tasks/") && response.request().method() === "PATCH");
  await page.keyboard.press("Space");
  expect((await completed).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Nothing assigned to you" })).toBeVisible();
  await page.getByLabel("Filter by status").selectOption("done");
  await expect(page.getByRole("checkbox", { name: "Reopen Synthetic follow-up call" })).toBeChecked();

  // A note on the deal, typed and saved from the keyboard (Ctrl+Enter).
  await gotoHydrated(page, `${root}/crm/deals/${deal}`);
  await page.getByLabel("New note").focus();
  await page.keyboard.type("Synthetic: board approved the match.");
  await page.keyboard.press("Control+Enter");
  const timeline = page.getByRole("list", { name: "Timeline" });
  await expect(timeline.getByText("Synthetic: board approved the match.")).toBeVisible();
  await expect(timeline.getByText(/completed Synthetic follow-up call/)).toBeVisible();
  await expect(timeline.getByText(/added task Synthetic follow-up call/)).toBeVisible();
  await expect(timeline.getByText(/created this deal in New/)).toBeVisible();
  await both(page, "deal-timeline");

  // A note on the person survives a reload and sits in the person's timeline with the task history.
  await gotoHydrated(page, `${root}/crm/people/${person}`);
  await page.getByLabel("New note").fill("Synthetic: prefers a call after the service.\nAsk about the youth trip.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("list", { name: "Timeline" }).getByText(/prefers a call after the service/)).toBeVisible();
  await page.reload();
  const personTimeline = page.getByRole("list", { name: "Timeline" });
  await expect(personTimeline.getByText(/Ask about the youth trip/)).toBeVisible();
  await expect(personTimeline.getByText(/completed Synthetic follow-up call/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Tasks for Synthetic Lois Grant" }).getByText("Synthetic follow-up call")).toBeVisible();
  await both(page, "person-timeline");

  // A deleted note leaves a "deleted a note" event and never its text; the prior note stays visible.
  const temp = (await api(page, "post", `${apiRoot}/crm/notes`, { target: "person", targetId: person, body: "Synthetic: temporary note to delete" })).body as { id: string; version: number };
  expect((await api(page, "patch", `${apiRoot}/crm/notes/${temp.id}`, { archived: true, version: temp.version })).status).toBe(200);
  await page.reload();
  await expect(personTimeline.getByText(/deleted a note/)).toBeVisible();
  await expect(page.getByText("temporary note to delete")).toHaveCount(0);
  await expect(personTimeline.getByText(/prefers a call after the service/)).toBeVisible();

  // A second account: isolation over HTTP first, then a member who assigns me a task.
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const other = await otherContext.newPage();
  const otherEmail = await signIn(other);
  const own = (await api(other, "post", "/api/workspaces", { audience: "church", name: `CRM-05 second tenant ${randomUUID().slice(0, 8)}` })).body.tenantId as string;
  const otherTask = (await api(other, "post", `/api/workspaces/${own}/crm/tasks`, { title: "B task" })).body.id as string;
  const myTask = (await api(page, "get", `${apiRoot}/crm/tasks?status=all`)).body.tasks[0] as { id: string; version: number; assigneeUserId: string };
  expect((await api(other, "get", `${apiRoot}/crm/tasks/${myTask.id}`)).status).toBe(403);
  expect((await api(other, "get", `/api/workspaces/${own}/crm/tasks/${myTask.id}`)).status).toBe(404);
  expect((await api(other, "get", `/api/workspaces/${own}/contacts/${person}/timeline`)).status).toBe(404);
  expect((await api(other, "post", `/api/workspaces/${own}/crm/notes`, { target: "person", targetId: person, body: "Cross" })).status).toBe(404);
  expect((await api(page, "get", `/api/workspaces/${own}/crm/tasks/${otherTask}`)).status).toBe(403);
  expect((await api(page, "get", `${apiRoot}/crm/tasks/${otherTask}`)).status).toBe(404);
  expect((await api(page, "patch", `${apiRoot}/crm/tasks/${otherTask}`, { title: "Hijack", version: 1 })).status).toBe(404);
  expect((await api(page, "put", `${apiRoot}/members`, { email: otherEmail, role: "member" })).status).toBe(200);
  const me = { id: myTask.assigneeUserId };
  expect((await api(other, "post", `${apiRoot}/crm/tasks`, { title: "Synthetic prepare the welcome pack", assigneeUserId: me.id, contactId: person, dueAt: tomorrowAtTen() })).status).toBe(201);
  await page.goto(`${root}/crm/tasks`);
  await page.getByRole("button", { name: "Notifications, 1 unread" }).click();
  const popover = page.getByRole("dialog");
  await expect(popover.getByText(/assigned you/)).toBeVisible();
  await expect(popover.getByText("Synthetic prepare the welcome pack")).toBeVisible();
  await capture(page, "notifications-light");
  await popover.getByRole("button", { name: "Mark all read" }).click();
  await expect(popover.getByText("Unread")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Tasks" }).getByText("Synthetic prepare the welcome pack")).toBeVisible();

  // Viewer: reads tasks and timelines; cannot add, complete or write notes.
  expect((await api(page, "put", `${apiRoot}/members`, { email: otherEmail, role: "viewer" })).status).toBe(200);
  await other.goto(`${root}/crm/tasks?assignee=any&status=all`);
  await expect(other.getByText("You have view-only access. Ask a workspace owner, admin or member to add or complete tasks.")).toBeVisible();
  await expect(other.getByRole("button", { name: "Add task" })).toHaveCount(0);
  await expect(other.getByRole("checkbox").first()).toBeDisabled();
  await capture(other, "tasks-viewer-light");
  const latest = (await api(page, "get", `${apiRoot}/crm/tasks/${myTask.id}`)).body as { version: number };
  expect((await api(other, "patch", `${apiRoot}/crm/tasks/${myTask.id}`, { status: "open", version: latest.version })).status).toBe(403);
  expect((await api(other, "post", `${apiRoot}/crm/tasks`, { title: "Denied" })).status).toBe(403);
  expect((await api(other, "post", `${apiRoot}/crm/notes`, { target: "person", targetId: person, body: "Denied" })).status).toBe(403);
  await other.goto(`${root}/crm/people/${person}`);
  await expect(other.getByRole("list", { name: "Timeline" }).getByText(/Ask about the youth trip/)).toBeVisible();
  await expect(other.getByLabel("New note")).toHaveCount(0);
  await otherContext.close();

  // Layout: tasks list and record timeline on a phone and on a tablet with the sidebar expanded.
  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.context().addCookies([{ name: "sidebar_state", value: "true", url: origin }]);
    await page.goto(`${root}/crm/tasks?assignee=any&status=all`);
    await expect(page.getByRole("list", { name: "Tasks" })).toBeVisible();
    if (viewport.width >= 1024) await expect(page.locator('[data-slot="sidebar"][data-state="expanded"]')).toBeVisible();
    await expectFullWidthShell(page);
    await capture(page, `tasks-${viewport.width}-light`);
    await page.goto(`${root}/crm/people/${person}`);
    await expect(page.getByRole("list", { name: "Timeline" })).toBeVisible();
    await expectFullWidthShell(page);
    await page.goto(`${root}/crm/deals/${deal}`);
    await expect(page.getByRole("list", { name: "Timeline" })).toBeVisible();
    await expectFullWidthShell(page);
  }
  // An archived deal takes no new tasks or notes (409 parent_archived) and shows no composers; restoring it reopens both.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const dealVersion = async () => (await api(page, "get", `${apiRoot}/crm/deals/${deal}`)).body.deal.version as number;
  expect((await api(page, "patch", `${apiRoot}/crm/deals/${deal}`, { archived: true, version: await dealVersion() })).status).toBe(200);
  for (const [path, body] of [["crm/tasks", { title: "Synthetic after archive", opportunityId: deal }], ["crm/notes", { target: "deal", targetId: deal, body: "After archive" }]] as const) {
    const refused = await api(page, "post", `${apiRoot}/${path}`, body);
    expect(refused.status).toBe(409);
    expect(refused.body.details).toEqual({ reason: "parent_archived" });
  }
  await gotoHydrated(page, `${root}/crm/deals/${deal}`);
  await expect(page.getByText("This deal is archived", { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel("New note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Timeline" }).getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Synthetic follow-up call" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Reopen Synthetic follow-up call" })).toBeDisabled();
  await capture(page, "deal-archived-light");
  expect((await api(page, "patch", `${apiRoot}/crm/deals/${deal}`, { archived: false, version: await dealVersion() })).status).toBe(200);
  expect((await api(page, "post", `${apiRoot}/crm/tasks`, { title: "Synthetic after restore", opportunityId: deal })).status).toBe(201);
  expect((await api(page, "post", `${apiRoot}/crm/notes`, { target: "deal", targetId: deal, body: "After restore" })).status).toBe(201);
  expect(pageErrors).toEqual([]);
});
