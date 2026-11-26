import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { waitForCommunityResponse } from "./helpers/community";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// C13 Classroom and C16 Products: the owner picks published items in the community editor; members see them and enrol through the canonical access check.
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
const evidence = "docs/screenshots/communities-c13-c16";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;
const lesson = { title: "Welcome", published: true, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "You are here." }] }] } };
const hydrated = (page: Page) => page.waitForFunction(() => { const field = document.querySelector("main button"); return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps")); });

/** The dev server may reload a page while it compiles a route for the first time; one retry of an aborted navigation keeps that out of the result. */
async function visit(page: Page, url: string) {
  try { await page.goto(url); } catch (error) { if (!String(error).includes("ERR_ABORTED")) throw error; await page.goto(url); }
}

/** Light and dark at phone, tablet and desktop: no axe violations, no sideways page scroll; screenshots at phone and desktop. */
async function check(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (label !== "tablet") await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("owner shows a course and a product; a member enrols from the Classroom and Products tabs", async ({ page: owner, browser }) => {
  test.setTimeout(420_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  owner.on("pageerror", (error) => errors.push(error.message));
  await signIn(owner);
  const tenant = (await (await owner.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}`, stamp = randomUUID().slice(0, 8);
  const courseSlug = `foundations-${stamp}`, guideSlug = `prayer-guide-${stamp}`, slug = `circle-${stamp}`;
  const course = await (await owner.request.post(`${api}/catalog`, { headers: { origin }, data: { kind: "course", slug: courseSlug, title: "Foundations", summary: "Four lessons for new believers.", visibility: "unlisted", lessons: [lesson] } })).json();
  expect((await owner.request.put(`${api}/catalog/${course.id}/state`, { headers: { origin }, data: { version: course.version, state: "published" } })).status()).toBe(200);
  // A hidden course is published for community shelves only.
  const leadersSlug = `leaders-${stamp}`;
  const leaders = await (await owner.request.post(`${api}/catalog`, { headers: { origin }, data: { kind: "course", slug: leadersSlug, title: "Leaders track", visibility: "hidden", lessons: [lesson] } })).json();
  expect((await owner.request.put(`${api}/catalog/${leaders.id}/state`, { headers: { origin }, data: { version: leaders.version, state: "published" } })).status()).toBe(200);
  const bytes = Buffer.from("Prayer guide\n".repeat(50));
  const created = await (await owner.request.post(`${api}/files`, { headers: { origin }, data: { name: "prayer-guide.txt", mime: "text/plain", size: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex"), visibility: "private" } })).json();
  expect((await owner.request.put(created.upload.url, { headers: created.upload.headers, data: bytes })).ok()).toBe(true);
  expect((await owner.request.post(`${api}/files/${created.file.id}/confirm`, { headers: { origin } })).status()).toBe(200);
  const guide = await (await owner.request.post(`${api}/catalog`, { headers: { origin }, data: { kind: "download", slug: guideSlug, title: "Prayer guide", visibility: "listed", fileIds: [created.file.id] } })).json();
  expect((await owner.request.put(`${api}/catalog/${guide.id}/state`, { headers: { origin }, data: { version: guide.version, state: "published" } })).status()).toBe(200);
  const community = await (await owner.request.post(`${api}/communities`, { headers: { origin }, data: { name: "Bible Study", slug } })).json();
  const settings = await (await owner.request.patch(`${api}/communities/${community.id}`, { headers: { origin }, data: { version: community.version, visibility: "listed", allowOpen: true } })).json();
  expect((await owner.request.post(`${api}/communities/${community.id}/publish`, { headers: { origin }, data: { version: settings.version, published: true } })).ok()).toBe(true);

  // Owner: the Classroom and products step lists the published items; each switch saves the shelf link at once.
  await owner.goto(`/workspaces/${tenant}/communities/${community.id}/edit`);
  await owner.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /Classroom and products/ }).click();
  const classroom = owner.getByRole("list", { name: "Classroom" }), products = owner.getByRole("list", { name: "Products" });
  await expect(classroom.getByRole("listitem")).toHaveCount(2);
  await expect(products.getByRole("listitem")).toHaveCount(1);
  await hydrated(owner);
  for (const [name, item] of [["Foundations", course.id], ["Leaders track", leaders.id], ["Prayer guide", guide.id]] as const) {
    const toggle = owner.getByRole("switch", { name });
    await expect(toggle).not.toBeChecked();
    await Promise.all([waitForCommunityResponse(owner, "PUT", `${api}/communities/${community.id}/catalog/${item}`), toggle.click()]);
    await expect(toggle).toBeChecked();
  }
  // Order and feature: the featured item moves to the top and cannot be moved; the other order buttons save at once.
  await expect(owner.getByRole("button", { name: "Move Foundations up" })).toBeDisabled();
  await Promise.all([waitForCommunityResponse(owner, "PUT", `${api}/communities/${community.id}/catalog`), owner.getByRole("button", { name: "Move Foundations down" }).click()]);
  await expect(classroom.getByRole("listitem").first()).toContainText("Leaders track");
  await Promise.all([waitForCommunityResponse(owner, "PUT", `${api}/communities/${community.id}/catalog`), owner.getByRole("button", { name: "Feature Foundations" }).click()]);
  await expect(owner.getByRole("button", { name: "Stop featuring Foundations" })).toHaveAttribute("aria-pressed", "true");
  await expect(classroom.getByRole("listitem").first()).toContainText("Featured");
  await expect(owner.getByRole("button", { name: "Move Foundations down" })).toBeDisabled();
  await expect(owner.getByRole("button", { name: "Move Leaders track up" })).toBeDisabled();
  await owner.reload();
  await owner.getByRole("navigation", { name: "Community setup" }).getByRole("button", { name: /Classroom and products/ }).click();
  await expect(owner.getByRole("switch", { name: "Foundations" })).toBeChecked();
  await check(owner, "editor-shelf");

  // An outsider gets the public page, as on every member tab.
  const outsider = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })).newPage();
  await signIn(outsider);
  await outsider.goto(`/communities/${slug}/classroom`);
  await expect(outsider).toHaveURL(new RegExp(`/communities/${slug}$`));
  // The hidden course stays invisible outside the shelf.
  expect((await outsider.goto(`/courses/${leadersSlug}`))?.status()).toBe(404);
  expect((await outsider.request.get(`/api/catalog/${leadersSlug}`)).status()).toBe(404);

  // Member: Classroom shows the course; enrolling opens its lessons; back on the tab it says Continue.
  const member = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })).newPage();
  member.on("pageerror", (error) => errors.push(error.message));
  await signIn(member);
  expect(await (await member.request.post(`/api/communities/${slug}/join`, { headers: { origin }, data: { rulesVersion: 0, adult: true } })).json()).toMatchObject({ outcome: "joined" });
  await member.goto(`/communities/${slug}/forum`);
  const rail = member.getByRole("navigation", { name: "Community" }).first();
  await rail.getByRole("link", { name: "Classroom" }).click();
  await member.waitForURL(`**/communities/${slug}/classroom`);
  await expect(rail.getByRole("link", { name: "Classroom" })).toHaveAttribute("aria-current", "page");
  await expect(member.getByRole("heading", { name: "Classroom", level: 2 })).toBeVisible();
  const cards = member.getByRole("list", { name: "Classroom" }).getByRole("listitem");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Foundations");
  await expect(cards.first().getByText("Featured", { exact: true })).toBeVisible();
  await expect(cards.nth(1)).toContainText("Leaders track");
  await expect(cards.getByText("Four lessons for new believers.")).toBeVisible();
  await expect(member.getByText(/\$|price|checkout/i)).toHaveCount(0);
  await check(member, "classroom");
  // Every phone bottom-bar entry keeps a 44px target.
  await member.setViewportSize({ width: 360, height: 800 });
  const bar = member.getByRole("navigation", { name: "Community" }).last();
  for (const box of await bar.locator("a, [aria-disabled]").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height }))))
    expect(Math.min(box.w, box.h)).toBeGreaterThanOrEqual(44);
  await member.setViewportSize({ width: 1440, height: 1000 });
  await hydrated(member);
  await member.getByRole("button", { name: "Enrol for free: Foundations" }).click();
  await member.waitForURL(`**/courses/${courseSlug}/learn`);
  await visit(member, `/communities/${slug}/classroom`);
  await expect(member.getByRole("link", { name: "Continue Foundations" })).toHaveAttribute("href", `/courses/${courseSlug}/learn`);
  await expect(cards.first().getByText("Enrolled", { exact: true })).toBeVisible();

  // Products shows the free download; getting it keeps the member on the tab and the card offers Open.
  await expect(rail.getByRole("link", { name: "Products" })).toHaveAttribute("href", `/communities/${slug}/products`);
  await visit(member, `/communities/${slug}/products`);
  await expect(member.getByRole("list", { name: "Products" }).getByRole("listitem")).toHaveCount(1);
  await hydrated(member);
  await member.getByRole("button", { name: "Get for free: Prayer guide" }).click();
  await expect(member.getByRole("link", { name: "Open Prayer guide" })).toHaveAttribute("href", `/products/${guideSlug}`);
  await expect(member.getByText("Yours", { exact: true })).toBeVisible();
  await check(member, "products");

  // Unlinking removes the item from the tab; the member's own enrolment still opens the course.
  expect((await owner.request.delete(`${api}/communities/${community.id}/catalog/${course.id}`, { headers: { origin } })).status()).toBe(200);
  await visit(member, `/communities/${slug}/classroom`);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Leaders track");
  expect((await member.request.get(`/api/catalog/${courseSlug}/content`)).status()).toBe(200);
  expect(errors).toEqual([]);
});
