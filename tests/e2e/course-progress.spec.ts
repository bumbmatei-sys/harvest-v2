import { mkdir, readFile } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Courses follow-up slice 2 (0131): a learner completes lessons, sees the percentage, writes a private note and finds it on My notes.
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const shots = process.env.COURSE_PROGRESS_SHOTS ?? "docs/screenshots/course-progress";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
/** Axe and no sideways scroll. A dev-server reload can navigate mid-check ("execution context destroyed"); only that is retried, never a violation. */
async function check(page: Page, name: string, width: number, scheme: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.mouse.move(0, 0);
      await settleForAxe(page);
      const violations = (await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations;
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      expect(violations, `${name} ${width} ${scheme}`).toEqual([]);
      expect(fits, `${name} ${width} ${scheme} scrolls sideways`).toBe(true);
      return;
    } catch (error) {
      if (attempt >= 2 || !/Execution context was destroyed|navigation/i.test(String(error))) throw error;
      await page.waitForLoadState("load");
    }
  }
}
/** A click before the page hydrates is lost on a busy dev server: repeat it until the expected change shows. */
async function clickUntil(page: Page, name: string | RegExp, done: () => Promise<void>) {
  await expect(async () => {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible()) await button.click({ timeout: 5_000 });
    await done();
  }).toPass({ timeout: 60_000 });
}

test("a learner completes lessons, sees the percentage, writes a note and finds it on My notes", async ({ page: owner, browser }) => {
  test.setTimeout(900_000);
  const started = Date.now();
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  await signIn(owner);
  const tenant = (await (await owner.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Church", audience: "church" } })).json()).tenantId as string;
  const slug = `walk-${Date.now().toString(36)}`;
  const created = await (await owner.request.post(`/api/workspaces/${tenant}/catalog`, { headers: { origin }, data: { kind: "course", slug, title: "Walking with God", visibility: "unlisted",
    sections: [{ title: "Week one", lessons: [{ title: "Prayer", body: body("Talk with God."), published: true }, { title: "Scripture", body: body("Read daily."), published: true },
      { title: "Community", body: body("Meet together."), published: true }] }] } })).json() as { id: string; version: number };
  expect((await owner.request.put(`/api/workspaces/${tenant}/catalog/${created.id}/state`, { headers: { origin }, data: { version: created.version, state: "published" } })).status()).toBe(200);

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }), learner = await context.newPage();
  learner.on("pageerror", (error) => errors.push(error.message));
  await signIn(learner);
  expect((await learner.request.post(`/api/catalog/${slug}/enrolment`, { headers: { origin } })).status()).toBe(200);
  await learner.goto(`/courses/${slug}/learn`);
  const percent = learner.locator("aside [data-progress-percent]");
  await expect(percent).toHaveText("0% complete");
  await clickUntil(learner, "Mark complete", async () => { await expect(percent).toHaveText("33% complete", { timeout: 10_000 }); });
  await expect(learner.getByRole("button", { name: "Completed" })).toHaveAttribute("aria-pressed", "true");
  await learner.getByRole("link", { name: "Next lesson" }).click();
  await expect(learner.getByRole("heading", { name: "Scripture", level: 2 })).toBeVisible();
  await clickUntil(learner, "Mark complete", async () => { await expect(percent).toHaveText("67% complete", { timeout: 10_000 }); });
  // Undo and redo one mark: the server keeps exactly what the learner chose.
  await learner.getByRole("button", { name: "Completed" }).click();
  await expect(percent).toHaveText("33% complete");
  await learner.getByRole("button", { name: "Mark complete" }).click();
  await expect(percent).toHaveText("67% complete");
  await learner.getByLabel("Note on this lesson").fill("Read Psalm 23 each morning.");
  await learner.getByRole("button", { name: "Save note" }).click();
  await expect(learner.getByRole("status").filter({ hasText: "Note saved." })).toBeVisible();
  await expect(learner.getByText("Only you can see your notes.")).toBeVisible();

  // The stored progress survives a reload, and the course page offers to continue at the first lesson not yet done.
  await learner.reload();
  await expect(percent).toHaveText("67% complete");
  await expect(learner.getByLabel("Note on this lesson")).toHaveValue("Read Psalm 23 each morning.");
  await learner.goto(`/courses/${slug}`);
  const resume = learner.getByRole("link", { name: "Continue where you left off" });
  await expect(resume).toHaveAttribute("href", /lesson=/);
  await expect(learner.getByText("67% complete")).toBeVisible();
  await resume.click();
  await expect(learner.getByRole("heading", { name: "Community", level: 2 })).toBeVisible();

  // My notes lists it with its course and lesson.
  await learner.goto("/account/notes");
  const note = learner.locator("[data-my-note]");
  await expect(note).toHaveCount(1);
  await expect(note.getByRole("heading", { name: "Scripture" })).toBeVisible();
  await expect(note.getByText("Walking with God")).toBeVisible();
  await expect(note.getByText("Read Psalm 23 each morning.")).toBeVisible();

  // The owner sees counts only; with fewer than five learners every count is withheld.
  const summary = await (await owner.request.get(`/api/workspaces/${tenant}/catalog/${created.id}/progress`)).json();
  expect(summary).toMatchObject({ enrolled: null, minimumGroup: 5 });
  expect(JSON.stringify(summary)).not.toContain("Psalm");

  const screens: [string, Page, string, () => Promise<void>][] = [
    ["learner-progress", learner, `/courses/${slug}/learn`, async () => { await expect(learner.getByRole("button", { name: "Mark complete" })).toBeVisible(); }],
    ["course-continue", learner, `/courses/${slug}`, async () => { await expect(learner.getByRole("link", { name: "Continue where you left off" })).toBeVisible(); }],
    ["my-notes", learner, "/account/notes", async () => { await expect(learner.locator("[data-my-note]")).toHaveCount(1); }],
    ["owner-progress", owner, `/workspaces/${tenant}/products/${created.id}`, async () => {
      await expect(owner.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(async () => {
        if (owner.viewportSize()!.width < 1024) { await owner.getByRole("button", { name: /Show all steps/ }).click(); await owner.getByRole("dialog").getByRole("button", { name: /Publish/ }).first().click(); }
        else await owner.getByRole("button", { name: /^(Step \d+ )?Publish/ }).first().click();
        await expect(owner.locator("[data-progress-summary]")).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 45_000 });
      await expect(owner.locator("[data-progress-summary]").getByText("Fewer than 5").first()).toBeVisible();
    }],
  ];
  for (const scheme of ["light", "dark"] as const) for (const [width, height] of [[1280, 900], [360, 800]] as const) for (const [name, page, path, ready] of screens) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width, height });
    await page.goto(path);
    await ready();
    await check(page, name, width, scheme);
    await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true });
  }
  // A hydration mismatch is ignored only when the dev server noted a chunk failure during this test (scripts/e2e-server.ts stamps each line).
  const devChunkFailure = (await readFile(`${process.env.HARVEST_E2E_MAILBOX}.dev-errors`, "utf8").catch(() => "")).split("\n")
    .some((line) => Number(line.split(" ", 1)[0]) >= started);
  expect(errors.filter((message) => !(devChunkFailure && message.startsWith("Hydration failed because the server rendered HTML didn't match the client")))).toEqual([]);
});
