import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
const evidence = process.env.LANDING_QA_DIR ?? "/tmp/harvest-landing-qa";
test.use({ reducedMotion: "reduce", actionTimeout: 30000 });
async function capture(page: Page, name: string) {
  // Let colour-scheme and layout transitions finish before measuring contrast (slower CI runners).
  await page.waitForFunction(() => document.getAnimations().every(a => !(a instanceof CSSTransition) || a.playState !== "running"));
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations, name).toEqual([]);
  const geometry = await page.locator("main").evaluate(main => ({ overflow: document.documentElement.scrollWidth - innerWidth, mainOverflow: main.scrollWidth - main.clientWidth,
    controls: Array.from(main.querySelectorAll("button,a[data-slot='button'],input:not([type='hidden']),select,textarea")).filter(e => e.getClientRects().length).map(e => {
      const b = e.getBoundingClientRect(); return { label: e.getAttribute("aria-label") ?? e.id ?? e.textContent, width: b.width, height: b.height };
    }) }));
  expect(geometry.overflow, name).toBeLessThanOrEqual(0); expect(geometry.mainOverflow, name).toBeLessThanOrEqual(0);
  for (const c of geometry.controls) { expect(c.height, c.label ?? name).toBeGreaterThanOrEqual(44); expect(c.width, c.label ?? name).toBeGreaterThanOrEqual(44); }
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  return { name, geometry, axeViolations: 0 };
}
async function setup(page: Page) {
  await signIn(page);
  const w = await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name: "Hope Community" } }); expect(w.status()).toBe(201); const tenant = (await w.json()).tenantId;
  const c = await page.request.post(`/api/workspaces/${tenant}/campaigns`, { headers: { origin, "Idempotency-Key": randomUUID() }, data: { name: "Welcome Evening", type: "conference" } }); expect(c.status()).toBe(201); const campaign = (await c.json()).id;
  const root = `/workspaces/${tenant}/campaigns/${campaign}/connect`, api = `/api${root}`;
  const f = await page.request.post(`${api}/forms`, { headers: { origin }, data: { name: "Synthetic invitation preset", notice: "Synthetic test notice only", retentionDays: 1, purposes: ["newsletter", "outreach_follow_up", "account_communications"], definition: { kind: "connect-intake-v2", syntheticOnly: true, preferredName: true, followUpChannel: "email" } } }); expect(f.status()).toBe(201);
  const l = await page.request.post(`${api}/links`, { headers: { origin }, data: { label: "Screen A", formVersionId: (await f.json()).id } }); expect(l.status()).toBe(201); const link = await l.json();
  return { root, api, link, endpoint: `${api}/links/${link.id}/landing`, tenant, campaign };
}
test("landing editor: private draft, shared preview, keyboard ordering, publishing and guest lifecycle", async ({ page, browser }) => {
  test.setTimeout(240000); await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { root, api, link, endpoint } = await setup(page), metrics = [];
  await page.goto(root); await page.getByRole("link", { name: "Edit landing page", exact: true }).click();
  const heading = page.getByLabel("Welcome heading (optional)", { exact: true });
  await heading.fill("We’re glad you’re here"); await page.getByLabel("Welcome message (optional)", { exact: true }).fill("Explore at your own pace.\nChoose a next step whenever you’re ready.");
  await page.getByRole("button", { name: "Add a free Harvest resource", exact: true }).click();
  await page.getByLabel("Choose a Harvest resource", { exact: true }).selectOption("common-questions");
  await page.getByRole("button", { name: "Add a website link", exact: true }).click();
  await page.getByLabel("What are you sharing?", { exact: true }).selectOption("course");
  await page.getByLabel("Link title", { exact: true }).fill("Getting started with the Bible");
  await page.getByLabel("Description (optional)", { exact: true }).fill("A self-paced course for your first steps. This optional course is provided on another website.");
  await page.getByLabel("Website link", { exact: true }).fill("https://example.org/learn?lang=en#start");
  await page.getByLabel("Cost for visitors", { exact: true }).selectOption("paid");
  await expect(page.getByText(/Draft revision|Published revision|Plain text|HTTPS destination/)).toHaveCount(0);
  await expect(page.getByText("Your changes aren’t saved yet. Save a draft to keep them, then publish when you’re ready.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move up card 2", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Move down card 1", exact: true })).toBeFocused();
  const preview = page.getByRole("region", { name: "Preview your page", exact: true });
  await expect(preview.getByRole("heading", { name: "We’re glad you’re here", exact: true })).toBeVisible();
  const previewChoices = preview.getByRole("checkbox"); await expect(previewChoices).toHaveCount(3); for (const choice of await previewChoices.all()) await expect(choice).not.toBeChecked();
  await previewChoices.first().check(); await expect(preview.getByRole("button", { name: "Save test request", exact: true })).toBeDisabled();
  // Unsaved navigation guard protects app links, browser Back and reload.
  await page.getByRole("main").getByRole("link", { name: "QR codes and short links", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible(); await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.goBack({ timeout: 1500 }).catch(() => {}); await expect(page.getByRole("alertdialog")).toBeVisible(); await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme }); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    for (const [size, width, height] of [["mobile", 390, 844], ["tablet", 820, 1180], ["desktop", 1440, 1000]] as const) {
      await page.setViewportSize({ width, height }); await page.getByRole("main").evaluate(e => e.scrollTop = 0);
      metrics.push(await capture(page, `editor-${size}-${scheme}`));
      await page.getByRole("button", { name: "Save draft", exact: true }).scrollIntoViewIfNeeded(); metrics.push(await capture(page, `editor-actions-${size}-${scheme}`));
      await preview.getByRole("heading", { name: "We’re glad you’re here", exact: true }).evaluate(e => e.scrollIntoView({ block: "start" })); metrics.push(await capture(page, `editor-preview-${size}-${scheme}`));
    }
  }
  await page.getByRole("button", { name: "Save draft", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Draft saved privately." })).toBeVisible();
  await page.reload(); await expect(heading).toHaveValue("We’re glad you’re here");
  const guestContext = await browser.newContext(), guest = await guestContext.newPage();
  try {
    await guest.goto(`/c/${link.publicCode}`); await expect(guest.getByRole("heading", { name: "This page isn’t available.", exact: true })).toBeVisible();
    expect((await page.request.post(`${api}/links/${link.id}/actions`, { headers: { origin }, data: { action: "publish" } })).status()).toBe(200);
    await guest.reload(); await expect(guest.getByRole("heading", { name: "A place to begin.", exact: true })).toBeVisible(); await expect(guest.getByText("We’re glad you’re here", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Publish changes", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Changes published" })).toBeVisible();
    await heading.fill("Welcome to our community");
    await expect(page.getByText("Your changes aren’t saved yet. Save a draft to keep them, then publish when you’re ready.", { exact: true })).toBeVisible();
    await expect(page.getByText("Your published page is up to date.", { exact: true })).toHaveCount(0);
    await heading.fill("We’re glad you’re here");
    for (const path of [`/c/${link.publicCode}`, `/s/${link.shortCode}`]) {
      await guest.goto(path); await expect(guest.getByRole("heading", { name: "We’re glad you’re here", exact: true })).toBeVisible();
      const suggestions = guest.getByRole("region", { name: "Organizer suggestions", exact: true });
      expect(await suggestions.getByRole("heading", { level: 3 }).allTextContents()).toEqual(["Getting started with the Bible", "Common questions"]);
      await expect(suggestions.getByText("External · Course · Paid", { exact: true })).toBeVisible(); await expect(suggestions.getByText("Free Harvest resource", { exact: true })).toBeVisible();
      await expect(suggestions.locator("script")).toHaveCount(0);
      for (const header of await suggestions.locator('[data-slot="card-header"]').all()) expect(await header.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
      const external = guest.getByRole("link", { name: "Visit external website", exact: true }); await expect(external).toHaveAttribute("href", "https://example.org/learn?lang=en#start"); await expect(external).toHaveAttribute("target", "_blank"); await expect(external).toHaveAttribute("rel", "noopener noreferrer"); await expect(external).toHaveAttribute("referrerpolicy", "no-referrer");
      await expect(guest.getByRole("link", { name: "Explore free Harvest resources", exact: true }).first()).toBeVisible();
      for (const choice of await guest.locator("#response-form").getByRole("checkbox").all()) await expect(choice).not.toBeChecked();
    }
    for (const scheme of ["light", "dark"] as const) {
      await guest.emulateMedia({ colorScheme: scheme }); await guest.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await guest.reload(); await expect(guest.locator("html")).toHaveAttribute("data-theme", scheme);
      for (const [size, width, height] of [["mobile", 390, 844], ["tablet", 820, 1180], ["desktop", 1440, 1000]] as const) {
        await guest.setViewportSize({ width, height }); metrics.push(await capture(guest, `guest-${size}-${scheme}`));
      }
    }
    await guest.getByRole("link", { name: "Explore free Harvest resources", exact: true }).first().click(); await expect(guest.getByRole("heading", { name: "Start where you are.", exact: true })).toBeVisible();
    // A subsequent save remains private; stale publish/save, origin and payload violations fail closed.
    const current = await (await page.request.get(endpoint)).json();
    const saved = await page.request.put(endpoint, { headers: { origin }, data: { expectedRevision: current.revision, expectedCode: current.expectedCode, definition: { ...current.definition, heading: "Next private revision" } } }); expect(saved.status()).toBe(200);
    expect((await page.request.post(`${endpoint}/publish`, { headers: { origin }, data: { expectedRevision: current.revision, expectedCode: current.expectedCode } })).status()).toBe(409);
    expect((await page.request.put(endpoint, { headers: { origin: "https://evil.example.org" }, data: {} })).status()).toBe(403);
    await guest.goto(`/c/${link.publicCode}`); await expect(guest.getByRole("heading", { name: "We’re glad you’re here", exact: true })).toBeVisible();
    expect((await guest.request.get(endpoint)).status()).toBe(401);
    expect((await page.request.post(`${api}/links/${link.id}/actions`, { headers: { origin }, data: { action: "disable" } })).status()).toBe(200);
    for (const path of [`/c/${link.publicCode}`, `/s/${link.shortCode}`]) { await guest.goto(path); await expect(guest.getByRole("heading", { name: "This page isn’t available.", exact: true })).toBeVisible(); }
    // Preview is authenticated, draft-aware and cannot submit.
    await page.goto(`${root}/${link.id}/preview`); await expect(page.getByRole("heading", { name: "Next private revision", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Save test request", exact: true })).toBeDisabled();
  } finally { await guestContext.close(); }
  await writeFile(`${evidence}/metrics.json`, JSON.stringify(metrics, null, 2));
});

test("landing editor: member drafts, eight-card limit, stale edits and live publishing permission", async ({ page, browser }) => {
  test.setTimeout(120000); await mkdir(evidence, { recursive: true });
  const { root, tenant, link, endpoint } = await setup(page);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), member = await context.newPage();
  try {
    const email = await signIn(member);
    expect((await page.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email, role: "member" } })).status()).toBe(200);
    await member.goto(`${root}/${link.id}/landing`); await expect(member.getByRole("button", { name: "Publish changes", exact: true })).toHaveCount(0);
    await expect(member.getByText("Only an owner or admin can publish.", { exact: true })).toBeVisible();
    for (let i = 0; i < 8; i++) await member.getByRole("button", { name: "Add a free Harvest resource", exact: true }).click();
    await expect(member.getByRole("button", { name: "Add a free Harvest resource", exact: true })).toBeDisabled(); await expect(member.getByRole("button", { name: "Add a website link", exact: true })).toBeDisabled();
    await member.getByRole("button", { name: "Remove card 4", exact: true }).click();
    await expect(member.getByRole("button", { name: "Remove card 4", exact: true })).toBeFocused();
    await member.getByRole("button", { name: "Save draft", exact: true }).click(); await expect(member.getByRole("status").filter({ hasText: "Draft saved privately." })).toBeVisible();
    const state = await (await member.request.get(endpoint)).json(); expect(state.definition.cards).toHaveLength(7);
    expect((await member.request.post(`${endpoint}/publish`, { headers: { origin }, data: { expectedRevision: state.revision, expectedCode: state.expectedCode } })).status()).toBe(403);
    // Owner changes the saved draft while member still edits the earlier revision.
    expect((await page.request.put(endpoint, { headers: { origin }, data: { expectedRevision: state.revision, expectedCode: state.expectedCode, definition: { ...state.definition, heading: "Owner edit" } } })).status()).toBe(200);
    await member.getByLabel("Welcome heading (optional)", { exact: true }).fill("Member edit");
    await expect(member.getByText("Your changes aren’t saved yet. Save a draft to keep them, then publish when you’re ready.", { exact: true })).toBeVisible();
    await member.getByRole("button", { name: "Save draft", exact: true }).click(); await expect(member.getByRole("alert").filter({ hasText: "Someone changed this page or its QR code." })).toBeVisible();
    await expect(member.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
    await member.getByRole("button", { name: "Reload latest version", exact: true }).click(); await expect(member.getByRole("alertdialog")).toBeVisible();
    await member.getByRole("button", { name: "Leave page", exact: true }).click(); await expect(member.getByLabel("Welcome heading (optional)", { exact: true })).toHaveValue("Owner edit");
    // Revocation is enforced by the API, even with a still-open editor.
    expect((await page.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email, role: "viewer" } })).status()).toBe(200);
    expect((await member.request.get(endpoint)).status()).toBe(403);
    expect((await page.request.put(endpoint, { headers: { origin }, data: { definition: state.definition, expectedRevision: 2 } })).status()).toBe(400);
    const huge = await page.request.put(endpoint, { headers: { origin, "Content-Type": "application/json" }, data: " ".repeat(32769) }); expect(huge.status()).toBe(400);
  } finally { await context.close(); }
});


