import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";

// CRM-07 browser proof: per-purpose opt-in, an association refused without consent, an opt-in
// recorded from the card, a Zernio message linked and shown on the timeline, a withdrawal that
// stops new links, the company timeline, isolation, keyboard reach, 44px targets and four widths.
const expect = baseExpect.configure({ timeout: 20_000 });
const evidence = "docs/screenshots/crm07";
test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/Berlin", actionTimeout: 20_000, navigationTimeout: 60_000 });

async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") === mode) return;
  await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator("body").innerText()).not.toContain("MISSING_MESSAGE");
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  await page.waitForFunction(() => document.getAnimations().every((animation) => !(animation instanceof CSSTransition) || animation.playState !== "running"));
  // The shell scrolls inside <main>; grow the viewport so the whole page is in the picture.
  const size = page.viewportSize()!;
  const overflow = await page.evaluate(() => { const main = document.querySelector("main"); return main ? main.scrollHeight - main.clientHeight : 0; });
  if (overflow > 0) await page.setViewportSize({ width: size.width, height: size.height + overflow });
  // Next's dev-only issue badge is tooling, not the app: keep it out of the evidence.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: "disabled" });
  if (overflow > 0) await page.setViewportSize(size);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), name).toEqual([]);
}
async function gotoHydrated(page: Page, url: string) {
  const ready = page.waitForResponse((response) => response.url().includes("/crm/notifications") && response.request().method() === "GET");
  await page.goto(url); await ready;
}
async function api(page: Page, method: "get" | "post" | "put", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
async function expectTouchTarget(target: Locator) {
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  expect(box.height, await target.evaluate((node) => node.outerHTML.slice(0, 120))).toBeGreaterThanOrEqual(44);
}
const consent = (purpose: string, status: "granted" | "withdrawn") => ({ channel: "email", status, purpose, noticeVersion: "notice-v1", source: `Synthetic ${purpose} ${status}`, evidence: "Synthetic evidence" });

test("CRM-07: per-purpose opt-in gates association events on the timeline", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest CRM-07 browser workspace" });
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
  const company = (await api(page, "post", `${apiRoot}/companies`, { name: "Synthetic Grace Chapel", domain: "grace.example" })).body.id as string;
  const person = (await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Ana Costa", email: "ana@example.test", phone: "+4915112345678", companyId: company })).body.id as string;

  // No opt-in yet: each purpose is separate and shows "No opt-in".
  await gotoHydrated(page, `${root}/crm/people/${person}`);
  const permissions = page.getByRole("list", { name: "Contact permissions" });
  await expect(permissions.getByText("No opt-in", { exact: true })).toHaveCount(3);

  // Logging a Zernio message without a messaging opt-in saves nothing and says why (keyboard only).
  await page.getByRole("button", { name: "Log activity" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Log activity for this person" });
  await expect(dialog.getByLabel("Source")).toHaveValue("zernio");
  await expect(dialog.getByLabel("Purpose")).toHaveValue("messaging");
  await dialog.getByLabel("Summary").fill("Synthetic: asked about the youth trip");
  await dialog.getByRole("button", { name: "Link activity" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("Nothing was saved: this person has no Messaging opt-in. Record their opt-in first.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("list", { name: "Timeline" }).getByText("asked about the youth trip")).toHaveCount(0);

  // Record the messaging opt-in from its own row: the consent form opens preset to that purpose.
  await permissions.getByRole("button", { name: "Record opt-in for Messaging" }).click();
  const consentDialog = page.getByRole("dialog", { name: "Record consent" });
  await expect(consentDialog.locator('select[name="purpose"], [name="purpose"]').first()).toHaveValue("messaging");
  await consentDialog.getByLabel("Source").fill("Synthetic opt-in reply");
  await consentDialog.getByLabel("Evidence").fill("Replied YES to the opt-in message");
  await consentDialog.getByRole("button", { name: "Save consent record" }).click();
  await expect(consentDialog).toBeHidden();
  await expect(permissions.getByText("Opted in", { exact: true })).toHaveCount(1);
  await expect(permissions.getByText(/Synthetic opt-in reply/)).toBeVisible();

  // Now the same activity is linked and appears on the timeline with its purpose.
  await page.getByRole("button", { name: "Log activity" }).click();
  await dialog.getByLabel("Summary").fill("Synthetic: asked about the youth trip");
  await dialog.getByLabel("Reference").fill("zernio-msg-1");
  await dialog.getByRole("button", { name: "Link activity" }).click();
  await expect(dialog).toBeHidden();
  const timeline = page.getByRole("list", { name: "Timeline" });
  await expect(timeline.getByText("recorded a message from a connected channel")).toBeVisible();
  await expect(timeline.getByText("Synthetic: asked about the youth trip")).toBeVisible();
  await expect(timeline.getByText("Messaging", { exact: true })).toBeVisible();
  // A form sign-up linked to the company through the API (as an adapter would) needs its own opt-in.
  expect((await api(page, "post", `${apiRoot}/crm/associations`, { source: "form", kind: "signup", purpose: "newsletter", identifiers: { email: "ANA@example.test" }, companyId: company, summary: "Newsletter form" })).body)
    .toMatchObject({ stored: false, reason: "consent_missing" });
  expect((await api(page, "post", `${apiRoot}/contacts/${person}/consents`, consent("newsletter", "granted"))).status).toBe(201);
  expect((await api(page, "post", `${apiRoot}/crm/associations`, { source: "form", kind: "signup", purpose: "newsletter", identifiers: { email: "ANA@example.test" }, companyId: company, summary: "Synthetic newsletter form" })).status).toBe(201);
  await gotoHydrated(page, `${root}/crm/people/${person}`);
  for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `person-desktop-${mode}`); }
  await setMode(page, "light");
  await page.getByRole("button", { name: "Log activity" }).click();
  await capture(page, "log-activity-desktop-light");
  await page.keyboard.press("Escape");

  // Company timeline shows the association for the person.
  await gotoHydrated(page, `${root}/crm/companies/${company}`);
  const companyTimeline = page.getByRole("list", { name: "Timeline" });
  await expect(companyTimeline.getByText("recorded a sign-up from a form")).toBeVisible();
  await expect(companyTimeline.getByRole("listitem").filter({ hasText: "recorded a sign-up from a form" }).getByRole("link", { name: "Synthetic Ana Costa" })).toBeVisible();
  for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `company-desktop-${mode}`); }
  await setMode(page, "light");

  // Withdrawing messaging stops new links; existing ones stay.
  expect((await api(page, "post", `${apiRoot}/contacts/${person}/consents`, consent("messaging", "withdrawn"))).status).toBe(201);
  expect((await api(page, "post", `${apiRoot}/crm/associations`, { source: "zernio", kind: "message", purpose: "messaging", contactId: person, summary: "After withdrawal" })).body)
    .toMatchObject({ stored: false, reason: "consent_withdrawn" });

  // Isolation both ways over HTTP.
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const other = await otherContext.newPage();
  await signIn(other);
  const own = (await api(other, "post", "/api/workspaces", { audience: "church", name: `CRM-07 second ${randomUUID().slice(0, 8)}` })).body.tenantId as string;
  expect((await api(other, "post", `${apiRoot}/crm/associations`, { source: "zernio", kind: "message", purpose: "messaging", contactId: person })).status).toBe(403);
  expect((await api(other, "post", `/api/workspaces/${own}/crm/associations`, { source: "zernio", kind: "message", purpose: "messaging", contactId: person })).status).toBe(404);
  expect((await api(other, "get", `/api/workspaces/${own}/contacts/${person}/timeline`)).status).toBe(404);
  expect((await api(page, "get", `/api/workspaces/${own}/contacts/${person}/timeline`)).status).toBe(403);
  await otherContext.close();

  // Mobile: every new control is at least 44px tall, and Tab reaches every sidebar link.
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, `${root}/crm/people/${person}`);
  for (const button of await permissions.getByRole("button").all()) await expectTouchTarget(button);
  await expectTouchTarget(page.getByRole("button", { name: "Log activity" }));
  for (const mode of ["light", "dark"] as const) { await setMode(page, mode); await capture(page, `person-mobile-${mode}`); }
  await setMode(page, "light");
  await page.getByRole("button", { name: "Log activity" }).click();
  for (const control of [dialog.getByLabel("Source"), dialog.getByLabel("What happened"), dialog.getByLabel("Purpose"), dialog.getByLabel("When"), dialog.getByLabel("Reference"), dialog.getByRole("button", { name: "Link activity" }), dialog.getByRole("button", { name: "Cancel" })]) await expectTouchTarget(control);
  await capture(page, "log-activity-mobile-light");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  const sheet = page.getByRole("dialog", { name: "Sidebar", exact: true });
  const navigation = sheet.getByRole("navigation", { name: "Workspace navigation" });
  const expected = new Set(await navigation.getByRole("link").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))));
  await sheet.getByRole("link", { name: "Harvest", exact: true }).focus();
  for (let tab = 0; tab < 40 && expected.size; tab++) {
    await page.keyboard.press("Tab");
    const href = await navigation.evaluate((nav) => (nav.contains(document.activeElement) ? document.activeElement?.getAttribute("href") : null));
    if (href) expected.delete(href);
  }
  expect([...expected], "sidebar links Tab never reached").toEqual([]);
  await page.keyboard.press("Escape");
  await gotoHydrated(page, `${root}/crm/companies/${company}`);
  await capture(page, "company-mobile-light");

  // The full-width shell holds at all four widths on both pages.
  for (const viewport of [{ width: 320, height: 800 }, { width: 390, height: 844 }, { width: 1024, height: 900 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    if (viewport.width === 1024) await page.context().addCookies([{ name: "sidebar_state", value: "true", url: origin }]);
    for (const path of [`${root}/crm/people/${person}`, `${root}/crm/companies/${company}`]) {
      await gotoHydrated(page, path);
      await expect(page.getByRole("list", { name: "Timeline" })).toBeVisible();
      if (viewport.width === 1024) await expect(page.locator('[data-slot="sidebar"][data-state="expanded"]')).toBeVisible();
      await expectFullWidthShell(page);
    }
  }
  expect(pageErrors).toEqual([]);
});

