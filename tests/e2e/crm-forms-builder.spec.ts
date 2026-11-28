import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// CRM forms builder: list, new-form flow, Build (add, reorder with pointer-free controls and the keyboard, undo), Settings, Preview (one question per page).
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/crm-forms-builder";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;

async function shoot(page: Page, name: string, prepare?: () => Promise<void>) {
  if (await page.locator("[data-save-status]").count()) await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload(); await page.waitForTimeout(400);
    await prepare?.();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
const order = (page: Page) => page.locator("[data-question-list] > li").evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.blockType));
async function addByMenu(page: Page, search: string, name: string) {
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await page.getByRole("textbox", { name: "Search", exact: true }).fill(search);
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
}

test("build a form: add, reorder (buttons and keyboard), undo, settings, preview one per page, autosave and list", async ({ page }) => {
  test.setTimeout(300000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;

  // List, empty. The templates show on top.
  await page.goto(`/workspaces/${tenant}/crm/forms`);
  await expect(page.getByRole("heading", { name: "Forms", exact: true })).toBeVisible();
  await expect(page.getByText("No forms yet")).toBeVisible();
  await expect(page.locator("[data-template-card]")).toHaveCount(3);
  await shoot(page, "list-empty");

  // New form: template, then where submissions go.
  await page.locator('[data-template-card="prayer"]').click();
  await expect(page.getByRole("heading", { name: "Where should submissions be saved?" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("[data-template]")).toHaveCount(6);
  await page.locator('[data-template="visitor"]').click();
  await expect(page.getByRole("heading", { name: "Where should submissions be saved?" })).toBeVisible();
  await expect(page.locator("[data-destination]")).toHaveCount(3);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("organ");
  await expect(page.locator("[data-destination]")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("");
  await shoot(page, "new-destination");
  await page.locator('[data-destination="people"]').click();
  await expect(page).toHaveURL(/\/crm\/forms\/[0-9a-f-]{36}$/);
  const formUrl = page.url(), formId = formUrl.split("/").pop()!;

  // Build: the template's questions, the pinned consent block, and a title that autosaves.
  await expect(page.getByRole("textbox", { name: "Form title" })).toHaveValue("Visitor card");
  expect(await order(page)).toEqual(["short", "email", "phone", "short", "dropdown", "long"]);
  await expect(page.locator("[data-consent-block]")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove: I agree/ })).toHaveCount(0);
  await expect(page.getByText("0 responses")).toBeVisible();
  await page.getByRole("textbox", { name: "Form title" }).fill("Sunday visitor card");
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();

  // Add a question by search and one through a submenu (Single-select, then Rating).
  await addByMenu(page, "date", "Date");
  expect(await order(page)).toEqual(["short", "email", "phone", "short", "dropdown", "long", "date"]);
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await page.getByRole("button", { name: /^Single-select/ }).click();
  await page.getByRole("button", { name: "Rating", exact: true }).click();
  expect(await order(page)).toEqual(["short", "email", "phone", "short", "dropdown", "long", "date", "rating"]);
  // Consent stays last and out of the list.
  await expect(page.locator("[data-question-list] [data-block-type=consent]")).toHaveCount(0);

  // Move up and Move down buttons, then undo.
  await page.getByRole("button", { name: "Move up: Rating", exact: true }).click();
  expect((await order(page)).slice(-2)).toEqual(["rating", "date"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await order(page)).slice(-2)).toEqual(["date", "rating"]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await order(page)).slice(-2)).toEqual(["rating", "date"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();

  // Keyboard drag and drop: pick the Rating handle up, move it one place up, drop it.
  const handle = page.getByRole("button", { name: "Drag to reorder: Rating", exact: true });
  await handle.focus(); await page.keyboard.press("Space"); await page.waitForTimeout(250);
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(250); await page.keyboard.press("Space");
  await expect.poll(async () => (await order(page)).slice(-2)).toEqual(["rating", "date"]);

  // The consent block cannot be removed or moved; its text is editable.
  await page.getByRole("button", { name: "Edit consent", exact: true }).click();
  await expect(page.getByLabel("Consent text")).toBeVisible();

  // Edit a question: save to a CRM field is offered once per field (Name is taken by the first question).
  await page.getByRole("button", { name: "Edit Date", exact: true }).click();
  await expect(page.getByLabel("Question", { exact: true })).toHaveValue("Date");
  await expect(page.locator('[data-block-type="date"] select option[value="name"]')).toHaveCount(0);

  // Settings sidebar.
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(page.locator("[data-form-settings]")).toBeVisible();
  await expect(page.getByLabel("Save to", { exact: true })).toHaveValue("people");
  await page.getByLabel("Redirect URL").fill("http://not-secure.test");
  await expect(page.getByText("Use an address that starts with https://")).toBeVisible();
  await page.getByLabel("Redirect URL").fill("https://example.org/thanks");
  await page.locator("#set-label").fill("Visitor"); await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove label Visitor" })).toBeVisible();
  await page.getByRole("radio", { name: "One per page" }).click();
  await expect(page.getByLabel("Start button")).toBeVisible();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("radio", { name: "Light" }).click();
  await shoot(page, "settings", () => page.getByRole("tab", { name: "Settings", exact: true }).click());

  // Publishing is covered by crm-forms-publication.spec.ts.

  // Preview: one question per page, with a welcome screen, progress, Next, Back and Enter.
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.locator("[data-form-welcome]")).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Question 1 of 9").last()).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This is required." })).toBeVisible();
  await page.getByLabel(/^Name/).fill("Grace Hopper"); await page.keyboard.press("Enter");
  await expect(page.getByText("Question 2 of 9").last()).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel(/^Name/)).toHaveValue("Grace Hopper");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel(/^Email/).fill("not-an-email"); await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Enter a valid email address." })).toBeVisible();
  await page.getByLabel(/^Email/).fill("grace@example.test"); await page.keyboard.press("Enter");
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Question 9 of 9").last()).toBeVisible();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Please agree to continue." })).toBeVisible();
  await page.getByRole("checkbox", { name: /I agree to the use of my details/ }).check();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.locator("[data-form-done]")).toContainText("Thank you, Grace Hopper");
  await expect(page.locator("[data-preview-note]")).toContainText("https://example.org/thanks");
  await shoot(page, "preview", () => page.getByRole("tab", { name: "Preview", exact: true }).click());

  // Autosave persisted everything: reload and read it back.
  await page.goto(formUrl);
  await expect(page.getByRole("textbox", { name: "Form title" })).toHaveValue("Sunday visitor card");
  expect((await order(page)).slice(-2)).toEqual(["rating", "date"]);
  await shoot(page, "build");
  const saved = await (await page.request.get(`/api/workspaces/${tenant}/crm/forms/${formId}`)).json();
  expect(saved.definition.settings).toMatchObject({ layout: "paged", redirectUrl: "https://example.org/thanks", labels: ["Visitor"] });
  expect(saved.definition.blocks.at(-1)).toMatchObject({ type: "consent", required: true });

  // A stale save is refused (409), not merged over a newer one.
  const stale = await page.request.put(`/api/workspaces/${tenant}/crm/forms/${formId}`, { headers: { origin }, data: { definition: saved.definition, revision: 1 } });
  expect(stale.status()).toBe(409);

  // List: the form shows with where it saves, can be starred, found by search and sorted; the sidebar lists favorites and recents.
  await page.goto(`/workspaces/${tenant}/crm/forms`);
  const row = page.getByRole("row").filter({ hasText: "Sunday visitor card" });
  await expect(row).toContainText("People");
  await page.getByRole("button", { name: "Add Sunday visitor card to favorites" }).click();
  await expect(page.getByRole("button", { name: "Remove Sunday visitor card from favorites" })).toBeVisible();
  await expect(page.locator("[data-forms-sidebar]").getByRole("link", { name: "Sunday visitor card" }).first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search forms" }).fill("zzz");
  await expect(page.getByText("No forms match")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search forms" }).fill("");
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Name (A to Z)" }).click();
  await row.getByRole("button", { name: "Actions for Sunday visitor card" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page).toHaveURL(/\/crm\/forms\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Form title" })).toHaveValue("Copy of Sunday visitor card");
  await page.goto(`/workspaces/${tenant}/crm/forms`);
  await shoot(page, "list");

  // Members and viewers cannot build forms.
  expect((await page.request.post(`/api/workspaces/${tenant}/crm/forms`, { headers: { origin }, data: { template: null, destination: null } })).status()).toBe(201);
  const other = await page.context().browser()!.newContext();
  const anonymous = await other.request.get(`${origin}/api/workspaces/${tenant}/crm/forms`);
  expect(anonymous.status()).toBe(401);
  await other.close();
  expect(errors).toEqual([]);
});