test("landing editor: history warning without the Navigation API", async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true }));
  const { root, link } = await setup(page);
  await page.goto(root); await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  const documentTime = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("link", { name: "Edit landing page", exact: true }).click();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentTime);
  expect(await page.evaluate(() => typeof (window as unknown as { navigation?: unknown }).navigation)).toBe("undefined");
  await page.getByLabel("Welcome heading (optional)", { exact: true }).fill("Keep this draft");
  await page.goBack({ timeout: 1500 }).catch(() => {});
  await expect(page.getByRole("alertdialog")).toBeVisible(); await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${link.id}/landing$`)); await expect(page.getByLabel("Welcome heading (optional)", { exact: true })).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "Save draft", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Draft saved privately." })).toBeVisible();
  // A clean Back reaches the QR list normally; no synthetic entry is added while editing.
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`${root}$`));
  await page.getByRole("link", { name: "Edit landing page", exact: true }).click();
  await page.getByLabel("Welcome heading (optional)", { exact: true }).fill("Discard this change");
  await page.goBack({ timeout: 1500 }).catch(() => {}); await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Leave page", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`${root}$`));
});


test("landing editor: fallback preserves multi-entry and forward destinations", async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true }));
  const { root, link, tenant } = await setup(page), editor = `${root}/${link.id}/landing`, campaignList = `/workspaces/${tenant}/campaigns`;
  // All intermediate entries are real Next client navigations in one document.
  await page.goto(campaignList); await expect(page.locator('[data-hydrated="true"]')).toBeVisible(); await page.getByRole("main").getByRole("link", { name: /Welcome Evening/ }).click();
  await page.getByRole("main").getByRole("link", { name: "QR codes and short links", exact: true }).click();
  await page.getByRole("link", { name: "Edit landing page", exact: true }).click();
  await page.getByLabel("Welcome heading (optional)", { exact: true }).fill("Multi-step draft");
  await page.evaluate(() => history.go(-3)); await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${link.id}/landing$`)); await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Welcome heading (optional)", { exact: true })).toHaveValue("Multi-step draft");
  await page.evaluate(() => history.back()); await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Leave page", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`${campaignList}$`));
  // Create a forward destination, return cleanly to the editor, then edit before Forward.
  await page.goto(editor); await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "QR codes and short links", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`${root}$`)); await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${link.id}/landing$`));
  await page.getByLabel("Welcome heading (optional)", { exact: true }).fill("Forward draft");
  await page.evaluate(() => history.forward()); await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${link.id}/landing$`));
  await page.getByRole("button", { name: "Leave page", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`${root}$`));
});

