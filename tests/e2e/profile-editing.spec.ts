import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect as check, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Profile editing inside the Settings pop-up (You > Profile). Screenshots are written only when HARVEST_SHOTS_DIR is set.
test.use({ actionTimeout: 20_000, reducedMotion: "reduce" });
const expect = check.configure({ timeout: 35_000 });
const shots = process.env.HARVEST_SHOTS_DIR;
const headers = { origin };

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings", exact: true });
const panel = (page: Page) => dialog(page).locator("[data-settings-content]");
const bar = (page: Page) => page.locator('[data-slot="sticky-save-bar"]');
const saveButton = (page: Page) => bar(page).getByRole("button", { name: "Save profile", exact: true });
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const stored = async (page: Page, slug: string) => (await page.request.get(`/api/communities/${slug}/profile`)).json();
const asking = (page: Page, name: string) => page.getByRole("alertdialog", { name, exact: true });
const radio = (page: Page, name: RegExp) => panel(page).getByRole("radio", { name });

async function ready(page: Page) { await expect(page.locator("[data-hydrated=true]")).toBeVisible(); }
async function openProfile(page: Page) {
  await page.goto("/profile?settings=profile"); await ready(page);
  await expect(dialog(page)).toBeVisible();
  await expect(panel(page).getByLabel("Display name")).toBeVisible();
  await expect(panel(page).locator('[data-slot="skeleton"], [aria-busy="true"]')).toHaveCount(0);
}
async function person(page: Page, name: string) {
  await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers, data: { name, locale: null, cityRegion: null } })).ok()).toBe(true);
}
async function join(page: Page, slug: string) {
  await page.goto(`/communities/${slug}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  const join = page.getByRole("dialog", { name: /^Join / });
  await join.getByLabel("I confirm I am 18 or older").click();
  await join.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByRole("link", { name: "Members", exact: true })).toBeVisible();
}
async function fillLink(page: Page, n: number, label: string, url: string) {
  await panel(page).getByLabel(`Link ${n} label`).fill(label);
  await panel(page).getByLabel(`Link ${n} address`).fill(url);
}
/** Adds rows until there are `count`. A click can land while the sticky bar scrolls a covered control, so it is retried against the row count instead of assumed. */
async function addLink(page: Page, count: number) {
  const rows = panel(page).locator('input[aria-label$=" label"]');
  await expect(async () => {
    if ((await rows.count()) < count) await panel(page).getByRole("button", { name: "Add link", exact: true }).click();
    await expect(rows).toHaveCount(count, { timeout: 2000 });
  }).toPass();
}
async function audit(page: Page, name: string, scheme: string, width: number) {
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations, `${name} ${scheme} ${width}`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${scheme} ${width} page overflow`).toBe(true);
  expect(await panel(page).evaluate((node) => node.scrollWidth <= node.clientWidth), `${name} ${scheme} ${width} panel overflow`).toBe(true);
  if (shots) await page.screenshot({ path: `${shots}/profile-${name}-${width}-${scheme}.png`, animations: "disabled" });
}
/** Light and dark at 360, 768 and 1280, with axe, overflow and a screenshot each. */
async function scenes(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate((mode) => { document.documentElement.dataset.theme = mode; document.documentElement.classList.toggle("dark", mode === "dark"); }, scheme);
    for (const [width, height] of [[360, 800], [768, 1000], [1280, 900]] as const) { await page.setViewportSize({ width, height }); await audit(page, name, scheme, width); }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; document.documentElement.classList.remove("dark"); });
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function tall(items: Locator[], label: string) {
  for (const item of items) { const box = await item.boundingBox(); expect(box && box.height, `${label} tap target`).toBeGreaterThanOrEqual(43.5); }
}

