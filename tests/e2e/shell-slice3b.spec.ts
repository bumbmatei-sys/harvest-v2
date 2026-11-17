import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect as playwrightExpect, test, type Browser, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn, origin } from "./helpers/session";

// Shell slice 3b: the live preview column for the community editor (behind HARVEST_SHELL_MODES). Flag-off parity runs this file with HARVEST_SHELL_MODES=disabled.
const expect = playwrightExpect.configure({ timeout: 15_000 });
const evidence = "docs/screenshots/shell-slice3b";
const off = process.env.HARVEST_SHELL_MODES === "disabled";
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });

async function setup(page: Page, patch: Record<string, unknown> = {}, publish = false) {
  await signIn(page);
  const ministry = await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name: "Grace Church" } });
  expect(ministry.status()).toBe(201);
  const tenant = (await ministry.json()).tenantId as string;
  const slug = `grace-${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Grace Bible Study", slug } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  const endpoint = `/api/workspaces/${tenant}/communities/${id}`;
  let current = await (await page.request.get(endpoint)).json();
  const body = { allowOpen: true, tagline: "Weekly study and prayer", description: "We read together every Tuesday.", rulesList: ["Be kind", "No spam"], ...patch };
  const patched = await page.request.patch(endpoint, { headers: { origin }, data: { version: current.version, ...body } });
  expect(patched.status()).toBe(200);
  current = await patched.json();
  if (publish) expect((await page.request.post(`${endpoint}/publish`, { headers: { origin }, data: { version: current.version, published: true } })).status()).toBe(200);
  return { tenant, id, slug, url: `/workspaces/${tenant}/communities/${id}/edit` };
}
async function setColorMode(page: Page, mode: string, url: string) {
  await page.goto(url);
  await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
}
const axe = async (page: Page) => expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const heading = (page: Page, name: string) => page.getByRole("heading", { name, level: 2 });
const column = (page: Page) => page.getByRole("complementary", { name: "Preview" });
const frame = (page: Page, name: RegExp | string = /^Page preview as a visitor/) => page.getByRole("region", { name });
const short = (locator: Locator) => locator.evaluateAll((nodes) => nodes.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; }).map((n) => `${n.tagName} ${(n.textContent ?? "").trim().slice(0, 30)}`));
const width = (locator: Locator) => locator.evaluate((node) => Math.round(node.getBoundingClientRect().width));
async function member(browser: Browser, owner: Page, tenant: string, role: string) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const email = await signIn(page);
  expect((await owner.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email, role } })).status()).toBe(200);
  return { context, page };
}

test("flag off: the editor keeps its static preview exactly as before", async ({ page }) => {
  test.skip(!off, "parity run uses HARVEST_SHELL_MODES=disabled");
  await page.setViewportSize({ width: 1280, height: 900 });
  const { url } = await setup(page);
  await page.goto(url);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  const preview = page.locator("main aside[aria-label='Preview']");
  await expect(preview).toBeVisible();
  await expect.poll(() => width(preview)).toBe(352);
  await expect(page.locator("[data-editor-live-preview]")).toHaveCount(0);
  await expect(page.locator("[data-editor-preview-label]")).toHaveCount(0);
  await expect(page.locator("[data-editor-preview-panel]")).toHaveCount(0);
  await expect(preview.getByRole("tab", { name: "Page", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(preview.getByRole("tab", { name: "Join", exact: true })).toBeVisible();
  await expect(preview.getByText("Weekly study and prayer")).toBeVisible();
  await expect(preview.getByText("Preview", { exact: true })).toBeVisible();
  await expect(page.getByText("Preview (draft)")).toHaveCount(0);
  await preview.getByRole("tab", { name: "Join" }).click();
  await expect(preview.getByRole("button", { name: "Join", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
});

test("desktop 1280: live draft preview, typing, tabs, view as, device, Open in browser, same text as the public page", async ({ page, browser }) => {
  test.skip(off, "flag off");
  test.setTimeout(300_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const { slug, url } = await setup(page, { visibility: "unlisted" });
  await page.goto(url);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  const preview = column(page);
  await expect(preview).toBeVisible();
  await expect.poll(() => width(preview)).toBe(352);
  await expect(page.locator("[data-editor-preview-label]")).toHaveText("Preview (draft)");
  await expect(page.locator("[data-editor-live-preview]")).toHaveCount(1);
  // Real page views from the draft: name, tagline, description, rules (open), the join card with an inert button.
  const shown = frame(page);
  await expect(shown).toBeVisible();
  await expect(shown.getByText("Grace Bible Study").first()).toBeVisible();
  await expect(shown.getByText("Weekly study and prayer")).toBeVisible();
  await expect(shown.getByText("We read together every Tuesday.")).toBeVisible();
  await expect(shown.getByText("Be kind")).toBeVisible();
  await expect(shown.getByText("By Grace Church")).toBeVisible();
  await expect(shown.getByRole("heading")).toHaveCount(0);
  // The preview's controls are not tab stops and do nothing.
  expect(await shown.evaluate((node) => [...node.querySelectorAll("a, button, input, summary, [tabindex]")].filter((n) => n.getAttribute("tabindex") !== "-1").length)).toBe(0);
  // No Open in browser until the community is published.
  await expect(preview.getByRole("link", { name: "Open page" })).toHaveCount(0);

  // Typing shows in the preview without saving.
  const requests: string[] = [];
  page.on("request", (request) => { if (["fetch", "xhr"].includes(request.resourceType()) || request.method() !== "GET") requests.push(`${request.method()} ${request.url()}`); });
  await page.locator("#community-name").fill("Grace Evening Study");
  await expect(shown.getByText("Grace Evening Study").first()).toBeVisible();
  await page.locator("#community-tagline").fill("Tuesday nights");
  await expect(shown.getByText("Tuesday nights")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();

  // Tabs, view as and the device switch change only the preview.
  const tabs = preview.getByRole("tablist", { name: "Preview page" });
  await expect(tabs.getByRole("tab", { name: "Page" })).toHaveAttribute("aria-selected", "true");
  const viewAs = preview.getByRole("radiogroup", { name: "View as" });
  await expect(viewAs.getByRole("radio", { name: "Visitor" })).toBeChecked();
  await viewAs.getByRole("radio", { name: "Member" }).click();
  await expect(frame(page, /^Page preview as a member/)).toBeVisible();
  await expect(frame(page, /^Page preview as a member/).getByRole("button", { name: "Open community" })).toBeVisible();
  await page.screenshot({ path: `${evidence}/desktop-1280-view-as-member-light.png` });
  await tabs.getByRole("tab", { name: "Welcome" }).click();
  await expect(frame(page, /^Welcome preview as a member/).getByText("Welcome", { exact: true }).first()).toBeVisible();
  await viewAs.getByRole("radio", { name: "Visitor" }).click();
  await expect(frame(page, /^Welcome preview as a visitor/).getByText("Join Grace Evening Study")).toBeVisible();
  await expect(frame(page, /^Welcome preview as a visitor/).getByText("I confirm I am 18 or older")).toBeVisible();
  await tabs.getByRole("tab", { name: "Page" }).click();
  const device = preview.getByRole("radiogroup", { name: "Device" });
  await expect(device.getByRole("radio", { name: "Phone width" })).toBeChecked();
  const before = await width(shown);
  await device.getByRole("radio", { name: "Desktop width" }).click();
  await expect(preview.locator("[data-device=desktop]")).toBeVisible();
  await expect(shown.getByText("Grace Evening Study").first()).toBeVisible();
  expect(await width(shown)).toBeGreaterThanOrEqual(before);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${evidence}/desktop-1280-device-desktop-light.png` });
  await device.getByRole("radio", { name: "Phone width" }).click();
  // Clicks inside the preview are swallowed: the join button and the rules summary do nothing.
  await shown.getByRole("button", { name: "Join" }).click({ force: true });
  await shown.locator("summary").click({ force: true });
  await expect(shown.getByText("Be kind")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  expect(requests).toEqual([]);

  // Publish: the preview gets Open in browser, and the public page shows the same text.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  const open = preview.getByRole("link", { name: "Open page" });
  await expect(open).toHaveAttribute("href", `/communities/${slug}`);
  await expect(open).toHaveAttribute("target", "_blank");
  const visitor = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 } });
  try {
    const pub = await visitor.newPage();
    await pub.goto(`/communities/${slug}`);
    await expect(pub.getByRole("heading", { name: "Grace Evening Study", level: 1 })).toBeVisible();
    for (const text of ["Tuesday nights", "We read together every Tuesday.", "By Grace Church"]) await expect(pub.getByText(text)).toBeVisible();
    for (const text of ["Tuesday nights", "We read together every Tuesday.", "By Grace Church", "Be kind"]) await expect(shown.getByText(text)).toBeVisible();
    await expect(pub.getByText("No spam")).toBeHidden();
    await expect(shown.getByText("No spam")).toBeVisible();
  } finally { await visitor.close(); }
});

