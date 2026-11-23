import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 30000 });
// Newsletter campaigns: list with templates, the block editor (add, reorder with buttons and the keyboard, edit text, brand kit), preview, test send, Send step.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/newsletter-campaigns";
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
      expect((await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
const order = (page: Page) => page.locator("[data-block-canvas] ol > li").evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.blockType));
const preview = (page: Page) => page.frameLocator('iframe[title="Email preview"]').first();

test("campaigns: templates, block editor, brand kit, preview, test send and the Send step", async ({ page }) => {
  test.setTimeout(600000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/newsletter`;
  const audience = (await (await page.request.post(`${api}/audiences`, { headers: { origin }, data: { name: "Everyone" } })).json()).id as string;
  expect((await page.request.post(`${api}/lists`, { headers: { origin }, data: { audienceId: audience, name: "Weekly list" } })).status()).toBe(200);

  // List: empty, with the eight templates (plus blank) rendered from the blocks.
  await page.goto(`/workspaces/${tenant}/newsletter/campaigns`);
  await expect(page.getByRole("heading", { name: "Campaigns", exact: true })).toBeVisible();
  await expect(page.getByText("No campaigns yet")).toBeVisible();
  await expect(page.locator("section [data-template]")).toHaveCount(9);
  await shoot(page, "list-empty");

  // Create from a template.
  await page.locator('section [data-template="weekly-update"]').getByRole("button", { name: "Use Weekly update" }).click();
  await expect(page).toHaveURL(/\/newsletter\/campaigns\/[0-9a-f-]{36}$/);
  const editorUrl = page.url();
  await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Weekly update");
  expect(await order(page)).toEqual(["header", "hero", "text", "columns", "quote", "event", "footer"]);
  await expect(preview(page).getByText("This week at Grace Community Church")).toBeVisible();
  await shoot(page, "write");

  // Add (menu), reorder with the buttons and the keyboard, undo.
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  await page.getByRole("combobox", { name: "Search blocks" }).fill("divider");
  await page.getByRole("option", { name: "Divider" }).click();
  const afterAdd = await order(page);
  expect(afterAdd).toHaveLength(8);
  await page.getByRole("button", { name: "Move Quote or scripture up" }).click();
  expect((await order(page)).slice(3, 5)).toEqual(["quote", "columns"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await order(page)).slice(3, 5)).toEqual(["columns", "quote"]);
  const handle = page.getByRole("button", { name: "Drag Quote or scripture" });
  await handle.focus();
  await page.keyboard.press("Space"); await page.waitForTimeout(250); await page.keyboard.press("ArrowUp"); await page.waitForTimeout(250); await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(250); await page.keyboard.press("Space");
  await expect.poll(async () => (await order(page)).slice(3, 5)).toEqual(["quote", "columns"]);

  // Edit: subject, the hero heading (the preview follows), and a rich text block.
  await page.getByRole("textbox", { name: "Subject", exact: true }).fill("Grace news this week");
  await page.getByRole("button", { name: "Edit Hero" }).click();
  await page.getByLabel("Heading", { exact: true }).fill("Hello from <b>Grace</b>");
  await expect(preview(page).getByText("Hello from <b>Grace</b>")).toBeVisible();
  await page.getByLabel("Button link").fill("http://insecure.test");
  await expect(page.getByText("Use a secure https link.")).toBeVisible();
  await expect(page.locator('[data-save-status="invalid"]')).toBeVisible();
  await page.getByLabel("Button link").fill("https://example.com/events");
  await page.getByRole("button", { name: "Edit Text", exact: true }).click();
  await page.getByRole("textbox", { name: "Email text" }).fill("A short welcome from {{firstName}}.");
  await expect(preview(page).getByText("A short welcome from Ana.")).toBeVisible();
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();

  // Brand kit: a colour and a font change the preview.
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByRole("textbox", { name: "Main colour" }).last().fill("#7a1f3d");
  await page.getByLabel("Font").selectOption("verdana");
  await page.getByLabel("Mailing address").fill("12 Mill Road, Springfield");
  await expect(preview(page).locator("body")).toContainText("12 Mill Road, Springfield");
  expect(await preview(page).locator("td[style*='#7a1f3d']").count()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Save brand kit" }).click();
  await expect(page.getByText("Brand kit saved.")).toBeVisible();
  await page.keyboard.press("Escape");

  // Preview widths and the test send to the test inbox.
  await page.getByRole("button", { name: "Mobile" }).click();
  await expect(page.locator('iframe[data-device="mobile"]')).toBeVisible();
  await page.getByRole("button", { name: "Desktop" }).click();
  const sent = page.waitForResponse((r) => r.url().includes("/test-sink"));
  await page.getByRole("button", { name: "Send me a test" }).click();
  const response = await sent;
  expect(response.status(), await response.text()).toBe(200);
  expect(await response.json()).toEqual({ test: true, mailbox: "synthetic", state: "accepted" });
  await expect(page.getByText("Test sent to the test inbox.")).toBeVisible();

  // Templates picker replaces the body after a confirmation.
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator('[role="dialog"] [data-template="welcome"]').getByRole("button", { name: "Use Welcome" }).click();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  expect((await order(page))[1]).toBe("hero");
  await expect(preview(page).getByText("Welcome, Ana")).toBeVisible();

  // Send step: live count, when, inbox check, and a disabled Send.
  await page.getByRole("navigation", { name: "Campaign steps" }).getByRole("button", { name: /^Send/ }).click();
  await expect(page.getByText("Choose at least one list.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Weekly list" }).check();
  await expect(page.locator("[data-recipient-count]")).toContainText("people will receive it.");
  await expect(page.locator("[data-recipient-count]")).toContainText("Unsubscribed and bounced people are skipped automatically.");
  await page.getByRole("radio", { name: "Pick a time" }).check();
  await expect(page.getByLabel("Date and time")).toBeVisible();
  await expect(page.locator('[data-check="address"]')).toHaveAttribute("data-level", "pass");
  await expect(page.locator('[data-check="links"]')).toHaveAttribute("data-level", "fail");
  await expect(page.locator("[data-send-button]")).toBeDisabled();
  await expect(page.getByText("Sending is not available yet.")).toBeVisible();
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  await shoot(page, "send");

  // The campaign is in the list; search and sort work, and the saved draft reloads with its content.
  await page.goto(`/workspaces/${tenant}/newsletter/campaigns`);
  await expect(page.getByRole("link", { name: "Weekly update" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search campaigns" }).fill("zzz");
  await expect(page.getByText("No campaigns match your search.")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search campaigns" }).fill("weekly");
  await page.getByLabel("Sort").selectOption("status");
  await page.goto(editorUrl);
  await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Grace news this week");
  expect(errors).toEqual([]);
});
