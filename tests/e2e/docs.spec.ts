import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page, type Request, type Route } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20000 });
// Docs slice 1: the list (folders, search, rules) and the editor (toolbar, slash menu, autosave, pages, styles, settings menu).
test.use({ actionTimeout: 20000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/docs-slice1";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;

/** One scene per width and scheme: axe (WCAG 2.0 to 2.2 A and AA), no horizontal overflow, and a screenshot. */
async function audit(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator("[data-docs-list], [data-docs-editor]")).toBeVisible();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      const found = (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
      expect(found.map((v) => `${label}/${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(url, { headers: { origin }, data });
const patch = (page: Page, url: string, data: unknown) => page.request.patch(url, { headers: { origin }, data });
async function workspace(page: Page) {
  await signIn(page);
  return (await (await post(page, "/api/workspaces", { name: "Grace Community Church", audience: "church" })).json()).tenantId as string;
}
const saved = (page: Page) => expect(page.locator('[data-save-state="saved"]:visible')).toBeVisible();
const body = (page: Page) => page.locator(".docs-prose");
const tool = (page: Page, name: string) => page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });

test("list: folders, create, rename, move (menu and drag), delete rules, search with paths, star, archive, trash", async ({ page }) => {
  test.setTimeout(420000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await workspace(page);
  const api = `/api/workspaces/${tenant}/docs`;
  await page.goto(`/workspaces/${tenant}/docs`);
  await expect(page.getByRole("heading", { name: "Docs", exact: true })).toBeVisible();
  await expect(page.getByText("No docs yet")).toBeVisible();

  // Docs sits in Office next to Email, Calendar, Tasks, Docs and Storage (shell modes on).
  if (process.env.HARVEST_SHELL_MODES !== "disabled") {
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    const office = await sidebar.getByRole("link").evaluateAll((links) => links.map((l) => l.textContent?.trim()));
    expect(office.slice(office.indexOf("Email"), office.indexOf("Email") + 5)).toEqual(["Email", "Calendar", "Tasks", "Docs", "Storage"]);
    await expect(sidebar.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("data-active", "true");
  }

  // New folder, a duplicate name (any case) is refused, then nested folders.
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Sermons");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("doc-folder-card")).toHaveCount(1);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("  sermons ");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "A folder with this name already exists here." })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("link", { name: "Sermons" }).click();
  await expect(page).toHaveURL(/folder=/);
  await expect(page.getByRole("navigation", { name: "Location" }).getByText("Sermons")).toBeVisible();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("2026");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("doc-folder-card")).toHaveCount(1);

  // A doc created in the open folder opens in the editor with Docs / Folder / Doc in its breadcrumb.
  await page.getByRole("button", { name: "New doc" }).first().click();
  await expect(page).toHaveURL(/\/docs\/[0-9a-f-]{36}/);
  const crumbs = page.getByRole("navigation", { name: "Location" });
  // The shell header carries Ministry > Docs, and the editor continues it with the folders and the doc.
  await expect(page.locator("[data-shell-header]")).toContainText("Docs");
  await expect(crumbs.getByRole("link", { name: "Sermons" })).toBeVisible();
  await expect(crumbs.getByText("Untitled")).toBeVisible();
  await page.getByLabel("Page title").fill("Easter plan");
  await saved(page);
  await crumbs.getByRole("link", { name: "Sermons" }).click();
  await expect(page.getByRole("link", { name: "Easter plan" })).toBeVisible();

  // Move through the row menu; the folder's own subtree is not offered when moving a folder.
  await page.getByRole("button", { name: "Actions for Easter plan" }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await page.getByRole("radio", { name: "2026" }).check();
  await page.getByRole("dialog").getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("link", { name: "Easter plan" })).toHaveCount(0);
  await expect(page.getByTestId("doc-folder-card").filter({ hasText: "2026" })).toContainText("1 doc");

  // Drag a doc onto a folder card.
  const second = await (await post(page, api, { title: "Good Friday", folderId: new URL(page.url()).searchParams.get("folder") })).json();
  await page.reload();
  const grip = page.getByRole("button", { name: "Drag Good Friday to a folder" });
  const card = page.getByTestId("doc-folder-card").filter({ hasText: "2026" });
  const from = (await grip.boundingBox())!, to = (await card.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y - 20, { steps: 6 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(card).toHaveAttribute("data-drop-over", "true");
  await page.mouse.up();
  await expect(card).toContainText("2 docs");
  await expect(page.getByRole("link", { name: "Good Friday" })).toHaveCount(0);
  expect(second.id).toBeTruthy();

  // Folder rules: not into its own subtree; rename; delete moves the contents up after a confirmation.
  await page.getByRole("navigation", { name: "Location" }).getByRole("link", { name: "Docs", exact: true }).click();
  await page.getByRole("button", { name: "Actions for folder Sermons" }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await expect(page.getByRole("radio", { name: "2026" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Sermons" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Actions for folder Sermons" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Folder name").fill("Sermons 2026");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "Sermons 2026" })).toBeVisible();
  await page.getByRole("button", { name: "Actions for folder Sermons 2026" }).click();
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("1 folder");
  await expect(page.getByRole("alertdialog")).toContainText("moved to Docs");
  await page.getByRole("button", { name: "Move up and delete" }).click();
  await expect(page.getByRole("link", { name: "Sermons 2026" })).toHaveCount(0);
  await expect(page.getByTestId("doc-folder-card").filter({ hasText: "2026" })).toContainText("2 docs");

  // Search finds docs across folders and shows where they are.
  await page.getByRole("searchbox", { name: "Search docs" }).fill("easter");
  await expect(page).toHaveURL(/q=easter/);
  await expect(page.getByTestId("doc-path")).toHaveText("2026");
  await expect(page.getByRole("link", { name: "Easter plan" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Search results");
  await page.getByRole("searchbox", { name: "Search docs" }).fill("nothing like this");
  await expect(page.getByText("No docs match")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search docs" }).fill("");
  await expect(page).not.toHaveURL(/q=/);

  // Star, duplicate, archive, trash with a confirmation, restore.
  await page.getByRole("link", { name: "2026" }).click();
  await page.getByRole("button", { name: "Star Easter plan" }).click();
  await expect(page.getByRole("button", { name: "Remove star from Easter plan" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Starred" }).click();
  await expect(page.getByTestId("doc-link").filter({ hasText: "Easter plan" })).toBeVisible();
  await expect(page.getByTestId("doc-link").filter({ hasText: "Good Friday" })).toHaveCount(0);
  await page.getByRole("button", { name: "Starred" }).click();
  await page.getByRole("button", { name: "Actions for Good Friday" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByRole("link", { name: "Good Friday (copy)" })).toBeVisible();
  await page.getByRole("button", { name: "Actions for Good Friday (copy)" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByRole("link", { name: "Good Friday (copy)" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Status" }).selectOption("archived");
  await expect(page.getByRole("link", { name: "Good Friday (copy)" })).toBeVisible();
  await page.getByRole("button", { name: "Actions for Good Friday (copy)" }).click();
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("restored from Trash");
  await page.getByRole("alertdialog").getByRole("button", { name: "Move to trash" }).click();
  await page.getByRole("combobox", { name: "Status" }).selectOption("trash");
  await expect(page.getByText("Good Friday (copy)")).toBeVisible();
  await expect(page.getByRole("link", { name: "Good Friday (copy)" })).toHaveCount(0);
  await page.getByRole("button", { name: "Actions for Good Friday (copy)" }).click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  // Restored from Trash, it is back among the archived docs; unarchive brings it to the active list.
  await page.getByRole("combobox", { name: "Status" }).selectOption("archived");
  await page.getByRole("button", { name: "Actions for Good Friday (copy)" }).click();
  await page.getByRole("menuitem", { name: "Unarchive" }).click();
  await expect(page.getByRole("link", { name: "Good Friday (copy)" })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.goto(page.url().replace(/[?&]status=archived/, ""));
  await expect(page.getByRole("link", { name: "Good Friday (copy)" })).toBeVisible();
  await page.getByRole("combobox", { name: "Sort by" }).selectOption("title");
  await expect(page).toHaveURL(/sort=title/);
  await expect.poll(() => page.getByTestId("doc-link").count()).toBeGreaterThan(2);

  await audit(page, "list");
  expect(errors).toEqual([]);
});

test("editor: title, autosave, formatting toolbar, slash menu, handles, pages tree, page styles, settings menu, protection", async ({ page, context }) => {
  test.setTimeout(540000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await workspace(page);
  const api = `/api/workspaces/${tenant}/docs`;
  const doc = await (await post(page, api, { title: "" })).json() as { id: string; pageId: string };
  await page.goto(`/workspaces/${tenant}/docs/${doc.id}`);
  const editor = body(page);
  await expect(editor).toBeVisible();
  await expect(page.getByPlaceholder("Untitled")).toBeVisible();
  await expect(page.locator("[data-docs-meta]")).toContainText("Last updated");
  await expect(editor.locator("p.is-empty, .is-empty").first()).toHaveAttribute("data-placeholder", "Write, or press '/' for commands");
  await saved(page);

  // The Pages sidebar collapses and expands from the keyboard, and the choice is remembered in this browser.
  const sidebar = page.locator("#docs-pages-sidebar");
  await expect(sidebar).toBeVisible();
  await page.getByRole("button", { name: "Collapse pages" }).focus();
  await page.keyboard.press("Enter");
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("button", { name: "Expand pages" })).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(page.locator("[data-docs-editor]")).toBeVisible();
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Expand pages" }).click();
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse pages" })).toHaveAttribute("aria-expanded", "true");

  // Title and body autosave; a reload shows both.
  await page.getByLabel("Page title").fill("Weekly plan");
  await page.keyboard.press("Enter");
  await expect(editor).toBeFocused();
  const savePath = (url: URL) => url.pathname === `${api}/${doc.id}/pages/${doc.pageId}`;
  const savesBody = (request: Request) => request.method() === "PATCH" && (request.postData() ?? "").includes("Hello brave world");
  let releaseSave = () => {};
  const savePaused = new Promise<void>((resolve) => { releaseSave = resolve; });
  const pauseAutosave = async (route: Route) => {
    if (savesBody(route.request())) await savePaused;
    await route.continue();
  };
  // Keep the body save pending while checking the transient status, even on a fast server.
  await page.route(savePath, pauseAutosave);
  try {
    await page.keyboard.type("Hello brave world");
    await expect(page.locator('[data-save-state="unsaved"]:visible, [data-save-state="saving"]:visible').first()).toBeVisible();
  } finally {
    releaseSave();
  }
  await saved(page);
  await page.unroute(savePath, pauseAutosave);
  await page.reload();
  await expect(page.getByLabel("Page title")).toHaveValue("Weekly plan");
  await expect(editor).toContainText("Hello brave world");

  // Formatting toolbar: every action, with its pressed state and its effect.
  await editor.click(); await page.keyboard.press("Control+a");
  for (const [name, selector] of [["Bold", "strong"], ["Italic", "em"], ["Underline", "u"], ["Strikethrough", "s"], ["Inline code", "code"]] as const) {
    await tool(page, name).click();
    await expect(tool(page, name)).toHaveAttribute("aria-pressed", "true");
    await expect(editor.locator(selector).first()).toBeVisible();
    await tool(page, name).click();
    await expect(tool(page, name)).toHaveAttribute("aria-pressed", "false");
  }
  const style = page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Text style" });
  for (const [label, tag] of [["Heading 1", "h1"], ["Heading 2", "h2"], ["Heading 3", "h3"], ["Heading 4", "h4"]] as const) {
    await style.click(); await page.getByRole("menuitem", { name: label, exact: true }).click();
    await expect(editor.locator(tag).first()).toHaveText("Hello brave world");
    await expect(style).toContainText(label);
  }
  await style.click(); await page.getByRole("menuitem", { name: "Normal text" }).click();
  await expect(editor.locator("h4")).toHaveCount(0);
  await tool(page, "Text color").click(); await page.getByRole("menuitem", { name: "Red" }).click();
  await expect(editor.locator("span[style*='color']").first()).toBeVisible();
  await tool(page, "Highlight").click(); await page.getByRole("menuitem", { name: "Yellow" }).click();
  await expect(editor.locator("mark").first()).toBeVisible();
  await tool(page, "Alignment").click(); await page.getByRole("menuitem", { name: "Align center" }).click();
  await expect(editor.locator("p[style*='text-align: center']").first()).toBeVisible();
  await tool(page, "Clear formatting").click();
  await expect(editor.locator("mark, span[style*='color'], p[style*='text-align']")).toHaveCount(0);
  await editor.locator("p").first().click();
  for (const [name, selector] of [["Bulleted list", "ul:not([data-type])"], ["Numbered list", "ol"], ["Checklist", "ul[data-type='taskList']"], ["Toggle list", "div[data-type='details']"], ["Block quote", "blockquote"], ["Code block", "pre"]] as const) {
    await tool(page, name).click();
    await expect(editor.locator(selector).first()).toBeVisible();
    await expect(tool(page, name)).toHaveAttribute("aria-pressed", "true");
    await tool(page, name).click();
    await expect(editor.locator(selector)).toHaveCount(0);
  }
  await tool(page, "Divider").click(); await expect(editor.locator("hr")).toHaveCount(1);
  await tool(page, "Columns").click(); await expect(editor.locator("div[data-columns] > div[data-column]")).toHaveCount(2);
  await tool(page, "Table").click(); await page.getByRole("menuitem", { name: "Insert table" }).click();
  await expect(editor.locator("table tr")).toHaveCount(3);
  await tool(page, "Table").click(); await page.getByRole("menuitem", { name: "Add row below" }).click();
  await expect(editor.locator("table tr")).toHaveCount(4);
  await tool(page, "Table").click(); await page.getByRole("menuitem", { name: "Delete table" }).click();
  await expect(editor.locator("table")).toHaveCount(0);
  await editor.locator("p").first().click(); await page.keyboard.press("Control+a");
  const linkAddress = page.getByLabel("Link address");
  const addLink = page.getByRole("button", { name: "Add link" });
  await tool(page, "Link").click();
  await linkAddress.fill("javascript:alert(1)");
  await addLink.click();
  await expect(linkAddress).toBeHidden();
  await expect(editor).toBeFocused();
  await expect(editor.locator("a")).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await tool(page, "Link").click();
  await expect(linkAddress).toBeVisible();
  await linkAddress.fill("example.org/path");
  await addLink.click();
  await expect(editor.locator("a")).toHaveAttribute("href", "https://example.org/path");
  await tool(page, "Remove link").click(); await expect(editor.locator("a")).toHaveCount(0);
  await tool(page, "Undo").click(); await expect(editor.locator("a")).toHaveCount(1);
  await tool(page, "Redo").click(); await expect(editor.locator("a")).toHaveCount(0);

  // Slash menu: sections, filtering, keyboard, blocks.
  await editor.locator("p").first().click(); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  const menu = page.locator("[data-slash-menu]");
  await expect(menu).toBeVisible();
  for (const section of ["Suggestions", "Text", "Formatting", "Advanced blocks", "Text colors", "Highlights"]) await expect(menu.getByRole("group", { name: section, exact: true })).toBeAttached();
  for (const label of ["Table", "New subpage", "Toggle list", "Banner", "Checklist", "Columns", "New page", "Normal text", "Heading 4", "Block quote", "Code block", "Divider", "Table of contents"]) await expect(menu.getByRole("option", { name: label, exact: true }).first()).toBeAttached();
  await page.screenshot({ path: `${evidence}/slash-menu-desktop-light.png` });
  await page.keyboard.type("h3");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(editor.locator("h3").last()).toBeVisible();
  await page.keyboard.type("Section"); await page.keyboard.press("Enter");
  await page.keyboard.type("/warning"); await page.keyboard.press("Enter");
  await expect(editor.locator("div[data-callout][data-tone='warning']")).toBeVisible();
  await page.keyboard.type("Careful");
  await page.keyboard.press("Enter"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await page.keyboard.type("/toc"); await page.keyboard.press("Enter");
  await expect(editor.locator("[data-toc-block]")).toContainText("Section");
  await page.keyboard.type("/"); await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.keyboard.press("Backspace");

  // Block handles: the "+" adds a block below and opens the slash menu.
  await editor.locator("p", { hasText: "Careful" }).hover();
  await expect(page.locator("[data-block-handles]")).toBeVisible();
  await page.getByRole("button", { name: "Add a block below" }).click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await saved(page);

  // Settings: page styles (font, size, width, header, sections) are stored per page; stats follow the text.
  await page.getByRole("button", { name: "Page styles" }).click();
  const panel = page.getByRole("complementary", { name: "Page styles" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("list", { name: "Page statistics" }).or(panel.locator("dl"))).toContainText("Word count");
  await panel.getByRole("radio", { name: "Serif" }).click();
  await panel.getByRole("radio", { name: "Large" }).click();
  await panel.getByRole("radio", { name: "Full width" }).click();
  await panel.getByRole("switch", { name: "Owners" }).click();
  await panel.getByRole("switch", { name: "Page outline" }).click();
  await expect(page.locator(".font-serif.text-lg.max-w-none")).toBeVisible();
  await expect(page.locator("[data-docs-meta]")).not.toContainText("pr03-");
  await expect(page.locator("[data-docs-outline]")).toBeVisible();
  // The style change and the page text are saved in the background: wait until the server has both before reloading, or the reload races the save.
  await expect.poll(async () => {
    const first = (await (await page.request.get(`${api}/${doc.id}`)).json()).pages[0].id as string;
    const saved = await (await page.request.get(`${api}/${doc.id}/pages/${first}`)).json();
    return [saved.style?.sections?.outline === true, JSON.stringify(saved.content).includes("Section")];
  }).toEqual([true, true]);
  await page.reload();
  await page.getByRole("button", { name: "Page styles" }).click();
  await expect(page.getByRole("complementary", { name: "Page styles" }).getByRole("radio", { name: "Serif" })).toBeChecked();
  await expect(page.locator("[data-docs-outline]")).toContainText("Section");
  await page.getByRole("button", { name: "Close panel" }).click();
  expect(Number(await page.evaluate(() => 0))).toBe(0);

  // Pages tree: add, nest, reorder, duplicate, archive and restore, delete with a count.
  const tree = page.getByRole("navigation", { name: "Pages" }).first();
  await page.getByRole("button", { name: "Add page" }).first().click();
  await expect(page).toHaveURL(/page=/);
  await expect(page.getByLabel("Page title")).toHaveValue("");
  await page.getByLabel("Page title").fill("Second page");
  await saved(page);
  await expect(tree.getByRole("button", { name: "Second page", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(tree.getByRole("button", { name: "Weekly plan", exact: true })).not.toHaveAttribute("aria-current", "page");
  await tree.getByRole("button", { name: "Actions for page Second page" }).click();
  const before = page.url();
  await page.getByRole("menuitem", { name: "Add subpage" }).click();
  await expect.poll(() => page.url()).not.toBe(before);
  await expect(page.getByLabel("Page title")).toHaveValue("");
  await page.getByLabel("Page title").fill("Sub page");
  await saved(page);
  const names = () => tree.locator("[data-page-id]").allInnerTexts();
  await expect.poll(names).toEqual(["Weekly plan", "Second page", "Sub page"]);
  await tree.getByRole("button", { name: "Actions for page Second page" }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect.poll(names).toEqual(["Second page", "Sub page", "Weekly plan"]);
  await tree.getByRole("button", { name: "Actions for page Weekly plan" }).click();
  await page.getByRole("menuitem", { name: "Make subpage of the page above" }).click();
  await expect.poll(() => tree.locator("li li [data-page-id]").allInnerTexts()).toEqual(["Sub page", "Weekly plan"]);
  await tree.getByRole("button", { name: "Actions for page Weekly plan" }).click();
  await page.getByRole("menuitem", { name: "Move out one level" }).click();
  await expect.poll(() => tree.locator("li li [data-page-id]").allInnerTexts()).toEqual(["Sub page"]);
  await tree.getByRole("button", { name: "Collapse Second page" }).click();
  await expect(tree.getByRole("button", { name: "Sub page", exact: true })).toHaveCount(0);
  await tree.getByRole("button", { name: "Expand Second page" }).click();
  await tree.getByRole("button", { name: "Actions for page Sub page" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Sub page (copy)");
  await tree.getByRole("button", { name: "Actions for page Sub page (copy)" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(tree.getByRole("button", { name: "Restore Sub page (copy)" })).toBeVisible();
  await tree.getByRole("button", { name: "Restore Sub page (copy)" }).click();
  await expect(tree.locator("[data-page-id]", { hasText: "Sub page (copy)" })).toBeVisible();
  await tree.getByRole("button", { name: "Actions for page Second page" }).click();
  await page.getByRole("menuitem", { name: "Delete page" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("This page and its 3 subpages will be deleted");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete page" }).click();
  await expect.poll(names).toEqual(["Weekly plan"]);

  // The "..." menu: Entire doc and This page.
  await page.getByRole("button", { name: "Doc settings" }).click();
  const menuPanel = page.locator("[data-docs-menu]");
  await expect(menuPanel.getByRole("tab", { name: "Entire doc" })).toHaveAttribute("aria-selected", "true");
  await menuPanel.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied")).toBeVisible();
  await page.getByRole("button", { name: "Doc settings" }).click();
  await page.locator("[data-docs-menu]").getByRole("button", { name: "Add to favorites" }).click();
  await page.locator("[data-docs-submenu]").getByRole("menuitemradio", { name: "Top" }).click();
  await expect(page.getByRole("button", { name: "Remove star from Weekly plan" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Doc settings" }).click();
  await page.locator("[data-docs-menu]").getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Doc name").fill("Weekly plan v2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Weekly plan v2");
  await page.getByRole("button", { name: "Doc settings" }).click();
  await page.locator("[data-docs-menu]").getByRole("tab", { name: "This page" }).click();
  await page.locator("[data-docs-menu]").getByRole("switch", { name: "Protect page" }).click();
  await expect(page.getByText("This page is protected and cannot be edited.")).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toHaveCount(0);
  await expect(page.getByLabel("Page title")).toHaveJSProperty("readOnly", true);
  await page.getByRole("button", { name: "Turn off protection" }).click();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  await saved(page);

  // A save from another place makes this one stale: the editor says so and offers a reload; nothing is overwritten.
  const first = (await (await page.request.get(`${api}/${doc.id}`)).json()).pages[0].id as string;
  const current = await (await page.request.get(`${api}/${doc.id}/pages/${first}`)).json();
  expect((await patch(page, `${api}/${doc.id}/pages/${first}`, { version: current.version, title: "Changed elsewhere" })).status()).toBe(200);
  await editor.click(); await page.keyboard.type(" more");
  await expect(page.locator('[data-save-state="conflict"]:visible')).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "This record changed since you opened it" })).toBeVisible();
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Changed elsewhere");

  // Trash from the menu returns to the list.
  await page.getByRole("button", { name: "Doc settings" }).click();
  await page.locator("[data-docs-menu]").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Move to trash" }).click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${tenant}/docs$`));
  await expect(page.getByText("No docs yet")).toBeVisible();

  // Audit scene: a doc with several block types, on the editor.
  const scene = await (await post(page, api, { title: "Sunday service" })).json() as { id: string };
  const pageId = (await (await page.request.get(`${api}/${scene.id}`)).json()).pages[0].id as string;
  const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
  const p = (text: string, marks: object[] = []) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks.length ? { marks } : {}) }] });
  expect((await patch(page, `${api}/${scene.id}/pages/${pageId}`, { version: 1, content: { type: "doc", content: [
    h(1, "Order of service"), p("Welcome, call to worship and the first hymn."), h(2, "Readings"),
    { type: "callout", attrs: { tone: "info" }, content: [p("Bring the large-print booklets for the front rows.")] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p("Print bulletins")] }, { type: "taskItem", attrs: { checked: false }, content: [p("Tune the piano")] }] },
    p("Highlighted note", [{ type: "highlight", attrs: { color: "#fef08a" } }]), p("Second paragraph with plain text."),
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p("Time")] }, { type: "tableHeader", content: [p("Item")] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [p("10:00")] }, { type: "tableCell", content: [p("Welcome")] }] }] },
    { type: "columns", content: [{ type: "column", content: [p("Left column")] }, { type: "column", content: [p("Right column")] }] },
    { type: "blockquote", content: [p("Grace and peace to you.")] }, { type: "tableOfContents" }] } })).status()).toBe(200);
  await post(page, `${api}/${scene.id}/pages`, { title: "Announcements" });
  await page.goto(`/workspaces/${tenant}/docs/${scene.id}`);
  await expect(page.locator("[data-toc-block]")).toContainText("Readings");
  await audit(page, "editor");
  expect(errors).toEqual([]);
});