test("click-to-field and Edit this: scroll to and focus the control, switching step when needed; keyboard alternative", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { url } = await setup(page);
  await page.goto(url);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  const shown = frame(page);
  const requests: string[] = [];
  page.on("request", (request) => { if (["fetch", "xhr"].includes(request.resourceType()) || request.method() !== "GET") requests.push(`${request.method()} ${request.url()}`); });
  // Same step.
  await shown.getByText("We read together every Tuesday.").click();
  await expect(page.locator("#community-description")).toBeFocused();
  await shown.getByText("Weekly study and prayer").click();
  await expect(page.locator("#community-tagline")).toBeFocused();
  // Cross step: the rules live in Joining.
  await shown.getByText("Be kind").click();
  await expect(heading(page, "Joining")).toBeVisible();
  await expect(page.locator("#community-rules-on")).toBeFocused();
  // Highlight: the focused control marks its preview element.
  await expect(shown.locator("[data-preview-field='rules'][data-preview-active]")).toHaveCount(1);
  // The join card goes to how people join.
  await shown.getByText("By Grace Church").click();
  await expect(page.locator("#community-allowOpen")).toBeFocused();
  // Keyboard alternative: Edit this lists the fields; choosing one goes to its step and focuses it.
  await page.getByRole("button", { name: "Edit this" }).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Name", "Tagline", "Description", "Community rules", "How people join"]);
  await menu.getByRole("menuitem", { name: "Name" }).click();
  await expect(heading(page, "Basics")).toBeVisible();
  await expect(page.locator("#community-name")).toBeFocused();
  // Welcome tab as a member: the welcome message lives in People.
  await page.getByRole("tab", { name: "Welcome" }).click();
  await page.getByRole("radiogroup", { name: "View as" }).getByRole("radio", { name: "Member" }).click();
  await page.getByRole("button", { name: "Edit this" }).click();
  await page.getByRole("menuitem", { name: "Welcome message" }).click();
  await expect(heading(page, "People")).toBeVisible();
  await expect(page.locator("#community-welcome")).toBeFocused();
  await page.locator("#community-welcome").fill("Glad you are here");
  await expect(frame(page, /^Welcome preview as a member/).getByText("Glad you are here")).toBeVisible();
  expect(requests).toEqual([]);
});

