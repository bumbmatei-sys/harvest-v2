import { test, type Page } from "@playwright/test";
import { adsSynced, adsWorkspace, audit, expect, releaseAfterEach } from "./helpers/ads";

// Lead forms (built on the shared forms builder with the ads preset) and leads (with the explicit add-to-CRM action), against the real Ads routes and the in-memory test provider.
// Every name, address and number is invented; nothing leaves the process.
test.use({ actionTimeout: 30_000, timezoneId: "UTC", reducedMotion: "reduce" });
const release = releaseAfterEach();

async function openLeads(page: Page, tab?: "leads") {
  await page.getByRole("link", { name: "Lead forms and leads" }).click();
  await expect(page.getByRole("heading", { name: "Lead forms and leads", level: 1 })).toBeVisible();
  await expect(page.locator('[data-ads-leads-ready="true"]')).toBeVisible();
  if (tab) await page.getByRole("tab", { name: /^Leads/ }).click();
}

test("lead forms: list, new form, builder with the ads preset, consent question, save, preview and publish", async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await adsWorkspace(page, release);
  await adsSynced(page, tenant);
  await openLeads(page);
  await expect(page.getByRole("row").filter({ hasText: "Youth camp sign-up" })).toContainText("Ad account");
  await audit(page, "lead-forms");

  await page.locator("[data-ads-new-form]").click();
  await page.getByLabel("Privacy policy link").fill("not a link");
  await expect(page.getByText("Enter a link starting with https://")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create form" })).toBeDisabled();
  await page.getByLabel("Privacy policy link").fill("https://example.test/privacy");
  await page.getByRole("button", { name: "Create form" }).click();

  await expect(page.locator('[data-ads-builder-ready="true"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ad lead form", level: 1 })).toBeVisible();
  await expect(page.locator("[data-ads-notice]")).toContainText("Your details go to");
  // Complete as built: no issue is listed and publishing is possible.
  await expect(page.getByRole("button", { name: "Publish to ad account" })).toBeEnabled();
  // The follow-up consent question is optional and its own tick box.
  await page.getByLabel("Form name").fill("Spring camp interest");
  await page.getByRole("switch", { name: /Ask to be contacted again/ }).click();
  await expect(page.locator('[data-slot="sticky-save-bar"]')).toBeVisible();
  await page.locator('[data-slot="sticky-save-bar"]').getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-slot="sticky-save-bar"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Spring camp interest", level: 1 })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Ask to be contacted again/ })).toBeChecked();
  await expect(page.getByText(/may contact me about my request/).first()).toBeVisible();
  // Removing the privacy link is an issue and blocks publishing.
  await page.getByLabel("Privacy policy link").fill("");
  await expect(page.getByText("Add the privacy policy link.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish to ad account" })).toBeDisabled();
  await page.getByLabel("Privacy policy link").fill("https://example.test/privacy");
  await audit(page, "lead-form-builder");

  await page.locator("[data-ads-publish]").click();
  await expect(page.locator("[data-ads-published]")).toBeVisible();
  await page.getByRole("link", { name: "Lead forms" }).first().click();
  await expect(page.getByRole("row").filter({ hasText: "Spring camp interest" }).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "This app" }).first()).toContainText("Published");
});

test("leads: refresh, change status, add one and all to the CRM, filter and delete", async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await adsWorkspace(page, release);
  await adsSynced(page, tenant);
  await openLeads(page, "leads");
  await expect(page.getByText("No leads yet")).toBeVisible();
  await page.getByRole("button", { name: "Refresh leads" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Ada Example" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Ben Example" })).toBeVisible();
  await audit(page, "leads");

  const ada = page.getByRole("row").filter({ hasText: "Ada Example" });
  await ada.getByLabel("Status of Ada Example").selectOption("contacted");
  await expect(ada.getByLabel("Status of Ada Example")).toHaveValue("contacted");
  await page.getByLabel("Filter by status").selectOption("contacted");
  await expect(page.getByRole("row").filter({ hasText: "Ben Example" })).toHaveCount(0);
  await page.getByLabel("Filter by status").selectOption("all");

  // Adding to the CRM is an explicit action, one lead or all new ones; a lead already added says so.
  await ada.getByRole("button", { name: "Add to CRM" }).click();
  await expect(ada.getByText("In CRM")).toBeVisible();
  await page.locator("[data-ads-convert-all]").click();
  await expect(page.getByRole("row").filter({ hasText: "Ben Example" }).getByText("In CRM")).toBeVisible();
  await expect(page.locator("[data-ads-convert-all]")).toBeDisabled();

  // Delete asks first and removes the lead.
  await page.getByRole("button", { name: "Delete Ben Example" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("cannot be undone");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Ben Example" })).toBeVisible();
  await page.getByRole("button", { name: "Delete Ben Example" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Ben Example" })).toHaveCount(0);
});
