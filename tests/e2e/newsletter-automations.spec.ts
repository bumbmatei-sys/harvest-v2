import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 30000 });
// Newsletter automations: list, editor (trigger, ordered steps, email content with the campaign block editor, wait, end), activate and pause, per-person activity and log,
// and stopping when consent is withdrawn. Nothing is sent here (the worker is off); delivery is covered by the integration tests with the synthetic provider.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/newsletter-automations";
const sizes = [["phone", 360, 800], ["desktop", 1280, 900]] as const;

async function shoot(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload(); await page.waitForTimeout(400);
    await prepare?.();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
      const result = await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${scheme} ${width} overflow`).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

const openActivity = (page: Page) => page.getByRole("navigation", { name: "Automation steps" }).getByRole("button", { name: /^Activity/ }).click();

test("automations: create, build steps, activate and pause, see people and their log, stop on withdrawn consent", async ({ page }) => {
  test.setTimeout(600000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.context().setExtraHTTPHeaders({});
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/newsletter`;
  const audience = (await (await page.request.post(`${api}/audiences`, { headers: { origin }, data: { name: "Everyone" } })).json()).id as string;
  const list = (await (await page.request.post(`${api}/lists`, { headers: { origin }, data: { audienceId: audience, name: "Weekly list" } })).json()).id as string;

  await page.goto(`/workspaces/${tenant}/newsletter/automations`);
  await expect(page.getByRole("heading", { name: "Automations", exact: true })).toBeVisible();
  await expect(page.getByText("No automations yet")).toBeVisible();
  if (process.env.HARVEST_SHELL_MODES !== "disabled") {
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    const links = sidebar.locator('a[href*="/newsletter/"]');
    const hrefs = await links.evaluateAll((items) => items.map((item) => (item as HTMLAnchorElement).getAttribute("href")));
    const campaigns = hrefs.findIndex((href) => href?.endsWith("/newsletter/campaigns"));
    expect(campaigns).toBeGreaterThanOrEqual(0);
    expect(hrefs[campaigns + 1]).toBe(`/workspaces/${tenant}/newsletter/automations`);
    await expect(sidebar.getByRole("link", { name: "Automations", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(sidebar.getByRole("link", { name: "Campaigns", exact: true })).not.toHaveAttribute("aria-current", "page");
  }

  // Create: the dialog needs a name and a trigger.
  await page.getByRole("button", { name: "New automation" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Welcome series");
  await page.getByLabel("Starts when").selectOption("list");
  await page.getByLabel("List", { exact: true }).selectOption({ label: "Weekly list" });
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/newsletter\/automations\/[0-9a-f-]{36}$/);
  const editorUrl = page.url();
  await expect(page.getByText("Added to Weekly list")).toBeVisible();
  await expect(page.getByText("No steps yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate" })).toBeDisabled();

  // Steps: email, wait, email, end.
  const add = async (type: string) => { await page.getByRole("button", { name: "Add step" }).click(); await page.getByRole("button", { name: type, exact: true }).click(); };
  await add("Send email");
  await page.getByLabel("Subject", { exact: true }).fill("Welcome to Grace");
  await add("Wait");
  await page.getByLabel("Wait for").fill("2");
  await add("Send email");
  await page.getByLabel("Subject", { exact: true }).fill("A few things to know");
  await add("End");
  await expect(page.locator("[data-step]")).toHaveCount(4);
  expect(await page.locator("[data-step]").evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.stepType))).toEqual(["email", "wait", "email", "end"]);
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  // The shared email editor is inside the step, and the preview shows its email.
  await page.getByRole("button", { name: /^Edit Step 1 Send email/ }).click();
  await expect(page.locator("[data-block-canvas]")).toBeVisible();
  await expect(page.frameLocator('iframe[title="Email preview"]').first().locator("body")).toContainText("Unsubscribe");
  // Reorder with the buttons; the end step always stays last.
  await page.getByRole("button", { name: "Move Step 3 Send email up" }).click();
  expect(await page.locator("[data-step]").evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.stepType))).toEqual(["email", "email", "wait", "end"]);
  await page.getByRole("button", { name: "Move Step 2 Send email down" }).click();
  await expect(page.getByRole("button", { name: "Move Step 4 End down" })).toBeDisabled();
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();

  // Activate: the flow is locked until paused.
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("Active. Pause to edit.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByLabel("Automation name")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add step" })).toBeDisabled();
  await page.goto(editorUrl);
  await expect(page.getByText("Active. Pause to edit.")).toBeVisible();

  // People join the list: one with consent enters; one without a grant does not.
  const person = async (name: string, email: string, consent: boolean) => {
    const contact = await (await page.request.post(`/api/workspaces/${tenant}/contacts`, { headers: { origin }, data: { name, email, notes: "" } })).json();
    if (consent) expect((await page.request.post(`/api/workspaces/${tenant}/contacts/${contact.id}/consents`, { headers: { origin },
      data: { purpose: "newsletter", channel: "email", status: "granted", noticeVersion: "notice-v1", source: "test", evidence: "Synthetic" } })).status()).toBe(201);
    const subscriber = await (await page.request.post(`${api}/subscribers`, { headers: { origin }, data: { contactId: contact.id } })).json();
    if (consent) expect((await page.request.put(`${api}/lists/${list}/subscribers/${subscriber.id}`, { headers: { origin }, data: { state: "subscribed", version: 0 } })).status()).toBe(200);
    return contact.id as string;
  };
  const ada = await person("Ada Lovelace", "ada@example.test", true);
  await person("Ben Silent", "ben@example.test", false);
  await openActivity(page);
  const grid = page.locator("[data-activity]");
  await expect(grid.getByText("Ada Lovelace")).toBeVisible();
  await expect(grid.getByText("Ben Silent")).toHaveCount(0);
  await expect(grid.getByText("Running")).toBeVisible();
  await grid.getByRole("button", { name: "View activity for Ada Lovelace" }).click();
  await expect(page.locator("[data-run-log]").getByText("Entered")).toBeVisible();
  await shoot(page, "activity", async () => { await openActivity(page); await expect(page.locator("[data-activity]").getByText("Ada Lovelace")).toBeVisible(); });

  // Consent withdrawn: the run stops at once, with the reason in the log.
  expect((await page.request.post(`/api/workspaces/${tenant}/contacts/${ada}/consents`, { headers: { origin },
    data: { purpose: "newsletter", channel: "email", status: "withdrawn", noticeVersion: "notice-v1", source: "test", evidence: "Synthetic" } })).status()).toBe(201);
  await page.goto(editorUrl);
  await openActivity(page);
  await expect(page.locator("[data-activity]").getByText(/^Stopped: (Consent withdrawn|Unsubscribed)$/)).toBeVisible();
  await page.locator("[data-activity]").getByRole("button", { name: "View activity for Ada Lovelace" }).click();
  await expect(page.locator("[data-run-log]").getByText(/Stopped \((Consent withdrawn|Unsubscribed)\)/)).toBeVisible();

  // Pause and edit again.
  await page.goto(editorUrl);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByLabel("Automation name")).toBeEnabled();
  await page.getByLabel("Automation name").fill("Welcome series (v2)");
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  await shoot(page, "editor", async () => { await page.getByRole("button", { name: /^Edit Step 1 Send email/ }).click(); await expect(page.locator("[data-step-editor]")).toBeVisible(); });

  // The list shows it, paused, with the counts; activate from the menu.
  await page.goto(`/workspaces/${tenant}/newsletter/automations`);
  const row = page.getByRole("row").filter({ hasText: "Welcome series (v2)" }).or(page.locator("[data-automations-list]").getByText("Welcome series (v2)").locator("xpath=ancestor::*[self::tr or self::li or self::article][1]")).first();
  await expect(row).toContainText("Paused");
  await expect(row).toContainText("1 stopped");
  await page.getByRole("button", { name: "Actions for Welcome series (v2)" }).click();
  await page.getByRole("menuitem", { name: "Activate" }).click();
  await expect(row).toContainText("Active");
  await shoot(page, "list");
  expect(errors).toEqual([]);
});
