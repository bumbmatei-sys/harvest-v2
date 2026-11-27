import { mkdir, readFile } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Courses follow-up slice 1 (0130): the owner builds Level -> Section -> Lesson with the course's own names and a lesson video link; the learner sees
// the structure and a click-to-load video that requests nothing from the video host before play.
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const shots = process.env.COURSE_STRUCTURE_SHOTS ?? "docs/screenshots/course-structure";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const hydrated = (page: Page) => page.waitForFunction(() => { const field = document.querySelector("input,textarea,select,button[role=radio]"); return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps")); });
const videoHosts = /youtube-nocookie\.com|youtube\.com|ytimg\.com|vkvideo\.ru|vk\.com|userapi\.com/;
/** True when the e2e server noted a dev chunk failure ("<epoch ms> <message>" lines) at or after `since`, that is, during this test. */
const devFailureSince = (log: string, since: number) => log.split("\n").some((line) => Number(line.split(" ", 1)[0]) >= since);
async function openStep(page: Page, name: string) {
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: /Show all steps/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: new RegExp(name) }).first().click();
  } else await page.getByRole("button", { name: new RegExp(`^(Step \\d+ )?${name}`) }).first().click();
}
async function check(page: Page, name: string, width: number, scheme: string) {
  await page.mouse.move(0, 0);
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations, `${name} ${width} ${scheme}`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width} ${scheme} scrolls sideways`).toBe(true);
}

test("owner names and builds levels and sections with a video lesson; the learner sees the structure and a click-to-load video", async ({ page, browser }) => {
  test.setTimeout(900_000);
  const started = Date.now();
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Church", audience: "church" } })).json()).tenantId as string;
  const slug = `discipleship-${Date.now().toString(36)}`;
  const created = await page.request.post(`/api/workspaces/${tenant}/catalog`, { headers: { origin }, data: { kind: "course", slug, title: "Discipleship path", visibility: "unlisted",
    lessons: [{ title: "Welcome", body: body("You are here."), published: true }] } });
  expect(created.status()).toBe(200);
  const { id } = await created.json() as { id: string };
  const editor = `/workspaces/${tenant}/products/${id}`;

  // A course without levels is the plain lesson list, as before.
  await page.goto(editor);
  await hydrated(page);
  await openStep(page, "Lessons");
  await expect(page.locator("[data-lesson]")).toHaveCount(1);
  await expect(page.locator("[data-section], [data-level]")).toHaveCount(0);

  // Rename the parts, then add a section and a level: the first level takes every section.
  await page.getByLabel("Level name").fill("Module");
  await page.getByLabel("Section name").fill("Week");
  await page.getByRole("button", { name: "Add Week" }).click();
  await expect(page.locator("[data-section]")).toHaveCount(2);
  await page.getByRole("button", { name: "Add Module" }).click();
  await expect(page.locator("[data-level]")).toHaveCount(1);
  await expect(page.getByPlaceholder("Module 1")).toBeVisible();
  await page.getByLabel("Title of Module 1").fill("Foundations");
  await page.getByLabel("Title of Week 1").fill("Getting started");
  await page.getByLabel("Title of Week 2").fill("Prayer");
  const week2 = page.locator("[data-section]").nth(1);
  // The dev server may apply a hot update during the first click; retry until the lesson is there (one click adds one lesson).
  await expect(async () => {
    if (await week2.locator("[data-lesson]").count() === 0) await week2.getByRole("button", { name: "Add lesson" }).click();
    await expect(week2.locator("[data-lesson]")).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByLabel("Title of lesson 2").fill("Praying daily");
  await week2.locator("[data-lesson]").getByRole("switch", { name: "Published" }).click();

  // Up and down carry a lesson across the section edge and back.
  await page.getByRole("button", { name: "Move lesson 1 down" }).click();
  await expect(week2.locator("[data-lesson]")).toHaveCount(2);
  await expect(page.locator("[data-section]").first().locator("[data-lesson]")).toHaveCount(0);
  await page.getByRole("button", { name: "Move lesson 1 up" }).click();
  await expect(page.locator("[data-section]").first().locator("[data-lesson]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Move lesson 1 up" })).toBeDisabled();

  // A link that is not an accepted video link stops the save; a real one is kept as provider and id.
  const video = page.getByLabel("Video link").nth(1);
  await video.fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Use a video link from a supported site." })).toBeVisible();
  await expect(page.getByText("Use a supported video link.")).toBeVisible();
  await video.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s");
  await page.getByRole("button", { name: "Save draft" }).click();
  // The first save compiles the edit route on the dev server.
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible({ timeout: 90_000 });

  await page.reload();
  await hydrated(page);
  await openStep(page, "Lessons");
  await expect(page.getByLabel("Level name")).toHaveValue("Module");
  await expect(page.getByLabel("Title of Module 1")).toHaveValue("Foundations");
  await expect(page.getByLabel("Title of Week 2")).toHaveValue("Prayer");
  await expect(page.getByLabel("Video link").nth(1)).toHaveValue("https://youtu.be/dQw4w9WgXcQ");
  for (const scheme of ["light", "dark"] as const) for (const [width, height] of [[1280, 900], [360, 800]] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width, height });
    await expect(page.locator("[data-level]")).toBeVisible();
    await check(page, "editor-structure", width, scheme);
    await page.screenshot({ path: `${shots}/editor-structure-${width}-${scheme}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await openStep(page, "Publish");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Published." })).toBeVisible();

  // The learner: the structure in the side list, and no request to a video host until play.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }), learner = await context.newPage();
  const requests: string[] = [];
  learner.on("request", (request) => { if (videoHosts.test(new URL(request.url()).hostname)) requests.push(request.url()); });
  // Nothing leaves this machine: frame requests to the embed host are answered locally.
  await context.route(videoHosts, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>video</title>" }));
  await signIn(learner);
  expect((await learner.request.post(`/api/catalog/${slug}/enrolment`, { headers: { origin } })).status()).toBe(200);
  const content = await (await learner.request.get(`/api/catalog/${slug}/content`)).json();
  const second = content.lessons[1].id as string;
  expect(content.lessons[1].video).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
  await learner.goto(`/courses/${slug}/learn?lesson=${second}`);
  const aside = learner.locator("aside");
  await expect(aside.getByRole("heading", { name: "Foundations" })).toBeVisible();
  await expect(aside.getByRole("region", { name: "Getting started" }).locator("[data-lesson-link]")).toHaveCount(1);
  await expect(aside.getByRole("region", { name: "Prayer" }).locator("[data-lesson-link]")).toHaveCount(1);
  await expect(learner.locator("p:visible", { hasText: "Lesson 2 of 2" }).first()).toBeVisible();
  await expect(learner.getByRole("button", { name: "Play video" })).toBeVisible();
  await expect(learner.locator("iframe")).toHaveCount(0);
  for (const scheme of ["light", "dark"] as const) for (const [width, height] of [[1280, 900], [360, 800]] as const) {
    await learner.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await learner.setViewportSize({ width, height });
    await expect(learner.getByRole("button", { name: "Play video" })).toBeVisible();
    await check(learner, "learner-structure", width, scheme);
    await learner.screenshot({ path: `${shots}/learner-structure-${width}-${scheme}.png`, fullPage: true });
    if (width < 1024) {
      // A click before the reloaded page hydrates is lost: open the sheet until it is there.
      await expect(async () => {
        if (!await learner.getByRole("dialog").isVisible()) await learner.getByRole("button", { name: "Lessons" }).click();
        await expect(learner.getByRole("dialog").getByRole("heading", { name: "Foundations" })).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await check(learner, "learner-structure-sheet", width, scheme);
      await learner.screenshot({ path: `${shots}/learner-sheet-${width}-${scheme}.png` });
      await learner.keyboard.press("Escape");
    }
  }
  expect(requests, "a video host was contacted before play").toEqual([]);
  await learner.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await learner.setViewportSize({ width: 1280, height: 900 });
  await learner.getByRole("button", { name: "Play video" }).click();
  const frame = learner.locator("iframe[data-lesson-video-frame]");
  await expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
  await expect(frame).toHaveAttribute("title", "Video: Praying daily");
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.every((url) => new URL(url).hostname === "www.youtube-nocookie.com")).toBe(true);
  await learner.screenshot({ path: `${shots}/learner-playing-1280-light.png` });
  // A hydration mismatch is ignored only when the dev server also reported a chunk failure in this run ("__webpack_modules__[moduleId] is not a
  // function" or "destination stream errored", noted by scripts/e2e-server.ts): that cut stream, not this page, is then the cause. Anything else fails.
  const devChunkFailure = devFailureSince(await readFile(`${process.env.HARVEST_E2E_MAILBOX}.dev-errors`, "utf8").catch(() => ""), started);
  expect(errors.filter((message) => !(devChunkFailure && message.startsWith("Hydration failed because the server rendered HTML didn't match the client")))).toEqual([]);
});