test("keyboard path: tabs, view as and device switch are reachable and the preview frame is one tab stop", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { url } = await setup(page);
  await page.goto(url);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  const preview = column(page);
  await preview.getByRole("tab", { name: "Page" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(preview.getByRole("tab", { name: "Welcome" })).toBeFocused();
  await expect(preview.getByRole("tab", { name: "Welcome" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  const viewAs = preview.getByRole("radiogroup", { name: "View as" });
  await viewAs.getByRole("radio", { name: "Visitor" }).focus();
  await expect(viewAs.getByRole("radio", { name: "Visitor" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(viewAs.getByRole("radio", { name: "Member" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(viewAs.getByRole("radio", { name: "Member" })).toBeChecked();
  const device = preview.getByRole("radiogroup", { name: "Device" });
  await device.getByRole("radio", { name: "Phone width" }).focus();
  await expect(device.getByRole("radio", { name: "Phone width" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(device.getByRole("radio", { name: "Desktop width" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(device.getByRole("radio", { name: "Desktop width" })).toBeChecked();
  // Tab order inside the column: tabs, view as, device, Edit this, then the frame (one stop), and nothing inside it.
  await preview.getByRole("button", { name: "Edit this" }).focus();
  await page.keyboard.press("Tab");
  await expect(frame(page, /^Page preview as a member/)).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("[data-editor-preview-frame]") === null)).toBe(true);
});

test("five widths in light and dark: axe, no overflow, preview column from 1280px, sheet below", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(480_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { url } = await setup(page);
  for (const scheme of ["light", "dark"] as const) {
    await setColorMode(page, scheme, url);
    for (const [w, h] of [[360, 780], [390, 844], [768, 1024], [1280, 900], [1440, 1000]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await expect(page.locator("[data-editor-live-preview]")).toBeVisible();
      await expect(column(page)).toBeVisible({ visible: w >= 1280 });
      if (w >= 1280) { await expect.poll(() => width(column(page))).toBe(352); await expect(frame(page)).toBeVisible(); }
      else await expect(page.locator("[data-editor-preview-panel]")).toHaveCount(0);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await axe(page);
      if (w === 1280) await page.screenshot({ path: `${evidence}/desktop-1280-editing-live-preview-${scheme}.png` });
      if (w === 768) await page.screenshot({ path: `${evidence}/tablet-768-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1700, height: 1000 });
  await expect.poll(() => width(column(page))).toBe(384);
  // Space rule on the form: it keeps at least 28rem next to the sidebar and the preview.
  for (const w of [1280, 1440, 1600]) { await page.setViewportSize({ width: w, height: 900 }); await expect.poll(() => width(page.locator("#community-name"))).toBeGreaterThan(448); }
});

test("phone: Preview in the step bar opens a full-screen sheet with a 44px close, no device switch, 360/390/768 light and dark", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(480_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 360, height: 780 });
  const { url } = await setup(page);
  for (const scheme of ["light", "dark"] as const) {
    await setColorMode(page, scheme, url);
    for (const [w, h] of [[360, 780], [390, 844], [768, 1024]] as const) {
      await page.setViewportSize({ width: w, height: h });
      const bar = page.locator("[data-slot='editor-step-bar']");
      const trigger = bar.getByRole("button", { name: "Preview", exact: true });
      await expect(trigger).toBeVisible();
      expect(await short(bar.getByRole("button"))).toEqual([]);
      await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveCount(1);
      await trigger.click();
      const sheet = page.getByRole("dialog", { name: "Preview (draft)" });
      await expect(sheet).toBeVisible();
      const box = await sheet.boundingBox();
      expect(Math.round(box!.width)).toBe(w);
      await expect(frame(page)).toBeVisible();
      await expect(frame(page).getByText("Weekly study and prayer")).toBeVisible();
      await expect(sheet.getByRole("radiogroup", { name: "Device" })).toHaveCount(0);
      expect(await short(sheet.locator("button, [role=tab], [role=radio], a"))).toEqual([]);
      const close = sheet.getByRole("button", { name: "Close preview" });
      const rect = await close.boundingBox();
      expect(rect!.width).toBeGreaterThanOrEqual(44); expect(rect!.height).toBeGreaterThanOrEqual(44);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await axe(page);
      if (w === 360 || w === 768) await page.screenshot({ path: `${evidence}/${w === 360 ? "phone-360" : "tablet-768"}-preview-sheet-${scheme}.png` });
      if (w === 360 && scheme === "light") {
        await sheet.getByRole("radiogroup", { name: "View as" }).getByRole("radio", { name: "Member" }).click();
        await page.screenshot({ path: `${evidence}/phone-360-preview-sheet-member-light.png` });
        await sheet.getByRole("radiogroup", { name: "View as" }).getByRole("radio", { name: "Visitor" }).click();
      }
      await close.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  }
});

test("a sheet left open while the viewport grows to the column does not reopen when it shrinks again", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1100, height: 800 });
  const { url } = await setup(page);
  await page.goto(url);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Preview (draft)" })).toBeVisible();
  await page.setViewportSize({ width: 1300, height: 800 });
  await expect(column(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(column(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("phone: Edit this closes the sheet, switches step and focuses the field; Escape returns focus; no requests from the preview", async ({ page }) => {
  test.skip(off, "flag off");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 360, height: 780 });
  const { url } = await setup(page);
  await page.goto(url);
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  const requests: string[] = [];
  page.on("request", (request) => { if (["fetch", "xhr"].includes(request.resourceType()) || request.method() !== "GET") requests.push(`${request.method()} ${request.url()}`); });
  const trigger = page.locator("[data-slot='editor-step-bar']").getByRole("button", { name: "Preview", exact: true });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "Preview (draft)" });
  await sheet.getByRole("button", { name: "Edit this" }).click();
  await page.getByRole("menuitem", { name: "Community rules" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(heading(page, "Joining")).toBeVisible();
  await expect(page.locator("#community-rules-on")).toBeFocused();
  // Tapping an element in the full-screen preview does the same.
  await trigger.click();
  await frame(page).getByText("Be kind").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#community-rules-on")).toBeFocused();
  expect(requests).toEqual([]);
});

test("role matrix: member and viewer see the preview read-only; admin edits", async ({ page, browser }) => {
  test.skip(off, "flag off");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { tenant, url } = await setup(page);
  for (const role of ["admin", "member", "viewer"]) {
    const { context, page: other } = await member(browser, page, tenant, role);
    try {
      await other.goto(url);
      await expect(other.locator("[data-hydrated=true]")).toBeVisible();
      await expect(column(other)).toBeVisible();
      await expect(frame(other).getByText("Weekly study and prayer")).toBeVisible();
      await expect(other.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
      await frame(other).getByText("Be kind").click();
      await expect(heading(other, "Joining")).toBeVisible();
      if (role === "admin") await expect(other.locator("#community-rules-on")).toBeFocused();
    } finally { await context.close(); }
  }
});
