import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// PR 0a: the person page shows consent controls by permission. The server stays the real enforcement.
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 }, actionTimeout: 20_000, navigationTimeout: 60_000 });

async function api(page: Page, method: "get" | "post" | "put", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") !== mode) {
    await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  }
}
async function audit(page: Page, name: string) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), name).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} overflow`).toBe(true);
}

test("person page consent controls follow the role", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { audience: "church", name: "Harvest PR0a ministry" });
  const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
  const person = (await api(page, "post", `${apiRoot}/contacts`, { name: "Synthetic Ana Costa", email: "ana@example.test" })).body.id as string;
  const grant = { channel: "email", status: "granted", purpose: "newsletter", noticeVersion: "notice-v1", source: "Synthetic form", evidence: "Synthetic evidence" };
  expect((await api(page, "post", `${apiRoot}/contacts/${person}/consents`, grant)).status).toBe(201);

  const optIn = (p: Page) => p.getByRole("button", { name: /^Record opt-in for/ });
  const withdrawal = (p: Page) => p.getByRole("button", { name: /^Record withdrawal for/ });
  const recordConsent = (p: Page) => p.getByRole("button", { name: "Record consent", exact: true });

  // Owner: grant and withdraw.
  await page.goto(`${root}/crm/people/${person}`);
  await expect(withdrawal(page)).toHaveCount(1);
  await expect(optIn(page)).toHaveCount(2);
  await page.getByRole("tab", { name: "Consent history" }).click();
  await recordConsent(page).click();
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await expect(page.getByRole("option")).toHaveText(["Unknown", "Granted", "Withdrawn"]);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");

  const otherContext = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
  const other = await otherContext.newPage();
  const email = await signIn(other);

  // Admin: same as owner.
  expect((await api(page, "put", `${apiRoot}/members`, { email, role: "admin" })).status).toBe(200);
  await other.goto(`${root}/crm/people/${person}`);
  await expect(withdrawal(other)).toHaveCount(1);
  await expect(optIn(other)).toHaveCount(2);
  await other.getByRole("tab", { name: "Consent history" }).click();
  await expect(recordConsent(other)).toBeVisible();

  // Member: withdraw only.
  expect((await api(page, "put", `${apiRoot}/members`, { email, role: "member" })).status).toBe(200);
  await other.goto(`${root}/crm/people/${person}`);
  await expect(withdrawal(other)).toHaveCount(1);
  await expect(optIn(other)).toHaveCount(0);
  expect((await withdrawal(other).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (const mode of ["light", "dark"] as const) { await setMode(other, mode); await audit(other, `member-${mode}`); }
  await withdrawal(other).click();
  const dialog = other.getByRole("dialog", { name: "Record consent" });
  await expect(dialog.getByRole("combobox", { name: "Status", exact: true })).toHaveText("Withdrawn");
  await dialog.getByRole("combobox", { name: "Status", exact: true }).click();
  await expect(other.getByRole("option")).toHaveText(["Withdrawn"]);
  await other.keyboard.press("Escape");
  await dialog.getByLabel("Source").fill("Synthetic opt-out reply");
  await dialog.getByLabel("Evidence").fill("Replied STOP");
  await dialog.getByRole("button", { name: "Save consent record" }).click();
  await expect(dialog).toBeHidden();
  await other.reload();
  await expect(withdrawal(other)).toHaveCount(0);
  await expect(other.getByRole("list", { name: "Contact permissions" }).getByText("Withdrawn", { exact: true })).toBeVisible();
  await other.getByRole("tab", { name: "Consent history" }).click();
  await recordConsent(other).click();
  await other.getByRole("combobox", { name: "Status", exact: true }).click();
  await expect(other.getByRole("option")).toHaveText(["Withdrawn"]);
  await other.keyboard.press("Escape"); await other.keyboard.press("Escape");

  // Viewer: state is visible, no recording controls.
  expect((await api(page, "put", `${apiRoot}/members`, { email, role: "viewer" })).status).toBe(200);
  await other.goto(`${root}/crm/people/${person}`);
  await expect(other.getByRole("list", { name: "Contact permissions" }).getByText("Withdrawn", { exact: true })).toBeVisible();
  await expect(withdrawal(other)).toHaveCount(0);
  await expect(optIn(other)).toHaveCount(0);
  await other.getByRole("tab", { name: "Consent history" }).click();
  await expect(recordConsent(other)).toHaveCount(0);
  await expect(other.getByText("Synthetic opt-out reply", { exact: true })).toBeVisible();
  for (const mode of ["light", "dark"] as const) { await setMode(other, mode); await audit(other, `viewer-${mode}`); }
  expect((await api(other, "post", `${apiRoot}/contacts/${person}/consents`, grant)).status).toBe(403);
  await otherContext.close();
});