test("profile editing in Settings: every field, links, visibility on the profile page, conflict, guard, hide and clear, keyboard, axe", async ({ page: owner, browser }) => {
  test.setTimeout(900_000);
  if (shots) mkdirSync(shots, { recursive: true });
  const errors: string[] = [];
  owner.on("pageerror", (error) => errors.push(error.message));
  await person(owner, "Pastor Daniel Brooks");
  const tenant = (await (await owner.request.post("/api/workspaces", { headers, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `editing-${randomUUID().slice(0, 8)}`, endpoint = `/api/workspaces/${tenant}/communities`;
  const community = await (await owner.request.post(endpoint, { headers, data: { name: "Bible Study", slug } })).json();
  const patched = await (await owner.request.patch(`${endpoint}/${community.id}`, { headers, data: { version: community.version, visibility: "listed", allowOpen: true } })).json();
  expect((await owner.request.post(`${endpoint}/${community.id}/publish`, { headers, data: { version: patched.version, published: true } })).ok()).toBe(true);

  const ruthContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const samContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  try {
    const ruth = await ruthContext.newPage(), sam = await samContext.newPage();
    for (const page of [ruth, sam]) page.on("pageerror", (error) => errors.push(error.message));
    await person(ruth, "Ruth Adams"); await person(sam, "Samuel Cole");
    await join(ruth, slug); await join(sam, slug);

    // ---- Empty profile: nothing to save, no bar, Hide and Clear present ------------------------------------------------------------------------
    await openProfile(ruth);
    await expect(bar(ruth)).toHaveCount(0);
    await expect(panel(ruth).getByRole("radio", { name: /^Members/ })).toBeChecked();
    await expect(panel(ruth).getByRole("button", { name: "Hide profile", exact: true })).toBeVisible();
    await expect(panel(ruth).getByRole("button", { name: "Clear profile", exact: true })).toBeVisible();
    await expect(panel(ruth).getByText(/helper|we use this/i)).toHaveCount(0);

    // ---- Edit and save every field; the bar appears only while there are changes; reorder, remove, the limit of three ----------------------------
    await panel(ruth).getByLabel("Display name").fill("Ruth A.");
    await expect(bar(ruth)).toContainText("Unsaved changes");
    await panel(ruth).getByLabel("Bio").fill("Leads the Thursday Bible study.");
    await panel(ruth).getByLabel("Language").fill("Romanian");
    await addLink(ruth, 1);
    await fillLink(ruth, 1, "Church", "https://example.org");
    await addLink(ruth, 2);
    await fillLink(ruth, 2, "Podcast", "https://example.org/podcast");
    await addLink(ruth, 3);
    await fillLink(ruth, 3, "Blog", "https://example.org/blog");
    await expect(panel(ruth).getByRole("button", { name: "Add link", exact: true })).toHaveCount(0);
    await expect(panel(ruth).getByRole("button", { name: "Move link 1 up" })).toBeDisabled();
    await expect(panel(ruth).getByRole("button", { name: "Move link 3 down" })).toBeDisabled();
    await panel(ruth).getByRole("button", { name: "Move link 3 up" }).click();      // Church, Blog, Podcast
    await panel(ruth).getByRole("button", { name: "Move link 1 down" }).click();    // Blog, Church, Podcast
    await expect(panel(ruth).getByLabel("Link 1 label")).toHaveValue("Blog");
    await expect(panel(ruth).getByLabel("Link 3 label")).toHaveValue("Podcast");
    await panel(ruth).getByRole("button", { name: "Remove link 3" }).click();       // Blog, Church
    await expect(panel(ruth).getByRole("button", { name: "Add link", exact: true })).toBeVisible();
    await scenes(ruth, "edited");
    await saveButton(ruth).click();
    await expect(toast(ruth, "Profile saved.")).toBeVisible();
    await expect(bar(ruth)).toHaveCount(0);
    expect(await stored(ruth, slug)).toMatchObject({ displayName: "Ruth A.", bio: "Leads the Thursday Bible study.", language: "Romanian", visibility: "members", version: 1,
      links: [{ label: "Blog", url: "https://example.org/blog" }, { label: "Church", url: "https://example.org" }] });
    await openProfile(ruth);
    await expect(panel(ruth).getByLabel("Display name")).toHaveValue("Ruth A.");
    await expect(panel(ruth).getByLabel("Link 2 address")).toHaveValue("https://example.org");

    // ---- Link validation: nothing is sent; the field is flagged, described and focused; fixing it saves --------------------------------------------
    let puts = 0;
    await ruth.route("**/api/communities/*/profile", async (route) => { if (route.request().method() === "PUT") puts += 1; await route.continue(); });
    await fillLink(ruth, 2, "Church", "http://example.org");
    await saveButton(ruth).click();
    const urlField = panel(ruth).getByLabel("Link 2 address");
    await expect(panel(ruth).getByRole("alert").filter({ hasText: "https://" })).toBeVisible();
    await expect(urlField).toHaveAttribute("aria-invalid", "true");
    await expect(urlField).toBeFocused();
    await fillLink(ruth, 1, "", "https://example.org/blog");
    await addLink(ruth, 3);
    await fillLink(ruth, 3, "Cred", "https://user:secret@example.org");
    await saveButton(ruth).click();
    await expect(panel(ruth).getByRole("alert").filter({ hasText: "Add a label." })).toBeVisible();
    await expect(panel(ruth).getByRole("alert").filter({ hasText: "sign-in details" })).toBeVisible();
    expect(puts, "invalid links are never sent").toBe(0);
    await scenes(ruth, "link-errors");
    await panel(ruth).getByRole("button", { name: "Remove link 3" }).click();
    await fillLink(ruth, 1, "Blog", "https://example.org/blog"); await fillLink(ruth, 2, "Church", "https://example.org");
    await expect(bar(ruth)).toHaveCount(0);   // back to what is stored: no longer dirty
    await ruth.unroute("**/api/communities/*/profile");

    // ---- Keyboard: Enter in a field saves; Tab reaches the reorder buttons; the bar's Discard restores the stored profile -----------------------
    await panel(ruth).getByLabel("Display name").fill("Ruth Adams-Cole");
    await panel(ruth).getByLabel("Display name").press("Enter");
    await expect(toast(ruth, "Profile saved.")).toBeVisible();
    expect((await stored(ruth, slug)).displayName).toBe("Ruth Adams-Cole");
    await panel(ruth).getByLabel("Link 1 address").focus();
    await ruth.keyboard.press("Tab");   // Move up is disabled on the first row, so Tab lands on Move down
    await expect(panel(ruth).getByRole("button", { name: "Move link 1 down" })).toBeFocused();
    await ruth.keyboard.press("Enter");
    await expect(panel(ruth).getByLabel("Link 1 label")).toHaveValue("Church");
    await expect(bar(ruth)).toBeVisible();
    await bar(ruth).getByRole("button", { name: "Discard", exact: true }).click();
    await expect(panel(ruth).getByLabel("Link 1 label")).toHaveValue("Blog");
    await expect(bar(ruth)).toHaveCount(0);

    // ---- Visibility: reflected on the profile page and the members list for another member; the owner can still open a private profile -----------
    const profileLink = panel(ruth).getByRole("link", { name: /^View profile page/ });
    const href = (await profileLink.getAttribute("href"))!;
    expect(href).toMatch(new RegExp(`^/communities/${slug}/members/`));
    await expect(profileLink).toHaveAttribute("target", "_blank");
    const listed = async (page: Page) => { await page.goto(`/communities/${slug}/members`); await expect(page.getByRole("link", { name: "View profile of Pastor Daniel Brooks" })).toBeVisible(); return page.getByRole("link", { name: "View profile of Ruth Adams-Cole" }).count(); };
    for (const [visibility, samOpens, inList] of [["unlisted", 200, 0], ["private", 404, 0], ["members", 200, 1]] as const) {
      await radio(ruth, new RegExp(`^${visibility}`, "i")).check();
      await saveButton(ruth).click();
      await expect.poll(async () => (await stored(ruth, slug)).visibility).toBe(visibility);
      await expect(bar(ruth)).toHaveCount(0);
      expect((await sam.goto(href))?.status(), `${visibility}: another member opens the page`).toBe(samOpens);
      if (samOpens === 200) await expect(sam.getByText("Ruth Adams-Cole", { exact: true }).first()).toBeVisible();
      expect(await listed(sam), `${visibility}: members list`).toBe(inList);
      expect((await owner.goto(href))?.status(), `${visibility}: the owner opens the page`).toBe(200);
    }
    // The link opens the existing profile page in a new tab and leaves the pop-up as it was.
    const [popup] = await Promise.all([ruthContext.waitForEvent("page"), profileLink.click()]);
    await expect(popup.getByRole("heading", { name: "Your profile", level: 2 })).toBeVisible();
    await expect(popup.getByText("Ruth Adams-Cole", { exact: true }).first()).toBeVisible();
    await popup.close();
    await expect(dialog(ruth)).toBeVisible();

    // ---- Conflict: the profile changed elsewhere, so nothing is overwritten; loading the latest version replaces the draft ---------------------------
    const latest = await stored(ruth, slug);
    expect((await ruth.request.put(`/api/communities/${slug}/profile`, { headers, data: { version: latest.version, displayName: "Changed elsewhere", bio: null, language: null, links: [], visibility: "members" } })).ok()).toBe(true);
    await panel(ruth).getByLabel("Display name").fill("Mine");
    await saveButton(ruth).click();
    const conflict = panel(ruth).getByRole("alert").filter({ hasText: "changed somewhere else" });
    await expect(conflict).toBeVisible();
    expect((await stored(ruth, slug)).displayName).toBe("Changed elsewhere");
    await scenes(ruth, "conflict");
    await conflict.getByRole("button", { name: "Load the latest version" }).click();
    await expect(panel(ruth).getByLabel("Display name")).toHaveValue("Changed elsewhere");
    await expect(conflict).toHaveCount(0);
    await expect(bar(ruth)).toHaveCount(0);
    await panel(ruth).getByLabel("Display name").fill("Ruth A.");
    await panel(ruth).getByLabel("Bio").fill("Leads the Thursday Bible study.");
    await addLink(ruth, 1);
    await fillLink(ruth, 1, "Church", "https://example.org");
    await saveButton(ruth).click();
    await expect.poll(async () => (await stored(ruth, slug)).displayName).toBe("Ruth A.");

    // ---- Unsaved-changes guard: Escape, Close and another section ask first; Keep editing keeps the draft; Discard closes ----------------------------
    const sections = dialog(ruth).getByRole("navigation", { name: "Settings sections" });
    await panel(ruth).getByLabel("Display name").fill("Unsaved name");
    await ruth.keyboard.press("Escape");
    await expect(asking(ruth, "Discard your changes?")).toBeVisible();
    await asking(ruth, "Discard your changes?").getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(dialog(ruth)).toBeVisible();
    await expect(panel(ruth).getByLabel("Display name")).toHaveValue("Unsaved name");
    await dialog(ruth).getByRole("button", { name: "Close" }).click();
    await expect(asking(ruth, "Discard your changes?")).toBeVisible();
    await asking(ruth, "Discard your changes?").getByRole("button", { name: "Keep editing", exact: true }).click();
    await sections.getByRole("button", { name: "Account", exact: true }).click();
    await expect(asking(ruth, "Discard your changes?")).toBeVisible();
    await asking(ruth, "Discard your changes?").getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(sections.getByRole("button", { name: "Profile", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(panel(ruth).getByLabel("Display name")).toHaveValue("Unsaved name");
    await sections.getByRole("button", { name: "Account", exact: true }).click();
    await asking(ruth, "Discard your changes?").getByRole("button", { name: "Discard", exact: true }).click();
    await expect(sections.getByRole("button", { name: "Account", exact: true })).toHaveAttribute("aria-current", "page");
    await sections.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(panel(ruth).getByLabel("Display name")).toHaveValue("Ruth A.");     // the draft was dropped, the stored profile is shown
    await panel(ruth).getByLabel("Display name").fill("Unsaved again");
    await dialog(ruth).getByRole("button", { name: "Close" }).click();
    await asking(ruth, "Discard your changes?").getByRole("button", { name: "Discard", exact: true }).click();
    await expect(dialog(ruth)).toHaveCount(0);
    expect((await stored(ruth, slug)).displayName).toBe("Ruth A.");
    // A clean pop-up closes without asking.
    await openProfile(ruth);
    await ruth.keyboard.press("Escape");
    await expect(dialog(ruth)).toHaveCount(0);
    // Closing the tab with unsaved changes asks the browser first.
    const tab = await ruthContext.newPage();
    await openProfile(tab);
    await panel(tab).getByLabel("Display name").click();
    await tab.keyboard.type(" and more");   // real keystrokes: the browser asks only after a user gesture
    await expect(bar(tab)).toBeVisible();
    const prompt = tab.waitForEvent("dialog");
    void tab.close({ runBeforeUnload: true });
    const asked = await prompt;
    expect(asked.type()).toBe("beforeunload");
    await asked.accept();
    await openProfile(ruth);

    // ---- Hide: Cancel keeps everything; Hide sets Private and keeps the details ------------------------------------------------------------------------
    await panel(ruth).getByRole("button", { name: "Hide profile", exact: true }).click();
    await expect(asking(ruth, "Hide your profile?")).toBeVisible();
    await expect(asking(ruth, "Hide your profile?").getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await scenes(ruth, "hide-confirm");
    await asking(ruth, "Hide your profile?").getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await stored(ruth, slug)).visibility).toBe("members");
    await panel(ruth).getByRole("button", { name: "Hide profile", exact: true }).click();
    await asking(ruth, "Hide your profile?").getByRole("button", { name: "Hide profile", exact: true }).click();
    await expect(toast(ruth, "Profile hidden.")).toBeVisible();
    await expect(radio(ruth, /^Private/)).toBeChecked();
    await expect(panel(ruth).getByRole("button", { name: "Hide profile", exact: true })).toHaveCount(0);
    expect(await stored(ruth, slug)).toMatchObject({ displayName: "Ruth A.", visibility: "private", links: [{ label: "Church", url: "https://example.org" }] });
    expect((await sam.goto(href))?.status()).toBe(404);

    // ---- Clear: says what goes and what stays; empties the stored profile, sets Members and leaves the account name -------------------------------
    await panel(ruth).getByLabel("Display name").fill("Edits that will be dropped");
    await panel(ruth).getByRole("button", { name: "Clear profile", exact: true }).click();
    await expect(asking(ruth, "Clear your profile?")).toContainText("Your posts and your account are not affected.");
    await expect(asking(ruth, "Clear your profile?")).toContainText("Your unsaved edits are discarded.");
    await scenes(ruth, "clear-confirm");
    await asking(ruth, "Clear your profile?").getByRole("button", { name: "Clear profile", exact: true }).click();
    await expect(toast(ruth, "Profile cleared.")).toBeVisible();
    await expect(panel(ruth).getByLabel("Display name")).toHaveValue("");
    await expect(panel(ruth).getByLabel("Bio")).toHaveValue("");
    await expect(panel(ruth).getByLabel("Link 1 label")).toHaveCount(0);
    await expect(radio(ruth, /^Members/)).toBeChecked();
    await expect(bar(ruth)).toHaveCount(0);
    expect(await stored(ruth, slug)).toMatchObject({ displayName: null, bio: null, language: null, links: [], visibility: "members" });
    expect((await (await ruth.request.get("/api/account/profile")).json()).name).toBe("Ruth Adams");

    // ---- Phone tap targets, then the resting and edited states in both themes at three widths ------------------------------------------------------
    await addLink(ruth, 1);
    await fillLink(ruth, 1, "Church", "https://example.org");
    await panel(ruth).getByLabel("Display name").fill("Ruth Adams");
    await ruth.setViewportSize({ width: 360, height: 800 });
    await tall([
      panel(ruth).getByLabel("Display name"), panel(ruth).getByLabel("Bio"), panel(ruth).getByLabel("Link 1 label"), panel(ruth).getByLabel("Link 1 address"),
      panel(ruth).getByRole("button", { name: "Move link 1 down" }), panel(ruth).getByRole("button", { name: "Remove link 1" }), panel(ruth).getByRole("button", { name: "Add link", exact: true }),
      panel(ruth).getByRole("button", { name: "Clear profile", exact: true }), panel(ruth).getByRole("link", { name: /^View profile page/ }),
      ...[/^Members/, /^Unlisted/, /^Private/].map((name) => radio(ruth, name).locator("xpath=ancestor::label[1]")),   // the label row is the tap target
      bar(ruth).getByRole("button", { name: "Discard", exact: true }), saveButton(ruth),
    ], "profile form");
    await scenes(ruth, "dirty");
    await saveButton(ruth).click();
    await expect(bar(ruth)).toHaveCount(0);
    await scenes(ruth, "saved");

    expect(errors).toEqual([]);
  } finally {
    await ruthContext.close(); await samContext.close();
  }
});