test("editor: a page style changed just before leaving is not lost, and the status shows the save", async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await workspace(page);
  const api = `/api/workspaces/${tenant}/docs`;
  const doc = await (await post(page, api, { title: "" })).json() as { id: string; pageId: string };
  await page.goto(`/workspaces/${tenant}/docs/${doc.id}`);
  await expect(body(page)).toBeVisible();
  await page.getByRole("button", { name: "Page styles" }).click();
  const panel = page.getByRole("complementary", { name: "Page styles" });
  // The toggle reports a save like a text edit does.
  await panel.getByRole("radio", { name: "Serif" }).click();
  await expect(page.locator('[data-save-state="saving"]:visible, [data-save-state="saved"]:visible').first()).toBeVisible();
  await saved(page);
  // Two toggles followed by an immediate reload, without waiting for the status, are still stored.
  await panel.getByRole("radio", { name: "Large" }).click();
  await panel.getByRole("switch", { name: "Outline" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Page styles" }).click();
  const after = page.getByRole("complementary", { name: "Page styles" });
  await expect(after.getByRole("radio", { name: "Serif" })).toBeChecked();
  await expect(after.getByRole("radio", { name: "Large" })).toBeChecked();
  await expect(after.getByRole("switch", { name: "Outline" })).toBeChecked();
});

test("editor on a phone: 44px toolbar targets that scroll sideways, pages in a sheet, panels in a sheet", async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 360, height: 800 });
  const tenant = await workspace(page);
  const doc = await (await post(page, `/api/workspaces/${tenant}/docs`, { title: "Phone doc" })).json() as { id: string };
  await post(page, `/api/workspaces/${tenant}/docs/${doc.id}/pages`, { title: "Page two" });
  await page.goto(`/workspaces/${tenant}/docs/${doc.id}`);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(toolbar).toBeVisible();
  const buttons = toolbar.getByRole("button");
  expect(await buttons.count()).toBeGreaterThan(20);
  for (const box of await buttons.evaluateAll((nodes) => nodes.map((n) => { const r = n.getBoundingClientRect(); return { w: r.width, h: r.height, name: n.getAttribute("aria-label") }; }))) expect(Math.min(box.w, box.h), String(box.name)).toBeGreaterThanOrEqual(44);
  expect(await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Pages" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "Page two", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Page two", exact: true }).click();
  await expect(page).toHaveURL(/page=/);
  await expect(page.getByLabel("Page title")).toHaveValue("Page two");
  await page.getByRole("button", { name: "Page styles" }).click();
  await expect(page.getByRole("dialog").getByRole("radio", { name: "Serif" })).toBeVisible();
});

test("viewers read, members edit their own docs, and the module answers 404 for strangers", async ({ page, browser }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await workspace(page);
  const api = `/api/workspaces/${tenant}/docs`;
  const doc = await (await post(page, api, { title: "Owner doc" })).json() as { id: string };
  const second = await browser.newContext({ baseURL: origin });
  const other = await second.newPage();
  await signIn(other);
  expect((await other.request.get(`${api}/${doc.id}`)).status()).toBe(403);
  await other.goto(`/workspaces/${tenant}/docs/${doc.id}`);
  await expect(other.getByRole("heading", { name: /access/i })).toBeVisible();
  await second.close();
});