// Copy review screens: person record, organizations list, organization record, consent section and
// activity timeline, each at 390 and 1440 in light and dark. Pages are checked for vendor names and the
// old "company" wording before every capture.
test("CRM-07 copy: organizations wording and vendor-free screens at 390 and 1440", async ({ page }) => {
  test.setTimeout(300_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const tenantId = (await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest copy review" })).body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
  const organization = (await api(page, "post", `${apiRoot}/companies`, { name: "Synthetic Grace Chapel", domain: "grace.example", description: "Sunday services and youth work" })).body.id as string;
  await api(page, "post", `${apiRoot}/companies`, { name: "Synthetic Hope Fellowship", domain: "hope.example" });
  const person = (await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Ana Costa", email: "ana@example.test", phone: "+4915112345678", companyId: organization, title: "Youth leader" })).body.id as string;
  for (const purpose of ["messaging", "newsletter"]) expect((await api(page, "post", `${apiRoot}/contacts/${person}/consents`, consent(purpose, "granted"))).status).toBe(201);
  expect((await api(page, "post", `${apiRoot}/crm/associations`, { source: "zernio", kind: "message", purpose: "messaging", contactId: person, summary: "Synthetic: asked about the youth trip" })).status).toBe(201);
  expect((await api(page, "post", `${apiRoot}/crm/associations`, { source: "form", kind: "signup", purpose: "newsletter", contactId: person, companyId: organization, summary: "Synthetic newsletter form" })).status).toBe(201);
  await api(page, "post", `${apiRoot}/crm/notes`, { target: "person", targetId: person, body: "Synthetic: prefers a call after the service." });
  const screens = [
    { name: "person-record", path: `${root}/crm/people/${person}`, ready: () => page.getByRole("list", { name: "Timeline" }) },
    { name: "organizations-list", path: `${root}/crm/companies`, ready: () => page.getByRole("heading", { name: "Organizations", level: 1 }) },
    { name: "organization-record", path: `${root}/crm/companies/${organization}`, ready: () => page.getByRole("list", { name: "Timeline" }) },
  ];
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const mode of ["light", "dark"] as const) {
      for (const screen of screens) {
        await gotoHydrated(page, screen.path);
        await expect(screen.ready()).toBeVisible();
        await setMode(page, mode);
        await expect(screen.ready()).toBeVisible();
        const text = await page.locator("main").innerText();
        expect(text).not.toMatch(/zernio/i);
        expect(text.replace(/companies\//g, "")).not.toMatch(/\bcompan(y|ies)\b/i);
        await expectFullWidthShell(page);
        await capture(page, `${screen.name}-${width}-${mode}`);
        if (screen.name === "person-record") {
          await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
          // The cards sit inside the scrolling <main>: grow the viewport so neither is clipped at the fold.
          const size = page.viewportSize()!;
          const overflow = await page.evaluate(() => { const main = document.querySelector("main"); return main ? main.scrollHeight - main.clientHeight : 0; });
          if (overflow > 0) await page.setViewportSize({ width: size.width, height: size.height + overflow });
          await page.getByRole("list", { name: "Contact permissions" }).locator("xpath=ancestor::*[@data-slot='card'][1]").screenshot({ path: `${evidence}/consent-section-${width}-${mode}.png`, animations: "disabled" });
          await page.getByRole("list", { name: "Timeline" }).locator("xpath=ancestor::*[@data-slot='card'][1]").screenshot({ path: `${evidence}/activity-timeline-${width}-${mode}.png`, animations: "disabled" });
          if (overflow > 0) await page.setViewportSize(size);
        }
      }
    }
  }
  // The sidebar and breadcrumb say Organizations too.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHydrated(page, `${root}/crm/companies`);
  await expect(page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Organizations" })).toBeVisible();
  await expect(page.locator("[data-shell-header]").getByText("Organizations")).toBeVisible();
});
