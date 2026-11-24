import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 30000 });
// Newsletter Sign-up forms: the shared forms builder with the newsletter preset, publish, share panel, the public page, double opt-in
// through the fake sink, counts and the roles. Axe runs on the main screen only (one scene per width and scheme).
test.use({ actionTimeout: 30000, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
const evidence = "docs/screenshots/newsletter-signup-forms";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;
const headers = { origin };

async function audit(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function shoot(page: Page, name: string) {
  await settleForAxe(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}

test("sign-up forms: preset builder, publish, share, public page, double opt-in, counts, roles and nav", async ({ page, browser }) => {
  test.setTimeout(600000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/newsletter`, base = `/workspaces/${tenant}/newsletter/forms`;
  const audience = (await (await page.request.post(`${api}/audiences`, { headers, data: { name: "Congregation" } })).json()).id as string;
  for (const name of ["Weekly", "Events"]) expect((await page.request.post(`${api}/lists`, { headers, data: { audienceId: audience, name } })).status()).toBe(200);

  // Empty list, then the nav: Sign-up forms sits between Audience and the end of Newsletter and Operations Campaigns is not highlighted.
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Sign-up forms", level: 1 })).toBeVisible();
  await expect(page.getByText("No sign-up forms yet")).toBeVisible();
  if (process.env.HARVEST_SHELL_MODES !== "disabled") {
    const sidebar = page.locator("[data-sidebar=\"sidebar\"]").first();
    await expect(sidebar.getByRole("link", { name: "Sign-up forms", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(sidebar.getByRole("link", { name: "Campaigns", exact: true })).not.toHaveAttribute("aria-current", "page");
    const order = await sidebar.getByRole("link").allInnerTexts();
    expect(order.indexOf("Sign-up forms")).toBe(order.indexOf("Audience") + 1);
  }
  await shoot(page, "list-empty");

  // New sign-up form from the preset: choose both lists.
  await page.getByRole("button", { name: "New sign-up form" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New sign-up form" });
  await expect(dialog.getByRole("button", { name: "Create form" })).toBeDisabled();
  await dialog.getByLabel("Weekly").check(); await dialog.getByLabel("Events").check();
  await dialog.getByRole("button", { name: "Create form" }).click();
  await expect(page).toHaveURL(/\/newsletter\/forms\/[0-9a-f-]{36}$/);
  const formId = page.url().split("/").pop()!;

  // Builder: the shared builder, fixed questions, locked consent with its wording version, no add-question menu.
  await expect(page.locator("[data-crm-form-editor]")).toBeVisible();
  await expect(page.locator("[data-publication-state]")).toHaveText("Draft");
  await expect(page.locator("[data-question-list] [data-block]")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /Add question/ })).toHaveCount(0);
  await expect(page.locator("[data-signup-consent]")).toContainText("I agree to receive the Grace Community Church newsletter by email");
  await expect(page.locator("[data-signup-consent] [data-fixed-notice]")).toHaveText("Your details go to Grace Community Church. You can ask them to delete them.");
  await expect(page.locator("[data-wording-version]")).toHaveText("newsletter-consent-v1");
  await expect(page.getByRole("button", { name: /^Move up/ })).toHaveCount(0);
  await shoot(page, "builder-build");

  // Settings: lists, name questions, the wording, no CRM destination or owner.
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const settings = page.locator("[data-form-settings]");
  await expect(settings.getByLabel("Weekly")).toBeChecked(); await expect(settings.getByLabel("Events")).toBeChecked();
  await expect(settings.getByLabel("Save to")).toHaveCount(0);
  await expect(settings.locator("[data-signup-wording]")).toContainText("newsletter-consent-v1");
  await settings.getByLabel("Ask for last name").uncheck();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Build", exact: true }).click();
  await expect(page.locator("[data-question-list] [data-block]")).toHaveCount(2);
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await settings.getByLabel("Ask for last name").check();
  await settings.getByLabel("Events").uncheck();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await shoot(page, "builder-settings");
  await settings.getByLabel("Events").check();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  // End page is the confirmation page message.
  await page.getByRole("tab", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: "End page" }).click();
  await expect(page.locator("[data-end-page]").getByLabel("Thank-you title")).toHaveValue("Check your email");

  // Preview, share before publishing, then publish.
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.locator("[data-preview-tab]").getByLabel(/I agree to receive the Grace Community Church newsletter/)).not.toBeChecked();
  await page.getByRole("tab", { name: "Share", exact: true }).click();
  await expect(page.getByText("Publish the form to get its link, embed code and QR code.")).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const publish = page.getByRole("alertdialog", { name: "Publish this form?" });
  await expect(publish).toContainText("/subscribe/");
  await publish.getByLabel("Public address").fill("grace-newsletter");
  await publish.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.locator("[data-publication-state]")).toHaveText("Published");

  // Share panel: link, embed snippet, QR image.
  await expect(page.locator("[data-share-link]")).toHaveValue(`${origin}/subscribe/grace-newsletter`);
  await expect(page.locator("[data-share-embed]")).toHaveValue(new RegExp(`<iframe src="${origin}/subscribe/grace-newsletter\\?embed=1"`));
  await expect(page.locator("[data-share-qr]")).toBeVisible();
  const qr = await page.request.get(`${api}/forms/${formId}/qr?format=svg`);
  expect(qr.status()).toBe(200); expect(qr.headers()["content-type"]).toContain("image/svg+xml");
  expect((await page.request.get(`${api}/forms/${formId}/qr?format=png`)).headers()["content-type"]).toBe("image/png");
  await page.getByRole("button", { name: "Copy public link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/subscribe/grace-newsletter`);
  await shoot(page, "builder-share");

  // The public page (a visitor with no session): fill, consent, submit, then the message and the fake sink.
  const visitor = await (await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 800 }, reducedMotion: "reduce" })).newPage();
  await visitor.goto("/subscribe/grace-newsletter");
  await expect(visitor.getByRole("heading", { name: "Join our newsletter" })).toBeVisible();
  const email = `visitor-${Date.now()}@example.test`;
  await visitor.getByLabel(/^Email address/).fill(email);
  await visitor.getByLabel(/^First name/).fill("Ada"); await visitor.getByLabel(/^Last name/).fill("Lovelace");
  const consent = visitor.getByLabel(/I agree to receive the Grace Community Church newsletter/);
  await expect(consent).not.toBeChecked();
  await expect(visitor.locator("[data-fixed-notice]")).toHaveText("Your details go to Grace Community Church. You can ask them to delete them.");
  await shoot(visitor, "public-form");
  await visitor.getByRole("button", { name: "Sign up" }).click();
  await expect(visitor.getByText("Please agree to continue.")).toBeVisible();
  await consent.check();
  await visitor.waitForTimeout(1200);
  await visitor.getByRole("button", { name: "Sign up" }).click();
  await expect(visitor.locator("[data-form-done]")).toContainText("Check your email");
  await shoot(visitor, "public-confirmation-message");

  // Nothing is granted yet: Audience has no such person, and the counts say one is waiting.
  const sinkUrl = `/api/newsletter/confirmation-sink?to=${encodeURIComponent(email)}`;
  const { messages } = await (await page.request.get(sinkUrl)).json() as { messages: { path: string; subject: string }[] };
  expect(messages).toHaveLength(1);
  expect(messages[0].subject).toBe("Confirm your sign-up to Grace Community Church");
  expect((await (await page.request.get(`/api/workspaces/${tenant}/contacts?q=Lovelace`)).json()).total).toBe(0);
  await page.goto(`${base}/${formId}?tab=signups`);
  const counts = page.locator("[data-signups-panel]");
  await expect(counts.getByTestId("report-stat").filter({ hasText: "Waiting for confirmation" }).getByTestId("report-value")).toHaveText("1");
  await expect(counts.getByTestId("report-stat").filter({ hasText: "Confirmed" }).first().getByTestId("report-value")).toHaveText("0");
  expect(await counts.innerText()).not.toContain(email);
  await shoot(page, "builder-signups-pending");

  // The link: opening it only shows a button; the button confirms.
  await visitor.goto(messages[0].path);
  await expect(visitor.getByRole("heading", { name: "Confirm your sign-up" })).toBeVisible();
  await shoot(visitor, "confirm-page");
  await visitor.getByRole("button", { name: "Confirm" }).click();
  await expect(visitor.locator("[data-confirm-done]")).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`/api/workspaces/${tenant}/contacts?q=Lovelace`)).json()).total).toBe(1);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(counts.getByTestId("report-stat").filter({ hasText: "Waiting for confirmation" }).getByTestId("report-value")).toHaveText("0");
  await expect(counts.getByTestId("report-stat").filter({ hasText: /^Confirmed/ }).getByTestId("report-value")).toHaveText("1");
  await shoot(page, "builder-signups-confirmed");

  // The embed: the public page without chrome.
  await visitor.goto("/subscribe/grace-newsletter?embed=1");
  await expect(visitor.getByRole("heading", { name: "Join our newsletter" })).toBeVisible();

  // Audience shows the confirmed person on both lists.
  await page.goto(`/workspaces/${tenant}/newsletter/audience`);
  await expect(page.getByRole("grid").getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Subscribed/ }).getByText("1", { exact: true })).toBeVisible();

  // The list: status, lists, sign-ups, last sign-up, actions. This is the main screen audited at every width and scheme.
  await page.goto(base);
  const row = page.getByRole("row").filter({ hasText: "Join our newsletter" });
  await expect(row).toContainText("Published"); await expect(row).toContainText("Weekly, Events"); await expect(row.getByText("1", { exact: true })).toBeVisible();
  await audit(page, "list");
  await page.getByRole("button", { name: "Actions for Join our newsletter", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/subscribe/grace-newsletter`);
  await page.getByRole("button", { name: "Actions for Join our newsletter", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page).toHaveURL(/\/newsletter\/forms\/[0-9a-f-]{36}$/);
  await expect(page.locator("[data-publication-state]")).toHaveText("Draft");
  await page.locator("[data-crm-form-editor]").getByRole("link", { name: "Sign-up forms", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Draft" })).toHaveCount(1);
  await shoot(page, "list-populated");
  // CRM forms keep their own list: the sign-up forms are not in it, and its editor sends a sign-up form here.
  await page.goto(`/workspaces/${tenant}/crm/forms`);
  await expect(page.getByText("Join our newsletter")).toHaveCount(0);
  await page.goto(`/workspaces/${tenant}/crm/forms/${formId}`);
  await expect(page).toHaveURL(new RegExp(`/newsletter/forms/${formId}$`));

  // Archive: unpublished, gone from the list, the public page says it is not available.
  await page.goto(base);
  await page.getByRole("button", { name: "Actions for Join our newsletter", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Join our newsletter" })).toHaveCount(1);
  await visitor.goto("/subscribe/grace-newsletter");
  await expect(visitor.locator("[data-signup-unavailable]")).toBeVisible();

  // Roles: a member and a viewer see no screen and no navigation entry; the API refuses them.
  for (const role of ["member", "viewer"]) {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const other = await context.newPage(), otherEmail = await signIn(other);
    expect((await page.request.put(`/api/workspaces/${tenant}/members`, { headers, data: { email: otherEmail, role } })).status()).toBe(200);
    await other.goto(base);
    await expect(other.getByText("Only owners and admins manage sign-up forms.")).toBeVisible();
    await expect(other.locator("[data-sidebar=\"sidebar\"]").first().getByRole("link", { name: "Sign-up forms", exact: true })).toHaveCount(0);
    expect((await other.request.get(`${api}/forms`)).status()).toBe(403);
    expect((await other.request.post(`${api}/forms`, { headers, data: { listIds: [audience] } })).status()).toBe(403);
    await context.close();
  }
  expect(errors).toEqual([]);
});
