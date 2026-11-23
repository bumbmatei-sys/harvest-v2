import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// CRM due and overdue notifications: bell list, once-only items, per-kind preference toggle,
// axe and overflow at 360, 768 and 1280 in light and dark. Run with and without HARVEST_SHELL_MODES=disabled.
const expect = baseExpect.configure({ timeout: 20_000 });
const evidence = "docs/screenshots/crm-notifications";
test.use({ reducedMotion: "reduce", actionTimeout: 20_000, navigationTimeout: 60_000 });

async function api(page: Page, method: "get" | "post" | "put", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") === mode) return;
  await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

test("due and overdue notices appear once, can be switched off per kind, and pass axe", async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest notifications workspace" });
  expect(workspace.status).toBe(201);
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
  const listed = (await api(page, "get", `${apiRoot}/crm/tasks?assignee=any`)).body as { members: { id: string }[] };
  const assignee = listed.members[0].id;
  expect((await api(page, "post", `${apiRoot}/crm/tasks`, { title: "Synthetic call about the tent", assigneeUserId: assignee, dueAt: ago(0.2) })).status).toBe(201);
  expect((await api(page, "post", `${apiRoot}/crm/tasks`, { title: "Synthetic send the welcome pack", assigneeUserId: assignee, dueAt: ago(6) })).status).toBe(201);

  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const ready = page.waitForResponse((response) => response.url().includes("/crm/notifications") && response.request().method() === "GET");
    await page.goto(`${root}/crm/tasks`); await ready;
    for (const mode of ["light", "dark"] as const) {
      await setMode(page, mode);
      await page.getByRole("button", { name: /^Notifications/ }).click();
      const popover = page.getByRole("dialog", { name: "Notifications" });
      await expect(popover.getByText("is due")).toBeVisible();
      await expect(popover.getByText("is overdue")).toBeVisible();
      await expect(popover.getByRole("switch", { name: "Task due" })).toBeChecked();
      const box = await popover.getByRole("switch", { name: "Task due" }).locator("xpath=ancestor::label").boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `${evidence}/bell-${width}-${mode}.png`, animations: "disabled" });
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), `${width} ${mode}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await page.keyboard.press("Escape");
    }
  }

  // Once only: reloading does not add notices. Turning a kind off hides it; turning it on shows it again.
  await page.goto(`${root}/crm/tasks`);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const popover = page.getByRole("dialog", { name: "Notifications" });
  await expect(popover.getByText("is overdue")).toHaveCount(1);
  await expect(popover.getByText("is due")).toHaveCount(1);
  await popover.getByRole("switch", { name: "Task overdue" }).click();
  await expect(popover.getByText("is overdue")).toHaveCount(0);
  await expect(popover.getByText("is due")).toHaveCount(1);
  await popover.getByRole("switch", { name: "Task overdue" }).click();
  await expect(popover.getByText("is overdue")).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});
