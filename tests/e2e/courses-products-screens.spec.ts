import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Browser, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const evidence = "docs/screenshots/courses-products";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
/** The dev server renders first and hydrates after: a click before React attaches is lost. */
const hydrated = (page: Page) => page.waitForFunction(() => { const field = document.querySelector("input,textarea,select,button[role=radio]"); return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps")); });
async function setup(page: Page) {
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Church", audience: "church" } })).json()).tenantId as string;
  const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Course community", slug: `course-community-${Date.now().toString(36)}` } })).json()) as { id: string };
  return { tenant, community: community.id, root: `/workspaces/${tenant}/products` };
}
async function asRole(browser: Browser, owner: Page, tenant: string, role: "member" | "viewer") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }), page = await context.newPage();
  const email = await signIn(page);
  expect((await owner.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email, role } })).status()).toBe(200);
  return { page, context };
}
const step = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^(Step \\d+ )?${name}`) }).first();
async function openStep(page: Page, name: string) {
  const width = page.viewportSize()!.width;
  if (width < 1024) {
    await page.getByRole("button", { name: /Show all steps/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: new RegExp(name) }).first().click();
  } else await step(page, name).click();
}

test("owner flow: pick a type, build a course with ordered lessons, publish, shelve it; build and publish a download; members only read", async ({ page, browser }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400 && response.url().includes("/api/")) console.log("API", response.status(), response.request().method(), response.url()); });
  const { tenant, community, root } = await setup(page);

  // The empty list leads to the type picker.
  await page.goto(root);
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();
  await expect(page.getByText("No products yet")).toBeVisible();
  await page.getByRole("link", { name: "New product" }).first().click();
  await expect(page.getByRole("heading", { name: "New product", level: 1 })).toBeVisible();
  await expect(page.locator("[data-catalog-type]")).toHaveCount(2);
  await expect(page.locator('[data-catalog-type] [data-catalog-type-art][aria-hidden="true"]')).toHaveCount(2);

  // Course: the address follows the title; creating the draft opens its editor.
  await page.locator('[data-catalog-type="course"]').click();
  await expect(page.getByRole("heading", { name: "New course", level: 1 })).toBeVisible();
  await hydrated(page);
  await page.getByLabel("Title", { exact: true }).fill("Bible basics");
  await expect(page.getByLabel("Address", { exact: true })).toHaveValue("bible-basics");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { name: "Bible basics", level: 1 })).toBeVisible();
  const itemId = page.url().split("/").pop()!;
  await hydrated(page);

  // Lessons: add, write, reorder, publish one; Save keeps the order across a reload.
  await openStep(page, "Lessons");
  await page.getByRole("button", { name: "Add lesson" }).click();
  await page.getByLabel("Title of lesson 1").fill("Welcome");
  await page.getByRole("textbox", { name: "Content of lesson 1" }).click();
  await page.keyboard.type("Start here.");
  await page.getByRole("button", { name: "Add lesson" }).click();
  await page.getByLabel("Title of lesson 2").fill("Prayer");
  await page.getByRole("button", { name: "Move lesson 1 down" }).click();
  await expect(page.getByLabel("Title of lesson 1")).toHaveValue("Prayer");
  await expect(page.getByLabel("Title of lesson 2")).toHaveValue("Welcome");
  await expect(page.getByRole("button", { name: "Move lesson 1 up" })).toBeDisabled();
  await page.locator("[data-lesson]").nth(1).getByRole("switch", { name: "Published" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.reload();
  await hydrated(page);
  await openStep(page, "Lessons");
  await expect(page.getByLabel("Title of lesson 1")).toHaveValue("Prayer");
  await expect(page.getByLabel("Title of lesson 2")).toHaveValue("Welcome");

  // A lesson without a title is refused before any request.
  await page.getByRole("button", { name: "Add lesson" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Give every lesson a title." })).toBeVisible();
  await page.getByRole("button", { name: "Remove lesson 3" }).click();

  // Access: any visibility can be published (hidden then shows only on community shelves); the shelf waits for publication.
  await openStep(page, "Access");
  await expect(page.getByText("Publish this item to add it to a community shelf.")).toBeVisible();
  await page.getByRole("radio", { name: /Unlisted/ }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Published." })).toBeVisible();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

  // Community shelf: one switch per community; the link confers no access (the learner content stays closed).
  await openStep(page, "Access");
  await page.getByRole("switch", { name: "Course community" }).click();
  await expect.poll(async () => ((await (await page.request.get(`/api/workspaces/${tenant}/catalog/${itemId}`)).json()).communityIds as string[])).toEqual([community]);
  await expect(page.getByText("A shelf shows the item. People still sign in and enrol to open it.")).toBeVisible();
  expect((await page.request.get("/api/catalog/bible-basics/content")).status()).toBe(404);

  // Download: files come from the private file service; only a ready file lets it publish.
  await page.goto(`${root}/new/download`);
  await hydrated(page);
  await page.getByLabel("Title", { exact: true }).fill("Study guide");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`));
  await hydrated(page);
  await openStep(page, "Files");
  await expect(page.getByText("No files chosen")).toBeVisible();
  // The sign-in helper pins x-forwarded-for on the whole context; the storage stand-in's CORS preflight does not allow it, so the browser upload would be refused.
  await page.context().setExtraHTTPHeaders({});
  await page.getByLabel("Choose a file to upload").setInputFiles({ name: "guide.txt", mimeType: "text/plain", buffer: Buffer.from("Study guide\n".repeat(200)) });
  const chosen = page.getByRole("list", { name: "Files in this download" });
  await expect(chosen.getByText("guide.txt")).toBeVisible();
  await expect(chosen.getByText("Ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Move guide.txt up" })).toBeDisabled();
  await openStep(page, "Access");
  await page.getByRole("radio", { name: /Listed/ }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Published." })).toBeVisible();

  // The lists: everything under Products, only courses under Courses; search and the type tab narrow the rows.
  await page.goto(root);
  await expect(page.getByRole("link", { name: "Bible basics", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Study guide", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Courses" }).click();
  await expect(page.getByRole("link", { name: "Study guide", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("searchbox", { name: "Search by name" }).fill("guide");
  await expect(page.getByRole("link", { name: "Bible basics", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search by name" }).fill("zzz");
  await expect(page.getByText("No matches")).toBeVisible();
  await page.goto(`/workspaces/${tenant}/courses`);
  await expect(page.getByRole("heading", { name: "Courses", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bible basics", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Study guide", exact: true })).toHaveCount(0);

  // Denied roles do not see the controls. Members read published items; nothing can be created or changed.
  for (const role of ["member", "viewer"] as const) {
    const person = await asRole(browser, page, tenant, role);
    await person.page.goto(root);
    await expect(person.page.getByRole("link", { name: "Bible basics", exact: true })).toBeVisible();
    await expect(person.page.getByRole("link", { name: "New product" })).toHaveCount(0);
    await person.page.goto(`${root}/new`);
    await expect(person.page.getByRole("heading", { name: "New product" })).toHaveCount(0);
    await person.page.goto(`${root}/${itemId}`);
    await expect(person.page.getByText("You can read this item. Owners and admins edit it.")).toBeVisible();
    await expect(person.page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
    await expect(person.page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
    expect((await person.page.request.put(`/api/workspaces/${tenant}/catalog/${itemId}`, { headers: { origin }, data: {} })).status()).toBe(404);
    await person.context.close();
  }
  expect(errors).toEqual([]);
});

test("a taken address and a stale version are explained, not lost", async ({ page }) => {
  test.setTimeout(240_000);
  const { tenant, root } = await setup(page);
  const lessons = [{ title: "One", body: body("x"), published: true }];
  expect((await page.request.post(`/api/workspaces/${tenant}/catalog`, { headers: { origin }, data: { kind: "course", slug: "taken-address", title: "First", visibility: "unlisted", lessons } })).status()).toBe(200);
  await page.goto(`${root}/new/course`);
  await hydrated(page);
  await page.getByLabel("Title", { exact: true }).fill("Taken address");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(new RegExp("/new/course$"));
  // A change made elsewhere is a conflict with a reload action.
  await page.getByLabel("Address", { exact: true }).fill("fresh-address");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(new RegExp(`${root}/[0-9a-f-]{36}$`));
  await hydrated(page);
  const id = page.url().split("/").pop()!;
  const current = await (await page.request.get(`/api/workspaces/${tenant}/catalog/${id}`)).json();
  expect((await page.request.put(`/api/workspaces/${tenant}/catalog/${id}`, { headers: { origin }, data: { version: current.version, draft: { kind: "course", slug: "fresh-address", title: "Changed elsewhere", visibility: "hidden", lessons: [] } } })).status()).toBe(200);
  await page.getByLabel("Title", { exact: true }).fill("My edit");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("alert").getByRole("button", { name: "Reload" })).toBeVisible();
});

// Evidence and accessibility: the list, the type picker, the course editor (lessons), the download editor (files) and the access step at three widths in both schemes.
test("screens: axe, no sideways scroll and screenshots at 360, 768 and 1280 in light and dark", async ({ page }) => {
  test.setTimeout(600_000);
  await mkdir(evidence, { recursive: true });
  const { tenant, root } = await setup(page);
  const lessonBody = (text: string) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] }, { type: "paragraph", content: [{ type: "text", text: "A short lesson for the evidence screenshots." }] }] });
  const course = await (await page.request.post(`/api/workspaces/${tenant}/catalog`, { headers: { origin }, data: { kind: "course", slug: "discipleship-basics", title: "Discipleship basics", summary: "Six lessons for new believers.", visibility: "listed",
    lessons: [{ title: "Welcome", body: lessonBody("Welcome"), published: true }, { title: "Prayer", body: lessonBody("Prayer"), published: true }, { title: "Scripture", body: lessonBody("Scripture"), published: false }] } })).json();
  await page.request.put(`/api/workspaces/${tenant}/catalog/${course.id}/state`, { headers: { origin }, data: { version: course.version, state: "published" } });
  expect((await page.request.post(`/api/workspaces/${tenant}/catalog`, { headers: { origin }, data: { kind: "download", slug: "welcome-guide", title: "Welcome guide", summary: "A printable guide for visitors.", visibility: "unlisted", fileIds: [] } })).status()).toBe(200);
  const pages: [string, string][] = [["list", root], ["picker", `${root}/new`], ["course-lessons", `${root}/${course.id}`], ["download-new", `${root}/new/download`], ["course-new", `${root}/new/course`]];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [width, height] of [[1280, 900], [768, 1024], [360, 800]] as const) {
      await page.setViewportSize({ width, height });
      for (const [name, path] of pages) {
        await page.goto(path);
        if (name === "list") await expect(page.getByRole("link", { name: "Discipleship basics", exact: true })).toBeVisible();
        else if (name === "picker") await expect(page.locator("[data-catalog-type]")).toHaveCount(2);
        else await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (name !== "list" && name !== "picker") await hydrated(page);
        if (name === "course-lessons") { await openStep(page, "Lessons"); await expect(page.locator("[data-lesson]")).toHaveCount(3); }
        if (name === "download-new") { await page.getByLabel("Title", { exact: true }).fill("Welcome guide files"); }
        await page.mouse.move(0, 0);
        await settleForAxe(page);
        expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations, `${name} ${width} ${scheme}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width} ${scheme} scrolls sideways`).toBe(true);
        if (name === "picker") {
          const sizes = await page.locator("[data-catalog-type-art]").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
          for (const size of sizes) expect(size).toBeGreaterThanOrEqual(100);
          for (const target of await page.locator("[data-catalog-type]").all()) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({ path: `${evidence}/${name}-${width}-${scheme}.png`, fullPage: true });
      }
    }
  }
});
