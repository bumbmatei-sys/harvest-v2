import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// The dev server compiles each route on first use, so assertions wait longer than the default 5 seconds.
const expect = baseExpect.configure({ timeout: 20_000 });

// Campaign wizard screens (CW-02): create -> eight steps -> finish -> activate, autosave and version conflicts, roles, axe at three widths in both schemes.
// Runs with the shell modes on (steps in the shell's editing sidebar from 1024px) and with HARVEST_SHELL_MODES=disabled (in-page step list).
test.use({ actionTimeout: 30000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const evidence = "docs/screenshots/campaign-wizard";
const shellModes = process.env.HARVEST_SHELL_MODES !== "disabled";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function shoot(page: Page, name: string) {
  await settleForAxe(page);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}
async function expectAccessible(page: Page) {
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
/** Runs an edit and waits for the autosave it triggers to be accepted. */
async function autosaved(page: Page, edit: () => Promise<void>) {
  const patch = page.waitForResponse((response) => response.request().method() === "PATCH" && /\/campaigns\/drafts\//.test(response.url()));
  await edit();
  expect((await patch).status()).toBe(200);
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
}
async function user(browser: Browser, owner: Page, tenant: string, role: "admin" | "member" | "viewer") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }), page = await context.newPage();
  const email = await signIn(page);
  expect((await owner.request.put(`/api/workspaces/${tenant}/members`, { headers: { origin }, data: { email, role } })).status()).toBe(200);
  return { page, email, context };
}
/** The dev server renders first and hydrates after: typing before React attaches would be lost, which a person cannot do. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => { const field = document.querySelector("input,textarea,select"); return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps")); });
}
const heading = (page: Page, name: string) => page.getByRole("heading", { name, level: 2, exact: true });

test("create a draft, fill steps 1 to 3 with autosave, resume it, and activate a campaign", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`;

  // Start: New campaign on the list; picking a type begins a draft at step 2.
  await page.goto(root);
  await expect(page.getByRole("link", { name: "Drafts", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "New campaign", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New campaign", level: 1 })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(5);
  await expect(page.getByText("A blank project with customizable features.")).toBeVisible();
  await shoot(page, "start-type");
  await page.getByRole("radio", { name: /Local Outreach/ }).click();
  await expect(page).toHaveURL(/\/campaigns\/drafts\/[0-9a-f-]{36}$/);
  const draftUrl = page.url();
  await expect(heading(page, "Basic Information")).toBeVisible();
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  if (shellModes) await expect(page.getByRole("group", { name: /^Editing/ })).toBeVisible(); else await expect(page.getByRole("navigation", { name: "Campaign setup" })).toBeVisible();
  // Steps 4 to 8 are listed and not available yet.
  const stepList = shellModes ? page.getByRole("group", { name: /^Editing/ }) : page.getByRole("navigation", { name: "Campaign setup" });
  for (const label of ["Teams & Leadership", "Campaign Features", "Budget & Fundraising", "Registration & Follow-Up", "Review & Create"]) await expect(stepList.getByRole("button", { name: new RegExp(label) })).toHaveAttribute("aria-disabled", "true");

  // Step 1 can still be changed; it says the template loads again.
  await stepList.getByRole("button", { name: /Campaign Type/ }).click();
  await expect(heading(page, "Campaign Type")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Local Outreach/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Changing the type loads that type’s template again.")).toBeVisible();
  await shoot(page, "step-1-type");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 2: the name is required (nothing is sent while empty), then autosaves.
  await expect(heading(page, "Basic Information")).toBeVisible();
  await expect(page.getByText("Tell us about your campaign.")).toBeVisible();
  await page.getByLabel("Campaign Name").fill("");
  await page.getByLabel("Campaign Goal or Mission (optional)").focus();
  await expect(page.getByText("Required", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(heading(page, "Basic Information")).toBeVisible();
  await autosaved(page, async () => { await page.getByLabel("Campaign Name").fill("Synthetic Bangkok Outreach 2027"); });
  await autosaved(page, async () => { await page.getByLabel("Campaign Goal or Mission (optional)").fill("Serve the city together."); });
  await shoot(page, "step-2-basics");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 3: an end date before the start is refused client-side and nothing is sent.
  await expect(heading(page, "Location & Dates")).toBeVisible();
  await page.getByRole("radio", { name: "Single location" }).click();
  await page.getByLabel("Country").fill("Thailand");
  await page.getByLabel("City / Region").fill("Bangkok");
  await page.getByLabel("Campaign Start Date").fill("2027-03-05");
  await page.getByLabel("Campaign End Date").fill("2027-03-01");
  await expect(page.getByText("End date is before the start date")).toBeVisible();
  await expect(page.locator('[data-save-state="invalid"]')).toBeVisible();
  await page.getByLabel("Campaign Start Date").fill("2027-03-01");
  await autosaved(page, async () => { await page.getByLabel("Campaign End Date").fill("2027-03-05"); });
  await autosaved(page, async () => { await page.getByLabel("Time Zone").selectOption("Asia/Bangkok"); });
  await shoot(page, "step-3-place");
  await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0); // steps 4 to 8 are not available yet

  // Resume: closing and reopening restores every answer, at the furthest step reached.
  await page.goto(draftUrl);
  await expect(heading(page, "Location & Dates")).toBeVisible();
  await expect(page.getByLabel("Country")).toHaveValue("Thailand");
  await expect(page.getByLabel("Time Zone")).toHaveValue("Asia/Bangkok");
  await stepList.getByRole("button", { name: /Basic Information/ }).click();
  await expect(page.getByLabel("Campaign Name")).toHaveValue("Synthetic Bangkok Outreach 2027");
  await page.goto(`${root}/drafts`);
  await expect(page.getByRole("link", { name: /Synthetic Bangkok Outreach 2027/ })).toContainText("Step 4 of 8");
  const stored = await (await page.request.get(`/api${root}/drafts/${draftUrl.split("/drafts/")[1]}`)).json();
  expect(stored).toMatchObject({ name: "Synthetic Bangkok Outreach 2027", structure: "single", timeZone: "Asia/Bangkok", status: "draft", campaignId: null });

  // Activate: owners and admins; state only, with a clear note that nothing is published.
  const created = await page.request.post(`/api${root}`, { headers: { origin, "Idempotency-Key": "activate-1" }, data: { name: "Ready campaign", type: "conference", country: "Chile", startDate: "2027-05-01", endDate: "2027-05-02", timeZone: "America/Santiago", structure: "single" } });
  const campaignId = (await created.json()).id as string;
  await page.goto(`${root}/${campaignId}`);
  await expect(page.getByText("Nothing is published yet.", { exact: true })).toBeVisible();
  await shoot(page, "campaign-activate");
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Nothing is published or sent.");
  await shoot(page, "activate-confirm");
  await page.getByRole("alertdialog").getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByText("Campaign is now active.")).toBeVisible();
  expect((await (await page.request.get(`/api${root}/${campaignId}`)).json()).status).toBe("active");
  expect(((await (await page.request.get(`/api${root}/${campaignId}/connect/links`)).json()).links ?? [])).toHaveLength(0);
  await page.getByRole("button", { name: "Return to draft" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Return to draft" }).click();
  await expect(page.getByText("Campaign is back in draft.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a change made elsewhere shows a clear reload message and nothing is overwritten", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Conflict Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/campaigns/drafts`;
  const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "conflict-1" }, data: { type: "conference" } })).json();
  await page.goto(`/workspaces/${tenant}/campaigns/drafts/${draft.id}`);
  await expect(heading(page, "Basic Information")).toBeVisible();
  await hydrated(page);
  await autosaved(page, async () => { await page.getByLabel("Campaign Name").fill("First name"); });
  // Another tab or device saves the same draft: the version moves on.
  const other = await page.request.get(`${api}/${draft.id}`).then((response) => response.json());
  expect((await page.request.patch(`${api}/${draft.id}`, { headers: { origin }, data: { version: other.version, step: "basics", data: { name: "Changed in another tab" } } })).status()).toBe(200);
  await page.getByLabel("Campaign Name").fill("My stale edit");
  const refused = page.waitForResponse((response) => response.request().method() === "PATCH" && response.status() === 409);
  await refused;
  await expect(page.getByRole("alert").filter({ hasText: "This draft changed somewhere else" })).toBeVisible();
  await expect(page.locator('[data-save-state="conflict"]')).toBeVisible();
  await expect(page.getByLabel("Campaign Name")).toBeDisabled();
  await shoot(page, "conflict");
  await expectAccessible(page);
  expect((await (await page.request.get(`${api}/${draft.id}`)).json()).name).toBe("Changed in another tab");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(heading(page, "Location & Dates")).toBeVisible(); // the draft resumes at the furthest step reached
  await hydrated(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Campaign Name")).toHaveValue("Changed in another tab");
  await expect(page.getByLabel("Campaign Name")).toBeEnabled();
});

test("roles: members work on their own drafts, admins see and discard every draft, viewers see none", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Roles Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const admin = await user(browser, page, tenant, "admin"), member = await user(browser, page, tenant, "member"), viewer = await user(browser, page, tenant, "viewer"), member2 = await user(browser, page, tenant, "member");
  try {
    // A member starts a draft through the screens.
    await member.page.goto(`${root}/new`);
    await member.page.getByRole("radio", { name: /Mission Trip/ }).click();
    await expect(member.page).toHaveURL(/\/campaigns\/drafts\/[0-9a-f-]{36}$/);
    const draftUrl = member.page.url(), draftId = draftUrl.split("/drafts/")[1];
    await autosaved(member.page, async () => { await member.page.getByLabel("Campaign Name").fill("Member mission trip"); });

    // The member's list shows only their own; another member and a viewer see none.
    await member.page.goto(`${root}/drafts`);
    await expect(member.page.getByRole("heading", { name: "Campaign drafts", level: 1 })).toBeVisible();
    await expect(member.page.getByText("Your drafts")).toBeVisible();
    await expect(member.page.getByRole("link", { name: /Member mission trip/ })).toBeVisible();
    await member2.page.goto(`${root}/drafts`);
    await expect(member2.page.getByRole("heading", { name: "No drafts", level: 2 })).toBeVisible();
    expect((await member2.page.request.get(`${api}/${draftId}`)).status()).toBe(404);
    await viewer.page.goto(`${root}/drafts`);
    await expect(viewer.page.getByRole("heading", { name: "No drafts", level: 2 })).toBeVisible();
    await expect(viewer.page.getByRole("link", { name: "New campaign" })).toHaveCount(0);
    expect((await viewer.page.request.post(api, { headers: { origin, "Idempotency-Key": "viewer-1" }, data: { type: "conference" } })).status()).toBe(403);
    await viewer.page.goto(`${root}/new`);
    await expect(viewer.page.getByRole("radio")).toHaveCount(0);
    await viewer.page.goto(root);
    await expect(viewer.page.getByRole("link", { name: "New campaign" })).toHaveCount(0);

    // The admin sees it, reads it without being able to edit, and cannot finish it.
    await admin.page.goto(`${root}/drafts`);
    await expect(admin.page.getByText("Every draft in this ministry")).toBeVisible();
    await expect(admin.page.getByRole("link", { name: /Member mission trip/ })).toContainText(`Started by ${member.email}`);
    await admin.page.getByRole("link", { name: /Member mission trip/ }).click();
    await expect(admin.page.getByText(`Only ${member.email} can edit this draft.`)).toBeVisible();
    // The draft resumes at the furthest step reached; the name is on step 2.
    await (shellModes ? admin.page.getByRole("group", { name: /^Editing/ }) : admin.page.getByRole("navigation", { name: "Campaign setup" })).getByRole("button", { name: /Basic Information/ }).click();
    await expect(admin.page.getByLabel("Campaign Name")).toBeDisabled();
    await expect(admin.page.getByLabel("Campaign Name")).toHaveValue("Member mission trip");
    await expect(admin.page.locator("[data-save-state]")).toHaveCount(0);
    expect((await admin.page.request.patch(`${api}/${draftId}`, { headers: { origin }, data: { version: 2, step: "basics", data: { name: "Hijack" } } })).status()).toBe(403);
    await shoot(admin.page, "read-only-admin");

    // A second draft by the member is discarded by the admin from the list, after a confirm.
    expect((await member.page.request.post(api, { headers: { origin, "Idempotency-Key": "second-draft" }, data: { type: "conference" } })).status()).toBe(201);
    await admin.page.goto(`${root}/drafts`);
    await expect(admin.page.getByRole("list", { name: "Campaign drafts" }).getByRole("listitem")).toHaveCount(2);
    await shoot(admin.page, "drafts-admin");
    await admin.page.getByRole("button", { name: /Discard: Untitled campaign/ }).click();
    await expect(admin.page.getByRole("alertdialog")).toContainText("Discard this draft?");
    await admin.page.getByRole("alertdialog").getByRole("button", { name: "Keep draft" }).click();
    await expect(admin.page.getByRole("list", { name: "Campaign drafts" }).getByRole("listitem")).toHaveCount(2);
    await admin.page.getByRole("button", { name: /Discard: Untitled campaign/ }).click();
    await admin.page.getByRole("alertdialog").getByRole("button", { name: "Discard draft" }).click();
    await expect(admin.page.getByText("Draft discarded.")).toBeVisible();
    await expect(admin.page.getByRole("list", { name: "Campaign drafts" }).getByRole("listitem")).toHaveCount(1);
    // A plain member cannot discard another member's draft.
    expect((await member2.page.request.post(`${api}/${draftId}/discard`, { headers: { origin }, data: { version: 2 } })).status()).toBe(404);

    // Activate is for owners and admins only: the member who finished a campaign does not see it.
    const finished = await member.page.request.post(`/api${root}`, { headers: { origin, "Idempotency-Key": "plain-campaign" }, data: { name: "Plain", type: "conference", country: "Chile", startDate: "2027-05-01", endDate: "2027-05-02", timeZone: "America/Santiago", structure: "single" } });
    const campaignId = (await finished.json()).id as string;
    await member.page.goto(`${root}/${campaignId}`);
    await expect(member.page.getByRole("heading", { name: "Plain", level: 1 })).toBeVisible();
    await expect(member.page.getByRole("button", { name: "Activate" })).toHaveCount(0);
    expect((await member.page.request.post(`/api${root}/${campaignId}/status`, { headers: { origin }, data: { status: "active" } })).status()).toBe(403);
    await admin.page.goto(`${root}/${campaignId}`);
    await expect(admin.page.getByRole("button", { name: "Activate", exact: true })).toBeVisible();
    // A campaign without its place and dates cannot be activated; the message says what to add.
    const bare = await (await member.page.request.post(`/api${root}`, { headers: { origin, "Idempotency-Key": "bare-campaign" }, data: { name: "Bare", type: "custom_project" } })).json();
    await admin.page.goto(`${root}/${bare.id}`);
    await admin.page.getByRole("button", { name: "Activate", exact: true }).click();
    await admin.page.getByRole("alertdialog").getByRole("button", { name: "Activate", exact: true }).click();
    await expect(admin.page.getByRole("alert").filter({ hasText: "Add the place, dates and time zone before activating." })).toBeVisible();
  } finally {
    for (const person of [admin, member, member2, viewer]) await person.context.close();
  }
});

test("axe: the wizard and the drafts list at 360, 768 and 1280 in light and dark", async ({ page }) => {
  test.setTimeout(300_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Axe Church", audience: "church" } })).json()).tenantId as string;
  const root = `/workspaces/${tenant}/campaigns`, api = `/api${root}/drafts`;
  const draft = await (await page.request.post(api, { headers: { origin, "Idempotency-Key": "axe-1" }, data: { type: "evangelistic_crusade" } })).json();
  expect((await page.request.patch(`${api}/${draft.id}`, { headers: { origin }, data: { version: draft.version, step: "basics", data: { name: "Axe check campaign", mission: "Testing" } } })).status()).toBe(200);
  // Every available step at the desktop width in light (the draft resumes at the furthest step reached).
  await page.goto(`${root}/drafts/${draft.id}`);
  for (const label of ["Location & Dates", "Basic Information", "Campaign Type"]) {
    await expect(heading(page, label)).toBeVisible();
    await expectAccessible(page);
    if (label !== "Campaign Type") await page.getByRole("button", { name: "Back", exact: true }).click();
  }
  // One scene per width and scheme on the wizard (the place step, the densest) and on the list.
  const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.goto(`${root}/drafts/${draft.id}`);
      await expect(heading(page, "Location & Dates")).toBeVisible();
      if (width < 1024) { // below 1024px the steps are a "Step n of 8" bar, or the in-page list with shell modes off
        if (shellModes) await expect(page.getByRole("button", { name: /^Step \d of 8/ })).toBeVisible();
      }
      await expectAccessible(page);
      await shoot(page, `wizard-place-${label}-${scheme}`);
      await page.goto(`${root}/drafts`);
      await expect(page.getByRole("heading", { name: "Campaign drafts", level: 1 })).toBeVisible();
      await expectAccessible(page);
      await shoot(page, `drafts-${label}-${scheme}`);
      // 44px targets on the controls a thumb meets.
      if (width < 768) for (const target of [page.getByRole("link", { name: "New campaign" }), page.getByRole("button", { name: /^Discard/ })]) {
        const box = await target.first().boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
});
