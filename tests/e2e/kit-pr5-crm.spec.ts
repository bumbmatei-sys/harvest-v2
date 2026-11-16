import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// Kit PR 5: CRM list and record polish. Presentation only; the server stays the real enforcement.
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ reducedMotion: "reduce", actionTimeout: 20_000, navigationTimeout: 60_000 });
const widths = [360, 390, 768, 1280, 1440] as const;
const evidence = "docs/screenshots/kit-pr5";

async function api(page: Page, method: "get" | "post" | "put", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") !== mode) {
    await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  }
}
async function audit(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), name).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} overflow`).toBe(true);
}
async function tall(page: Page, locator: ReturnType<Page["locator"]>, min = 44) {
  for (const item of await locator.all()) expect((await item.boundingBox())!.height, await item.innerText()).toBeGreaterThanOrEqual(min);
}

test("CRM lists and records: phone cards, contact actions, timeline, tracker, five widths in both themes", async ({ page, context }) => {
  test.setTimeout(900_000);
  await mkdir(evidence, { recursive: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest Kit PR5 ministry" });
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
  const company = (await api(page, "post", `${apiRoot}/companies`, { name: "Synthetic Hope Chapel", domain: "hope-chapel.example.test" })).body.id as string;
  const person = (await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Ana Costa", email: "ana@example.test", phone: "+49 151 2345678", companyId: company })).body.id as string;
  await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Ben Quiet" });
  const deal = (await api(page, "post", `${apiRoot}/crm/deals`, { name: "Synthetic building fund", companyId: company, contactId: person, amount: "5000" })).body.id as string;
  expect((await api(page, "post", `${apiRoot}/crm/notes`, { target: "person", targetId: person, body: "Synthetic first note" })).status).toBe(201);
  expect((await api(page, "post", `${apiRoot}/crm/tasks`, { title: "Synthetic follow-up call", contactId: person, priority: "high" })).status).toBe(201);

  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    for (const mode of ["light", "dark"] as const) {
      const label = `${width}-${mode}`;
      const shot = async (name: string) => { if (width === 360 || width === 1280) await page.screenshot({ path: `${evidence}/${name}-${label}.png` }); };

      // People list: phone card details while the card is narrow; the real columns otherwise.
      await page.goto(`${root}/crm/people`); await setMode(page, mode);
      await expect(page.getByRole("heading", { level: 1, name: /People/ })).toBeVisible();
      const grid = page.getByRole("grid", { name: "People" });
      await expect(grid.getByRole("link", { name: /Synthetic Ana Costa/ }).first()).toBeVisible();
      const summaries = page.locator("[data-row-summary]");
      if (width < 768) {
        await expect(summaries.first()).toBeVisible();
        await expect(summaries.first().getByRole("link", { name: "ana@example.test" })).toHaveAttribute("href", "mailto:ana@example.test");
        await expect(summaries.first().getByRole("link", { name: "+491512345678" })).toHaveAttribute("href", "tel:+491512345678");
        await tall(page, summaries.getByRole("link"));
      } else if (width >= 1280) {
        await expect(summaries.first()).toBeHidden();
      }
      await audit(page, `people ${label}`); await shot("people");

      // Organizations list shares the grid.
      await page.goto(`${root}/crm/companies`);
      await expect(page.getByRole("grid", { name: "Organizations" })).toBeVisible();
      if (width < 768) await expect(page.locator("[data-row-summary]").first().getByRole("link", { name: "hope-chapel.example.test" })).toBeVisible();
      await audit(page, `organizations ${label}`);

      // Person record: contact actions, copy, timeline, composer, tasks.
      await page.goto(`${root}/crm/people/${person}`);
      const actions = page.getByRole("list", { name: "Contact actions" });
      await expect(actions.getByRole("link", { name: "Email", exact: true })).toHaveAttribute("href", "mailto:ana@example.test");
      await expect(actions.getByRole("link", { name: "Call", exact: true })).toHaveAttribute("href", "tel:+491512345678");
      if (width < 1024) { await tall(page, actions.getByRole("link")); await tall(page, actions.getByRole("button")); }
      await expect(page.getByRole("list", { name: "Timeline" })).toBeVisible();
      const noteButtons = page.getByRole("button", { name: "Edit", exact: true });
      await expect(noteButtons.first()).toBeVisible();
      if (width < 1024) { await tall(page, noteButtons); await tall(page, page.getByRole("button", { name: "Delete", exact: true })); await tall(page, page.getByRole("button", { name: "Add note", exact: true })); }
      await expect(page.getByLabel("New note")).toBeVisible();
      await audit(page, `person ${label}`); await shot("person");

      // Deal record: the stage tracker.
      await page.goto(`${root}/crm/deals/${deal}`);
      const tracker = page.getByRole("list", { name: "Stage progress" });
      await expect(tracker).toBeVisible();
      await expect(tracker.locator('[aria-current="step"]')).toHaveCount(1);
      await audit(page, `deal ${label}`); await shot("deal");

      // Organization record.
      await page.goto(`${root}/crm/companies/${company}`);
      await expect(page.getByRole("button", { name: "Copy domain", exact: true })).toBeVisible();
      await audit(page, `organization ${label}`);
    }
  }
});

test("copy, composer and note actions work, and roles without write access see no actions", async ({ page, browser, context }) => {
  test.setTimeout(300_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest Kit PR5 actions" });
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
  const person = (await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Cy Doe", email: "cy@example.test", phone: "+1 555 0100" })).body.id as string;
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET" && request.url().includes("/api/")) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });

  await page.goto(`${root}/crm/people/${person}`);
  // Copy puts the stored value on the clipboard, confirms with a toast and sends nothing.
  await page.getByRole("list", { name: "Contact actions" }).getByRole("button", { name: "Copy email address" }).click();
  await expect(page.getByText("Copied", { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("cy@example.test");
  await page.getByRole("list", { name: "Contact actions" }).getByRole("button", { name: "Copy phone number" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("+15550100");
  expect(writes).toEqual([]);

  // Composer: Ctrl+Enter adds, the note shows in a panel; Edit and Delete are icon buttons with names.
  const composer = page.getByLabel("New note");
  await composer.fill("Synthetic composer note");
  await composer.press("Control+Enter");
  await expect(page.getByText("Synthetic composer note", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Edit note", exact: true }).fill("Synthetic edited note"); await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Synthetic edited note", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await expect(page.getByText("Synthetic edited note", { exact: true })).toHaveCount(0);

  // Viewer: contact actions (read-only data) stay; the composer and note actions do not.
  expect((await api(page, "post", `${apiRoot}/crm/notes`, { target: "person", targetId: person, body: "Synthetic note for viewer" })).status).toBe(201);
  const otherContext = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
  const other = await otherContext.newPage();
  const email = await signIn(other);
  expect((await api(page, "put", `${apiRoot}/members`, { email, role: "viewer" })).status).toBe(200);
  await other.goto(`${root}/crm/people/${person}`);
  await expect(other.getByRole("list", { name: "Contact actions" })).toBeVisible();
  await expect(other.getByText("Synthetic note for viewer", { exact: true })).toBeVisible();
  await expect(other.getByLabel("New note")).toHaveCount(0);
  await expect(other.getByRole("button", { name: "Add note", exact: true })).toHaveCount(0);
  await expect(other.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(other.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await expect(other.getByRole("button", { name: /^Record opt-in for/ })).toHaveCount(0);
  await otherContext.close();
});
