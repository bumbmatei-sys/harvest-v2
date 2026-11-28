import { randomUUID } from "node:crypto";
import { expect as baseExpect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Long enough for the dev server to compile a route on its first request on a busy runner.
const expect = baseExpect.configure({ timeout: 90000 });
// Public fundraising page (/give/<slug>): the owner publishes it from the fundraiser screen, a signed-out visitor sees it (progress, Ways to give, Report),
// and the amount disappears when the owner switches it off. Synthetic data only; nothing is sent or paid.
test.use({ actionTimeout: 20000, navigationTimeout: 120000, reducedMotion: "reduce" });
const post = (page: Page, url: string, data: unknown, headers: Record<string, string> = {}) => page.request.post(url, { headers: { origin, ...headers }, data, timeout: 120000 }); // First use of a route compiles it.

/** The dev server can abort the first navigation to a route while it compiles it; one more try then. */
async function visit(page: Page, url: string) {
  try { return await page.goto(url); } catch (error) { if (!String(error).includes("ERR_ABORTED")) throw error; return page.goto(url); }
}

async function axe(page: Page, label: string) {
  await settleForAxe(page);
  const found = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
  expect(found.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("owner publishes the give page, a visitor sees it, and the amount hides when switched off", async ({ page, browser }) => {
  test.setTimeout(300000);
  const slug = `christmas-outreach-${Date.now().toString(36)}`;
  await page.setViewportSize({ width: 1280, height: 900 });
  // The dev server compiles the sign-in route on first use; give that one request room on a busy runner.
  await page.request.get("/api/auth/ok", { timeout: 180000 });
  await signIn(page);
  const tenant = (await (await post(page, "/api/workspaces", { name: "Grace Community Church", audience: "church" })).json()).tenantId as string;
  await page.context().setExtraHTTPHeaders({});
  for (const method of [{ kind: "paypal", label: "Give online", url: "https://paypal.me/gracechurch" }, { kind: "revolut", label: "Revolut", url: "https://revolut.me/gracechurch" },
    { kind: "wise", label: "Wise", url: "https://wise.com/pay/me/gracechurch" },
    { kind: "bank_transfer", label: "Bank transfer", iban: "GB82WEST12345698765432", bic: "WESTGB2L", accountHolder: "Grace Community Church" }])
    expect((await post(page, `/api/workspaces/${tenant}/giving/methods`, { ...method, enabled: true })).ok()).toBe(true);
  const fund = await (await post(page, `/api/workspaces/${tenant}/fundraising`, { title: "Christmas outreach", goalCents: "500000", currency: "USD" }, { "idempotency-key": randomUUID() })).json();
  // Five synthetic supporters, so the total clears small-group suppression.
  for (const n of [1, 2, 3, 4, 5]) {
    const person = await (await post(page, `/api/workspaces/${tenant}/contacts`, { name: `Synthetic Supporter ${n}`, email: `give-${n}-${randomUUID().slice(0, 6)}@example.test` })).json();
    expect((await post(page, `/api/workspaces/${tenant}/fundraising/${fund.id}/gifts`, { amountCents: String(25000 * n), giftDate: "2026-11-20", contactId: person.id, confirmed: true },
      { "idempotency-key": randomUUID() })).ok()).toBe(true);
  }

  // Owner: the Public page section on the fundraiser screen.
  await visit(page, `/workspaces/${tenant}/giving/fundraising/${fund.id}`);
  const section = page.locator("[data-give-section]");
  await expect(section.getByRole("heading", { name: "Public page" })).toBeVisible();
  await expect(section.getByLabel("Address")).toHaveValue("christmas-outreach");
  await section.getByLabel("Address").fill(slug);
  await section.getByRole("textbox", { name: "Description" }).fill("Hot meals and gifts for 200 families this Christmas.\nEvery gift helps.");
  await section.getByRole("button", { name: "Save page" }).click();
  await expect(page.getByText("Public page saved.").first()).toBeVisible();
  await expect(section.locator("[data-give-link]")).toHaveText(`${origin}/give/${slug}`);
  await expect(section.getByText("Not public yet")).toBeVisible();
  // Not public while the fundraiser is a draft.
  // A forwarded address per visitor, as the deployment's proxy would add (the report limits key on its hash).
  const visitor = await browser.newContext({ baseURL: origin, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": `10.77.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}` } });
  const guest = await visitor.newPage();
  expect((await visit(guest, `/give/${slug}`))?.status()).toBe(404);

  // Open the fundraiser: the address is then fixed and the page is live.
  // The first click right after the save's refresh can be dropped by the dev server (also on main before the kit redo); retry until the dialog opens.
  await expect(async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60000 });
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(section.getByText("Live", { exact: true })).toBeVisible();
  await expect(section.getByLabel("Address")).toHaveAttribute("readonly", "");
  await section.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("[data-give-preview]")).toContainText("Christmas outreach");
  await page.keyboard.press("Escape");

  // Visitor: title, ministry, description, raised/goal/progress, Ways to give with Report, and the notice. Private, uncached.
  const response = await visit(guest, `/give/${slug}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(guest.getByRole("heading", { level: 1, name: "Christmas outreach" })).toBeVisible();
  await expect(guest.getByText("By Grace Community Church")).toBeVisible();
  await expect(guest.locator("[data-give-raised]")).toHaveText("$3,750.00");
  await expect(guest.getByText("75% of goal")).toBeVisible();
  await expect(guest.locator("[data-ways-to-give]")).toContainText("Give online");
  await expect(guest.locator("[data-ways-to-give]")).toContainText("PayPal");
  // The same method rendering as link in bio: brand logos for platforms, the generic bank icon for bank transfer.
  for (const kind of ["paypal", "revolut", "wise"]) await expect(guest.locator(`[data-ways-to-give] [data-giving-logo="${kind}"]`)).toBeVisible();
  await expect(guest.locator('[data-ways-to-give] [data-giving-generic="bank_transfer"]')).toBeVisible();
  await expect(guest.locator("[data-giving-report]")).toBeVisible();
  await expect(guest.locator("[data-give-notice]")).toHaveText("Gifts go directly to Grace Community Church. Harvest doesn't process payments.");
  await expect(guest.locator("body")).not.toContainText("Synthetic Supporter");
  expect(await guest.locator('meta[property="og:title"]').getAttribute("content")).toBe("Christmas outreach");
  for (const [width, height] of [[1280, 900], [360, 800]] as const) { await guest.setViewportSize({ width, height }); await axe(guest, `${width}`); }
  // Report: a reason, sent.
  await guest.locator("[data-giving-report]").click();
  await guest.getByText("Looks like a scam").click();
  await guest.getByRole("button", { name: "Send report" }).click();
  await expect(guest.getByText("Thank you. Harvest staff will review this page.")).toBeVisible();
  await guest.keyboard.press("Escape");

  // The owner switches the amount off: the visitor sees title, description and ways to give only.
  await page.reload();
  await section.getByRole("checkbox", { name: "Show amount raised" }).click();
  await section.getByRole("button", { name: "Save page" }).click();
  await expect(page.getByText("Public page saved.").first()).toBeVisible();
  await guest.reload();
  await expect(guest.getByRole("heading", { level: 1, name: "Christmas outreach" })).toBeVisible();
  await expect(guest.locator("[data-give-progress]")).toHaveCount(0);
  await expect(guest.locator("body")).not.toContainText("$3,750.00");
  await expect(guest.locator("body")).not.toContainText("$5,000.00");
  await expect(guest.locator("[data-ways-to-give]")).toBeVisible();
  // Unknown pages are the same 404.
  expect((await guest.goto("/give/no-such-page-here"))?.status()).toBe(404);
  await visitor.close();
});
