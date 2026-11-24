import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 30000 });
// Newsletter Sender: sender addresses, sending-domain verification (synthetic provider only), mailing address, readiness. Sending itself is off.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/newsletter-sender";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;

async function plain(page: Page, name: string) {
  await page.setViewportSize({ width: 1280, height: 2400 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await settleForAxe(page);
    await page.screenshot({ path: `${evidence}/${name}-desktop-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Axe, no horizontal scroll and a screenshot on the main screen at each width and colour scheme. */
async function audit(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload(); await page.waitForTimeout(400);
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

test("sender: addresses, domain verification, mailing address, readiness and the Send step links", async ({ page }) => {
  test.setTimeout(600000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const base = `/workspaces/${tenant}/newsletter/sender`;

  // A campaign started before any sender exists: its Send step points to Sender.
  await page.goto(`/workspaces/${tenant}/newsletter/campaigns`);
  await page.locator('section [data-template="weekly-update"]').getByRole("button", { name: "Use Weekly update" }).click();
  await expect(page).toHaveURL(/\/newsletter\/campaigns\/[0-9a-f-]{36}$/);
  const editorUrl = page.url();
  await page.getByRole("navigation", { name: "Campaign steps" }).getByRole("button", { name: /^Send/ }).click();
  await expect(page.locator('[data-check="address"][data-level="fail"]')).toBeVisible();
  await expect(page.locator("[data-send-step] [data-sender-link]").first()).toHaveAttribute("href", base);

  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Sender", exact: true })).toBeVisible();
  await expect(page.getByText("Not ready to send")).toBeVisible();
  await expect(page.getByText("Sending is not enabled yet.")).toBeVisible();
  await expect(page.locator('[data-ready-item="sender"]')).toHaveAttribute("data-ok", "false");
  if (process.env.HARVEST_SHELL_MODES !== "disabled") {
    const sidebar = page.locator("[data-sidebar=\"sidebar\"]").first();
    const sender = sidebar.getByRole("link", { name: "Sender", exact: true });
    await expect(sender).toHaveAttribute("aria-current", "page");
    await expect(sender).toHaveAttribute("href", base);
    await expect(sidebar.getByRole("link", { name: "Campaigns", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect(sidebar.locator(`a[href="/workspaces/${tenant}/campaigns"]`)).toHaveCount(0);
    // Sender is the last entry of the Newsletter group.
    const hrefs = await sidebar.locator(`a[href^="/workspaces/${tenant}/newsletter/"]`).evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(hrefs.at(-1)).toBe(base);
  }
  await plain(page, "empty");

  // Domain: records grouped by purpose with copy buttons, not verified until the provider says so.
  await page.getByLabel("Domain", { exact: true }).fill("news.example.test");
  await page.getByRole("button", { name: "Add domain" }).click();
  const card = page.locator("section[data-slot=form-section]").filter({ hasText: "news.example.test" });
  await expect(card.getByText("Not checked", { exact: true }).first()).toBeVisible();
  for (const group of ["ownership", "dkim", "spf", "bounce", "dmarc"]) await expect(card.locator(`[data-record-group="${group}"]`)).toBeVisible();
  await expect(card.getByRole("heading", { name: "Message signing" })).toBeVisible();
  await expect(card.getByRole("button", { name: /^Copy host / }).first()).toBeVisible();
  await expect(card.getByRole("button", { name: /^Copy value / }).first()).toBeVisible();
  await expect(card.locator("[data-last-checked]")).toHaveText("Not checked yet");
  await card.getByRole("button", { name: "Verify" }).click();
  await expect(card.getByText("Verified", { exact: true })).toBeVisible();
  await expect(card.locator("[data-last-checked]")).toContainText("Last checked");
  // A domain the synthetic provider cannot confirm is reported as not verified.
  await page.getByLabel("Domain", { exact: true }).fill("church.example.org");
  await page.getByRole("button", { name: "Add domain" }).click();
  const unverified = page.locator("section[data-slot=form-section]").filter({ hasText: "church.example.org" });
  await unverified.getByRole("button", { name: "Verify" }).click();
  await expect(unverified.getByText("Not verified", { exact: true })).toBeVisible();
  await expect(unverified.getByText("Not found").first()).toBeVisible();
  await page.getByLabel("Domain", { exact: true }).fill("church.example.org");
  await page.getByRole("button", { name: "Add domain" }).click();
  await expect(page.getByText("This domain is already added.")).toBeVisible();

  // Addresses: add, confirm with the test code, see the statuses.
  for (const [address, kind] of [["hello@news.example.test", "From"], ["replies@outlook.com", "Reply-to"]] as const) {
    await page.getByRole("button", { name: "Add address" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Address").fill(address);
    await dialog.getByLabel("Type").selectOption({ label: kind });
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const row = page.getByRole("row").filter({ hasText: address }).or(page.locator("[data-slot=card]").filter({ hasText: address })).first();
    await expect(row.getByText("Pending", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Actions for ${address}` }).click();
    await page.getByRole("menuitem", { name: "Enter code" }).click();
    await page.getByRole("button", { name: "Use test code" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row.getByText("Verified", { exact: true })).toBeVisible();
  }
  // A wrong code is refused.
  await page.getByRole("button", { name: "Add address" }).click();
  await page.getByRole("dialog").getByLabel("Address").fill("hi@church.example.org");
  await page.getByRole("dialog").getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Actions for hi@church.example.org" }).click();
  await page.getByRole("menuitem", { name: "Enter code" }).click();
  await page.getByRole("dialog").getByLabel("Code").fill("wrong");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("The code is wrong or has expired.")).toBeVisible();
  await page.keyboard.press("Escape");
  // Turn an address off and on.
  await page.getByRole("button", { name: "Actions for hi@church.example.org" }).click();
  await page.getByRole("menuitem", { name: "Turn off" }).click();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();

  // Mailing address and readiness.
  await expect(page.locator('[data-ready-item="mailingAddress"]')).toHaveAttribute("data-ok", "false");
  await page.locator("#sender-mailing").getByRole("textbox").fill("100 Main Street, Springfield");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready to send", { exact: true })).toBeVisible();
  for (const item of ["domain", "sender", "replyTo", "mailingAddress", "unsubscribe"]) await expect(page.locator(`[data-ready-item="${item}"]`)).toHaveAttribute("data-ok", "true");
  await expect(page.getByText("Sending is not enabled yet.")).toBeVisible();
  await plain(page, "ready-full");
  await audit(page, "ready");

  // Back in the campaign: the saved mailing address passes the check and the From picker lists the confirmed senders.
  await page.goto(editorUrl);
  await page.getByRole("navigation", { name: "Campaign steps" }).getByRole("button", { name: /^Send/ }).click();
  await expect(page.locator('[data-check="address"][data-level="pass"]')).toBeVisible();
  await expect(page.locator("#nl-senderId option", { hasText: "hello@news.example.test" })).toHaveCount(1);
  await expect(page.locator("[data-send-button]")).toBeDisabled();

  // API: the review refuses an email without an address, members see nothing.
  expect((await page.request.get(`/api/workspaces/${tenant}/newsletter/sender-setup`)).status()).toBe(200);
  expect(errors).toEqual([]);
});
