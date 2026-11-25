import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const evidence = "docs/screenshots/courses-products";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const lessonBody = (title: string, text: string) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: title }] }, { type: "paragraph", content: [{ type: "text", text }] }] });
const hydrated = (page: Page) => page.waitForFunction(() => { const field = document.querySelector("button"); return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps")); });

/** An owner with a published course (two published lessons, one draft lesson) and a published download with one ready file. */
async function seed(owner: Page) {
  await signIn(owner);
  const tenant = (await (await owner.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}`, stamp = Date.now().toString(36);
  const courseSlug = `discipleship-${stamp}`, downloadSlug = `welcome-guide-${stamp}`;
  const course = await (await owner.request.post(`${api}/catalog`, { headers: { origin }, data: { kind: "course", slug: courseSlug, title: "Discipleship basics", summary: "Six lessons for new believers.", visibility: "listed",
    lessons: [{ title: "Welcome", body: lessonBody("Welcome", "You are here."), published: true }, { title: "Prayer", body: lessonBody("Prayer", "Talk with God."), published: true },
      { title: "Hidden draft", body: lessonBody("Hidden draft", "Not for learners yet."), published: false }] } })).json();
  expect((await owner.request.put(`${api}/catalog/${course.id}/state`, { headers: { origin }, data: { version: course.version, state: "published" } })).status()).toBe(200);
  const bytes = Buffer.from("Welcome guide\n".repeat(50));
  const created = await (await owner.request.post(`${api}/files`, { headers: { origin }, data: { name: "welcome-guide.txt", mime: "text/plain", size: bytes.length, checksum: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"), visibility: "private" } })).json();
  const put = await owner.request.put(created.upload.url, { headers: created.upload.headers, data: bytes });
  expect(put.ok(), `storage PUT ${put.status()}`).toBe(true);
  expect((await owner.request.post(`${api}/files/${created.file.id}/confirm`, { headers: { origin } })).status()).toBe(200);
  const download = await (await owner.request.post(`${api}/catalog`, { headers: { origin }, data: { kind: "download", slug: downloadSlug, title: "Welcome guide", summary: "A printable guide for visitors.", visibility: "listed", fileIds: [created.file.id] } })).json();
  expect((await owner.request.put(`${api}/catalog/${download.id}/state`, { headers: { origin }, data: { version: download.version, state: "published" } })).status()).toBe(200);
  return { tenant, courseSlug, downloadSlug, fileId: created.file.id as string };
}

test("visitor, learner and download: sign in to enrol, free enrolment, lessons in order, protected files", async ({ page: owner, browser }) => {
  test.setTimeout(420_000);
  const { courseSlug, downloadSlug, fileId } = await seed(owner);

  // A signed-out visitor sees only the public metadata and a sign-in action; no lesson, file or learner appears.
  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" })).newPage();
  await visitor.goto(`/courses/${courseSlug}`);
  await expect(visitor.getByRole("heading", { name: "Discipleship basics", level: 1 })).toBeVisible();
  await expect(visitor.getByText("Six lessons for new believers.")).toBeVisible();
  await expect(visitor.getByText("Free", { exact: true }).first()).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Sign in to enrol" })).toHaveAttribute("href", `/sign-in?personal=1&next=${encodeURIComponent(`/courses/${courseSlug}`)}`);
  await expect(visitor.getByText("Welcome", { exact: true })).toHaveCount(0);
  await expect(visitor.getByText(/\$|price|checkout/i)).toHaveCount(0);
  expect((await visitor.request.get(`/api/catalog/${courseSlug}/content`)).status()).toBe(401);
  // The lessons page sends a signed-out visitor to sign-in, with a way back; a download slug on the course route moves to its own page; an unknown address is not found.
  await visitor.goto(`/courses/${courseSlug}/learn`);
  await expect.poll(() => visitor.url()).toContain(`/sign-in?personal=1&next=${encodeURIComponent(`/courses/${courseSlug}/learn`)}`);
  await visitor.goto(`/courses/${downloadSlug}`);
  await expect(visitor).toHaveURL(new RegExp(`/products/${downloadSlug}$`));
  expect((await visitor.goto("/courses/no-such-course"))?.status()).toBe(404);

  // A learner enrols for free and reads the published lessons in order; the draft lesson never arrives.
  const learner = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" })).newPage();
  await signIn(learner);
  await learner.goto(`/courses/${courseSlug}`);
  await hydrated(learner);
  await learner.getByRole("button", { name: "Enrol for free" }).click();
  await learner.waitForURL(`**/courses/${courseSlug}/learn`);
  await expect(learner.getByRole("heading", { name: "Discipleship basics", level: 1 })).toBeVisible();
  await expect(learner.getByRole("heading", { name: "Welcome", level: 2 }).first()).toBeVisible();
  await expect(learner.locator("[data-lesson-link]")).toHaveCount(2);
  await expect(learner.getByText("Hidden draft")).toHaveCount(0);
  await expect(learner.locator("p:visible", { hasText: "Lesson 1 of 2" }).first()).toBeVisible();
  await learner.getByRole("link", { name: "Next lesson" }).click();
  await expect(learner).toHaveURL(/lesson=/);
  await expect(learner.getByText("Talk with God.")).toBeVisible();
  await expect(learner.locator("p:visible", { hasText: "Lesson 2 of 2" }).first()).toBeVisible();
  await expect(learner.getByRole("link", { name: "Next lesson" })).toHaveCount(0);
  // Enrolling again is the same result; the public page now offers the lessons instead.
  expect((await learner.request.post(`/api/catalog/${courseSlug}/enrolment`, { headers: { origin } })).status()).toBe(200);
  await learner.goto(`/courses/${courseSlug}`);
  await expect(learner.getByRole("link", { name: "Open lessons" })).toBeVisible();
  await expect(learner.getByText("You are enrolled.")).toBeVisible();

  // A download lists its files only after enrolment, and each click asks for a fresh signed address.
  await learner.goto(`/products/${downloadSlug}`);
  await hydrated(learner);
  await expect(learner.getByRole("list", { name: "Files" })).toHaveCount(0);
  expect((await learner.request.get(`/api/catalog/${downloadSlug}/files/${fileId}`)).status()).toBe(404);
  await learner.getByRole("button", { name: "Get for free" }).click();
  const list = learner.getByRole("list", { name: "Files" });
  await expect(list.getByText("welcome-guide.txt")).toBeVisible();
  const signed = learner.waitForResponse((response) => response.url().includes(`/api/catalog/${downloadSlug}/files/${fileId}`) && response.request().method() === "GET");
  await list.getByRole("button", { name: "Download welcome-guide.txt" }).click();
  const response = await signed;
  expect(response.status()).toBe(200);
  expect((await response.json()).url).toMatch(/^http/);
});

test("public and learner screens: axe, no sideways scroll and screenshots at 360, 768 and 1280 in light and dark", async ({ page: owner, browser }) => {
  test.setTimeout(900_000);
  await mkdir(evidence, { recursive: true });
  const { courseSlug, downloadSlug } = await seed(owner);
  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" })).newPage();
  const learner = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" })).newPage();
  await signIn(learner);
  for (const slug of [courseSlug, downloadSlug]) expect((await learner.request.post(`/api/catalog/${slug}/enrolment`, { headers: { origin } })).status()).toBe(200);
  const screens: [string, Page, string, () => Promise<void>][] = [
    ["public-course", visitor, `/courses/${courseSlug}`, async () => { await expect(visitor.getByRole("link", { name: "Sign in to enrol" })).toBeVisible(); }],
    ["public-download", visitor, `/products/${downloadSlug}`, async () => { await expect(visitor.getByRole("link", { name: "Sign in to get it" })).toBeVisible(); }],
    ["learner-lessons", learner, `/courses/${courseSlug}/learn`, async () => { await expect(learner.locator("p:visible", { hasText: "Lesson 1 of 2" }).first()).toBeVisible(); }],
    ["learner-download", learner, `/products/${downloadSlug}`, async () => { await expect(learner.getByText("welcome-guide.txt")).toBeVisible(); }],
    ["discover-courses", visitor, "/discover?type=course", async () => { await expect(visitor.getByRole("heading", { name: "Discover", level: 1 })).toBeVisible(); }],
  ];
  for (const scheme of ["light", "dark"] as const) {
    for (const [width, height] of [[1280, 900], [768, 1024], [360, 800]] as const) {
      for (const [name, page, path, ready] of screens) {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.setViewportSize({ width, height });
        await page.goto(path);
        await ready();
        await page.mouse.move(0, 0);
        await settleForAxe(page);
        expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations, `${name} ${width} ${scheme}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width} ${scheme} scrolls sideways`).toBe(true);
        if (name === "learner-lessons" && width < 1024) {
          await page.getByRole("button", { name: "Lessons" }).click();
          await expect(page.getByRole("dialog").locator("[data-lesson-link]")).toHaveCount(2);
          await settleForAxe(page);
          expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations, `${name} sheet ${width} ${scheme}`).toEqual([]);
          await page.screenshot({ path: `${evidence}/${name}-sheet-${width}-${scheme}.png` });
          await page.keyboard.press("Escape");
        }
        await page.screenshot({ path: `${evidence}/${name}-${width}-${scheme}.png`, fullPage: true });
      }
    }
  }
});