// Adversarial input belongs in a dedicated safety regression, never in the organizer walkthrough
// or the screenshots used to explain the product.
test("landing editor: unsafe addresses are rejected and HTML-like input remains harmless text", async ({ page, browser }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { root, api, link } = await setup(page);
  const heading = "<script>window.landingUnsafe=1</script>", title = "<img src=x onerror=window.landingUnsafe=1>";
  await page.goto(`${root}/${link.id}/landing`);
  await page.getByLabel("Welcome heading (optional)", { exact: true }).fill(heading);
  await page.getByRole("button", { name: "Add a website link", exact: true }).click();
  await expect(page.getByLabel("Cost for visitors", { exact: true })).toBeDisabled();
  await expect(page.getByText("Community links are always free.", { exact: true })).toBeVisible();
  await page.getByLabel("Link title", { exact: true }).fill(title);
  await page.getByLabel("Description (optional)", { exact: true }).fill("A".repeat(300));
  await page.getByLabel("Website link", { exact: true }).fill("http://localhost/course");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Check your page details before saving." })).toBeVisible();
  await page.getByLabel("Website link", { exact: true }).fill("https://example.org/community");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved privately." })).toBeVisible();
  expect((await page.request.post(`${api}/links/${link.id}/actions`, { headers: { origin }, data: { action: "publish" } })).status()).toBe(200);
  await page.getByRole("button", { name: "Publish changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changes published." })).toBeVisible();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await context.newPage();
    for (const path of [`/c/${link.publicCode}`, `/s/${link.shortCode}`]) {
      await guest.goto(path);
      await expect(guest.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      const suggestions = guest.getByRole("region", { name: "Organizer suggestions", exact: true });
      await expect(suggestions.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(suggestions.locator("script, img")).toHaveCount(0);
      expect(await guest.evaluate(() => (window as unknown as { landingUnsafe?: number }).landingUnsafe)).toBeUndefined();
      for (const header of await suggestions.locator('[data-slot="card-header"]').all()) expect(await header.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    }
  } finally { await context.close(); }
});
