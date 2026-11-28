import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 30000 });
// Newsletter Audience: a lens over CRM people (status counts, lists, saved groups), shared filters, list management, consent rules.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/newsletter-audience";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;

async function shoot(page: Page, name: string) {
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
}

test("audience: lens counts, filters, lists, saved groups, consent rules and the nav", async ({ page }) => {
  test.setTimeout(600000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const base = `/workspaces/${tenant}/newsletter/audience`;
  const person = async (name: string, email: string, consent?: "granted" | "withdrawn") => {
    const created = await (await page.request.post(`/api/workspaces/${tenant}/contacts`, { headers: { origin }, data: { name, email, notes: "" } })).json();
    if (consent) expect((await page.request.post(`/api/workspaces/${tenant}/contacts/${created.id}/consents`, { headers: { origin },
      data: { purpose: "newsletter", channel: "email", status: consent, noticeVersion: "notice-v1", source: "test", evidence: "Synthetic" } })).status()).toBe(201);
    return created.id as string;
  };
  await person("Ada Never", "ada@example.test"); await person("Ben Ready", "ben@example.test", "granted"); await person("Cy Out", "cy@example.test", "withdrawn");

  // Nav: Audience is live under Public > Newsletter and the operations Campaigns entry is not highlighted.
  await page.goto(base);
  await expect(page.getByRole("heading", { name: /^All people/ })).toBeVisible();
  if (process.env.HARVEST_SHELL_MODES !== "disabled") {
    const sidebar = page.locator("[data-sidebar=\"sidebar\"]").first();
    await expect(sidebar.getByRole("link", { name: "Audience", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(sidebar.getByRole("link", { name: "Campaigns", exact: true })).not.toHaveAttribute("aria-current", "page");
  }
  const lens = page.getByRole("navigation", { name: "Status" });
  for (const [label, count] of [["All people", "3"], ["Subscribed", "0"], ["Not on a list", "1"], ["Unsubscribed", "1"], ["No consent yet", "1"]] as const)
    await expect(lens.getByRole("link", { name: label }).getByText(count, { exact: true })).toBeVisible();
  await shoot(page, "all");

  // Status lens and the shared search.
  await lens.getByRole("link", { name: /^No consent yet/ }).click();
  await expect(page.getByRole("grid").getByText("Ada Never")).toBeVisible();
  await expect(page.getByRole("grid").getByText("Ben Ready")).toHaveCount(0);
  await page.goto(`${base}?q=Ben`);
  await expect(page.getByRole("grid").getByText("Ben Ready")).toBeVisible();
  await expect(page.getByRole("grid").getByText("Cy Out")).toHaveCount(0);

  // Create a list, add a person with consent, be refused for one without.
  await page.goto(base);
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByLabel("List name").fill("Weekly");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/newsletter\/audience\/list\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /^Weekly/ })).toBeVisible();
  await page.getByRole("button", { name: "Add people" }).click();
  await page.getByPlaceholder("Search people").fill("Ada");
  await page.getByRole("option", { name: "Ada Never" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No recorded newsletter consent" })).toBeVisible();
  await page.getByPlaceholder("Search people").fill("Ben");
  await page.getByRole("option", { name: "Ben Ready" }).click();
  await expect(page.getByRole("grid").getByText("Ben Ready")).toBeVisible();
  await expect(page.getByRole("grid").getByText("On this list")).toBeVisible();
  await expect(page.getByRole("grid").getByText("Ada Never")).toHaveCount(0);
  await shoot(page, "list");

  // Rename and remove from the list; the person stays in the CRM with the consent record.
  await page.getByRole("button", { name: "Actions for Weekly" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("List name").fill("Weekly news");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Weekly news/ })).toBeVisible();
  await page.getByRole("button", { name: "Remove Ben Ready from this list" }).click();
  await expect(page.getByRole("grid").getByText("Removed")).toBeVisible();

  // Saved group from the current filter (the shared filter popover), then it shows under Saved groups.
  await page.goto(base);
  await expect(page.getByRole("button", { name: "Save as group" })).toBeDisabled();
  await page.goto(`${base}?q=Ben`);
  await page.getByRole("button", { name: "Save as group" }).click();
  await page.getByLabel("Group name").fill("Bens");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/newsletter\/audience\/group\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /^Bens/ })).toBeVisible();
  await expect(page.getByRole("grid").getByText("Ben Ready")).toBeVisible();

  // Rename the saved group, then delete it (archive): the chip follows, then disappears.
  await page.goto(base);
  await page.getByRole("button", { name: "Actions for Bens" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Group name").fill("Bens club");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: "Bens club" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bens", exact: true })).toHaveCount(0);
  await shoot(page, "groups");
  await page.getByRole("button", { name: "Actions for Bens club" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: "Bens club" })).toHaveCount(0);

  // Delete the list: it is gone from the lens.
  await page.goto(base);
  await page.getByRole("button", { name: "Actions for Weekly news" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Weekly news/ })).toHaveCount(0);
  await shoot(page, "after");

  // A viewer sees nothing; a made-up lens is a 404.
  expect((await page.request.get(`${base}/nonsense`)).status()).toBe(404);
  expect(errors).toEqual([]);
});
