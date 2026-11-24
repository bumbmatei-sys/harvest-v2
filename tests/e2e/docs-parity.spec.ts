import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20000 });
// Docs slice 2b: the slash-menu additions, favorite placement, share this page, blank wiki and the history panel.
test.use({ actionTimeout: 20000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/docs-slice2b";
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(url, { headers: { origin }, data });
const shot = (page: Page, name: string) => page.screenshot({ path: `${evidence}/${name}.png` });

test("slash additions, mentions, favorite placement, share this page, blank wiki and history", async ({ page }) => {
  test.setTimeout(420000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await post(page, "/api/workspaces", { name: "Grace Community Church", audience: "church" })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/docs`;
  const doc = await (await post(page, api, { title: "Parity doc" })).json() as { id: string };
  await page.goto(`/workspaces/${tenant}/docs/${doc.id}`);
  const editor = page.locator(".docs-prose");
  await editor.click();
  const pick = async (id: string, query: string) => {
    await page.keyboard.type(`/${query}`);
    const row = page.locator(`[data-slash-item="${id}"]`);
    await expect(row).toBeVisible();
    await row.click();
  };

  // Text blocks and badges.
  await pick("pullQuote", "pull");
  await page.keyboard.type("Grace and peace");
  await expect(editor.locator("blockquote[data-pull]")).toContainText("Grace and peace");
  await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await page.keyboard.type("Tagged");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.type("/");
  await page.keyboard.press("Escape");
  await editor.click();
  await page.keyboard.press("End");
  await pick("stickyToc", "sticky");
  await expect(page.locator("[data-toc-block][data-sticky]")).toBeVisible();
  await pick("layout3", "layout");
  await expect(editor.locator("[data-column]")).toHaveCount(3);

  // Button, website link and Markdown through their dialogs.
  await editor.click(); await page.keyboard.press("Control+End");
  await pick("button", "button");
  await page.getByRole("dialog").getByLabel("Button text").fill("Give today");
  await page.getByRole("dialog").getByLabel("Address").fill("example.org/give");
  await page.getByRole("dialog").getByRole("button", { name: "Insert" }).click();
  await expect(editor.locator('a[data-button]')).toHaveAttribute("href", "https://example.org/give");
  await editor.click(); await page.keyboard.press("Control+End");
  await pick("markdown", "markdown");
  await page.getByRole("dialog").getByLabel("Markdown").fill("## From Markdown\n\n- one\n- two");
  await page.getByRole("dialog").getByRole("button", { name: "Insert" }).click();
  await expect(editor.getByRole("heading", { name: "From Markdown" })).toBeVisible();

  // Mentions: a page of this doc.
  await editor.click(); await page.keyboard.press("Control+End");
  await page.keyboard.type("@Parity");
  await expect(page.locator("[data-mention-menu]")).toBeVisible();
  await shot(page, "mention-menu-desktop-light");
  await page.locator('[data-mention-item="page"]').first().click();
  await expect(editor.locator("span[data-mention]")).toContainText("Parity doc");

  // Badge through the slash menu on a fresh line.
  await page.keyboard.press("Control+End"); await page.keyboard.press("Enter");
  await page.keyboard.type("/badge");
  await expect(page.locator('[data-slash-item="badge-strong-red"]')).toBeVisible();
  await shot(page, "slash-badges-desktop-light");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await settleForAxe(page);
    const found = (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
    expect(found.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    await shot(page, `slash-badges-desktop-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await (await page.request.get(`${api}/${doc.id}`)).json()).pages.length).toBe(1);

  // Favorite placement from the menu: sidebar, then top.
  await page.getByRole("button", { name: "Doc settings" }).click();
  await page.locator("[data-docs-menu]").getByRole("button", { name: "Add to favorites" }).click();
  await shot(page, "menu-favorite-flyout-desktop-light");
  await page.locator("[data-docs-submenu]").getByRole("menuitemradio", { name: "Sidebar" }).click();
  await expect.poll(async () => (await (await page.request.get(`${api}/${doc.id}`)).json()).doc.favoritePlacement).toBe("sidebar");
  await page.reload();
  await expect(page.locator("[data-docs-sidebar-favorites]")).toContainText("Parity doc");
  await shot(page, "favorite-sidebar-desktop-light");

  // History: the panel lists versions after a few saves.
  await page.getByRole("button", { name: "Doc settings" }).click();
  await page.locator("[data-docs-menu]").getByRole("tab", { name: "This page" }).click();
  await page.locator("[data-docs-menu]").getByRole("button", { name: "Show page history" }).click();
  await expect(page.getByRole("complementary", { name: /history/i })).toBeVisible();
  await shot(page, "panel-history-desktop-light");

  // Share this page, then the list: top favorites and the New menu.
  await page.getByRole("button", { name: "Doc settings" }).click();
  await page.locator("[data-docs-menu]").getByRole("tab", { name: "This page" }).click();
  await page.locator("[data-docs-menu]").getByRole("button", { name: "Share this page" }).click();
  await expect(page.getByRole("dialog")).toContainText("Not shared with anyone yet");
  await shot(page, "share-page-dialog-desktop-light");
  await page.keyboard.press("Escape");
  await page.goto(`/workspaces/${tenant}/docs`);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await shot(page, "list-new-menu-desktop-light");
  await page.getByRole("menuitem", { name: "Blank wiki" }).click();
  await expect(page).toHaveURL(/\/docs\/[0-9a-f-]{36}/);
  const wikiId = page.url().match(/docs\/([0-9a-f-]{36})/)![1];
  await expect.poll(async () => (await (await page.request.get(`${api}/${wikiId}`)).json()).doc.wiki).toBe(true);
  expect(errors).toEqual([]);
});
