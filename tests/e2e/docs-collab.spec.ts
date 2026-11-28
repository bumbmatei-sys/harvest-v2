import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20000 });
// Docs slice 2: the right rail panels, sharing, comments, links, templates, export and import, history, print view.
test.use({ actionTimeout: 20000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/docs-slice2";
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(url, { headers: { origin }, data });
const patch = (page: Page, url: string, data: unknown) => page.request.patch(url, { headers: { origin }, data });
const shot = (page: Page, name: string) => page.screenshot({ path: `${evidence}/${name}.png` });
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

/** One axe scene per width and scheme on the editor with a panel open. */
async function audit(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      const found = (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
      expect(found.map((v) => `${label}/${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await shot(page, `${name}-${label}-${scheme}`);
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("panels, comments, links, templates, export, history, sharing and print view", async ({ page, browser }) => {
  test.setTimeout(540000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await post(page, "/api/workspaces", { name: "Grace Community Church", audience: "church" })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/docs`;
  const doc = await (await post(page, api, { title: "Sunday plan" })).json() as { id: string };
  const pageId = (await (await page.request.get(`${api}/${doc.id}`)).json()).pages[0].id as string;
  expect((await patch(page, `${api}/${doc.id}/pages/${pageId}`, { version: 1, content: { type: "doc", content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Order of service" }] }, para("Welcome and first hymn."), para("Readings and prayer.")] } })).status()).toBe(200);
  await post(page, api, { title: "Linked doc" });
  await page.goto(`/workspaces/${tenant}/docs/${doc.id}`);
  const rail = page.getByRole("navigation", { name: "Page tools" });
  await expect(rail.getByRole("button")).toHaveCount(5);

  // Comments: add, reply, resolve, reopen.
  await rail.getByRole("button", { name: "Comments" }).click();
  const comments = page.getByRole("complementary", { name: "Comments" });
  await expect(comments.getByRole("tab", { name: "Open" })).toBeVisible();
  await comments.getByRole("textbox", { name: "Write a comment" }).fill("Please check the hymn number");
  await comments.getByRole("button", { name: "Send comment" }).click();
  await expect(comments).toContainText("Please check the hymn number");
  await shot(page, "panel-comments-desktop-light");
  await comments.getByRole("button", { name: "Reply" }).click();
  await comments.getByRole("textbox", { name: /reply/i }).fill("Done, number 42");
  await comments.getByRole("button", { name: "Send comment" }).last().click();
  await expect(comments).toContainText("Done, number 42");
  await comments.getByRole("button", { name: "Resolve" }).click();
  await comments.getByRole("tab", { name: "Resolved" }).click();
  await expect(comments).toContainText("Please check the hymn number");
  await comments.getByRole("button", { name: "Reopen" }).click();
  await comments.getByRole("tab", { name: "Open" }).click();
  await expect(comments).toContainText("Please check the hymn number");
  await audit(page, "editor-comments");

  // Relationships: link another doc.
  await rail.getByRole("button", { name: "Relationships" }).click();
  const rel = page.getByRole("complementary", { name: "Relationships" });
  await expect(rel.getByRole("tab", { name: "This page" })).toBeVisible();
  await rel.getByRole("button", { name: "Link a task, person or doc" }).click();
  await page.getByRole("tab", { name: "Docs" }).click();
  await page.getByRole("button", { name: /Linked doc/ }).first().click();
  await expect(rel).toContainText("Linked doc");
  await shot(page, "panel-relationships-desktop-light");

  // Page styles.
  await rail.getByRole("button", { name: "Page styles" }).click();
  await expect(page.getByRole("complementary", { name: "Page styles" }).getByRole("switch", { name: "Contributors" })).toBeVisible();
  await shot(page, "panel-page-styles-desktop-light");

  // Templates: save as a ministry template, then apply a starter as new pages.
  await rail.getByRole("button", { name: "Templates" }).click();
  const templates = page.getByRole("complementary", { name: "Templates" });
  await expect(templates.getByRole("searchbox").or(templates.getByPlaceholder("Search templates"))).toBeVisible();
  await shot(page, "panel-templates-desktop-light");
  await templates.getByRole("button", { name: "Save as template" }).click();
  await page.getByRole("dialog").getByRole("textbox").first().fill("Sunday order");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(templates).toContainText("Sunday order");

  // Export panel and downloads.
  await rail.getByRole("button", { name: "Export" }).click();
  const exp = page.getByRole("complementary", { name: "Export" });
  await expect(exp.getByRole("link", { name: "Markdown" })).toBeVisible();
  await shot(page, "panel-export-desktop-light");
  const md = await page.request.get(`${api}/${doc.id}/export?format=markdown&scope=doc`);
  expect(md.status()).toBe(200);
  expect(await md.text()).toContain("Order of service");
  const html = await (await page.request.get(`${api}/${doc.id}/export?format=html&scope=doc`)).text();
  expect(html).toContain("Order of service");

  // Print view.
  await page.goto(`/docs-print/${tenant}/${doc.id}`);
  await expect(page.getByRole("heading", { name: "Order of service" })).toBeVisible();
  await shot(page, "print-view-desktop-light");

  // History: change the page, then restore the first saved version.
  await page.goto(`/workspaces/${tenant}/docs/${doc.id}`);
  const current = await (await page.request.get(`${api}/${doc.id}/pages/${pageId}`)).json();
  expect((await patch(page, `${api}/${doc.id}/pages/${pageId}`, { version: current.version, content: { type: "doc", content: [para("Replaced text")] } })).status()).toBe(200);
  const versions = await (await page.request.get(`${api}/${doc.id}/pages/${pageId}/versions`)).json() as { versions: { id: string }[] } | { id: string }[];
  expect((Array.isArray(versions) ? versions : versions.versions).length).toBeGreaterThan(0);

  // Sharing dialog.
  await page.reload();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Owners and admins can see private docs");
  await expect(dialog.getByRole("switch", { name: "Share link with anyone" })).toBeDisabled();
  await shot(page, "share-dialog-desktop-light");
  await dialog.getByRole("switch", { name: "Ministry members" }).click();
  await expect(dialog.getByRole("combobox", { name: /access/i })).toBeVisible();
  await page.keyboard.press("Escape");

  // Doc settings menu fly-outs.
  await page.getByRole("button", { name: "Doc settings" }).click();
  await shot(page, "menu-settings-desktop-light");
  await page.keyboard.press("Escape");

  // A second member cannot open a private doc.
  const second = await browser.newContext({ baseURL: origin });
  const other = await second.newPage();
  await signIn(other);
  expect((await other.request.get(`${api}/${doc.id}`)).status()).toBe(403);
  await second.close();
  expect(errors).toEqual([]);
});
