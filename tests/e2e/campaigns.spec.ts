import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";

test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
const evidence = "docs/screenshots/cw01";
async function capture(page: Page, name: string) {
  await expectFullWidthShell(page);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}

async function expectTouchTarget(link: Locator) {
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  return { label: await link.innerText(), width: box!.width, height: box!.height };
}

test("CW-01: mobile shell Tab reaches every navigation link and campaign targets are at least 44px", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const workspace = await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Mobile campaign checks" } });
  expect(workspace.status()).toBe(201);
  const root = `/workspaces/${(await workspace.json()).tenantId}/campaigns`;
  let campaignId = "";
  for (let index = 0; index < 21; index++) {
    const created = await page.request.post(`/api${root}`, { headers: { origin, "Idempotency-Key": `mobile-${index}` }, data: { name: `Mobile draft ${index}`, type: "conference" } });
    expect(created.status()).toBe(201);
    campaignId = (await created.json()).id;
  }
  for (const width of [320, 375]) {
    const measurements = [];
    await page.setViewportSize({ width, height: 844 });
    await page.goto(root);
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const sheet = page.getByRole("dialog", { name: "Sidebar", exact: true });
    await expect(sheet).toBeVisible();
    const navigation = sheet.getByRole("navigation", { name: "Workspace navigation" });
    const links = navigation.getByRole("link");
    // Workspace entry plus all CRM, Workspace and Settings links.
    await expect(links).toHaveCount(10);
    const expected = new Set(await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))));
    await sheet.getByRole("link", { name: "Harvest", exact: true }).focus();
    for (let tab = 0; tab < 30 && expected.size; tab++) {
      await page.keyboard.press("Tab");
      const href = await navigation.evaluate((nav) => nav.contains(document.activeElement) ? document.activeElement?.getAttribute("href") : null);
      if (href === root) await expect(navigation.getByRole("link", { name: "Campaigns", exact: true })).toBeFocused();
      if (href) expected.delete(href);
    }
    expect([...expected], `unreachable navigation links at ${width}px`).toEqual([]);
    for (const link of await links.all()) measurements.push(await expectTouchTarget(link));
    await page.screenshot({ path: `${evidence}/mobile-sidebar-${width}.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    measurements.push(await expectTouchTarget(page.getByRole("link", { name: "Next", exact: true })));
    await page.getByRole("link", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(`${origin}${root}?page=2`);
    measurements.push(await expectTouchTarget(page.getByRole("link", { name: "Previous", exact: true })));
    await page.getByRole("link", { name: "Previous", exact: true }).click();
    await expect(page).toHaveURL(`${origin}${root}?page=1`);
    await expectFullWidthShell(page);
    await page.goto(`${root}/${campaignId}`);
    measurements.push(await expectTouchTarget(page.getByRole("link", { name: "Back to campaigns", exact: true })));
    await expectFullWidthShell(page);
    console.log(`CW-01 ${width}px touch targets: ${JSON.stringify(measurements)}`);
  }
});

test("CW-01: private list, API create, draft dashboard and two-tenant denials", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mkdir(evidence, { recursive: true });
  const fakeTenant = randomUUID(), fakeCampaign = randomUUID();
  expect((await page.request.get(`/api/workspaces/${fakeTenant}/campaigns`)).status()).toBe(401);
  expect((await page.request.get(`/api/workspaces/${fakeTenant}/campaigns/${fakeCampaign}`)).status()).toBe(401);
  expect((await page.request.post(`/api/workspaces/${fakeTenant}/campaigns`, { headers: { origin, "Idempotency-Key": "signed-out" }, data: { name: "Denied", type: "conference" } })).status()).toBe(401);
  await page.goto(`/workspaces/${fakeTenant}/campaigns`);
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page);
  const workspace = await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Harvest CW-01 workspace" } });
  expect(workspace.status()).toBe(201);
  const tenantId = (await workspace.json()).tenantId as string;
  const root = `/workspaces/${tenantId}/campaigns`, api = `/api${root}`;
  await page.goto(`/workspaces/${tenantId}/crm/people`);
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Campaigns", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No campaigns yet" })).toBeVisible();
  await capture(page, "empty-desktop");
  const data = { name: "Synthetic Bangkok Outreach 2027", type: "evangelistic_crusade", description: "A shared plan for our local outreach team.", mission: "Serve the city together.", country: "Thailand", cityRegion: "Bangkok", startDate: "2027-02-01", endDate: "2027-02-05", timeZone: "Asia/Bangkok", structure: "single" };
  const headers = { origin, "Idempotency-Key": "cw01-browser-create" };
  expect((await page.request.post(api, { headers: { origin }, data })).status()).toBe(400);
  expect((await page.request.post(api, { headers: { ...headers, origin: "https://untrusted.example" }, data })).status()).toBe(403);
  expect((await page.request.post(api, { headers, data: { ...data, status: "active" } })).status()).toBe(400);
  const created = await page.request.post(api, { headers, data });
  expect(created.status()).toBe(201);
  const campaign = await created.json();
  expect(campaign.status).toBe("draft"); expect(campaign.tenantId).toBe(tenantId);
  expect(campaign).not.toHaveProperty("fingerprint"); expect(campaign).not.toHaveProperty("idempotencyKey");
  expect((await (await page.request.post(api, { headers, data })).json()).id).toBe(campaign.id);
  expect((await page.request.post(api, { headers, data: { ...data, name: "Changed" } })).status()).toBe(409);
  const list = await page.request.get(api);
  expect(list.headers()["cache-control"]).toBe("private, no-store");
  expect((await list.json()).campaigns).toHaveLength(1);
  expect((await page.request.get(`${api}?page=0`)).status()).toBe(400);
  await page.reload();
  await expect(page.getByRole("list", { name: "Campaigns", exact: true }).getByRole("link")).toHaveCount(1);
  await capture(page, "list-desktop");
  await page.getByRole("link", { name: /Synthetic Bangkok Outreach/ }).click();
  await expect(page).toHaveURL(`${origin}${root}/${campaign.id}`);
  await expect(page.getByRole("heading", { name: data.name })).toBeVisible();
  await expect(page.getByText("This campaign is a private, unpublished draft.")).toBeVisible();
  await expect(page.getByText("Asia/Bangkok", { exact: true })).toBeVisible();
  await expect(page.getByText("You", { exact: true })).toBeVisible();
  await capture(page, "dashboard-desktop");
  expect((await new AxeBuilder({ page }).include("#main-content").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: data.name })).toBeVisible();
  await capture(page, "dashboard-mobile");
  await page.getByRole("link", { name: "Back to campaigns" }).click();
  await expect(page.getByRole("heading", { name: "Campaigns", exact: true })).toBeVisible();
  await capture(page, "list-mobile");

  const otherContext = await browser.newContext(), other = await otherContext.newPage();
  try {
    const email = await signIn(other);
    const own = await other.request.post("/api/workspaces", { headers: { origin }, data: { name: "CW-01 other workspace" } });
    const otherTenant = (await own.json()).tenantId as string, otherApi = `/api/workspaces/${otherTenant}/campaigns`;
    const second = await other.request.post(otherApi, { headers, data: { name: "Other private campaign", type: "conference" } });
    expect(second.status()).toBe(201);
    const otherCampaign = (await second.json()).id as string;
    for (const [client, ownApi, foreignApi, foreignId] of [[page, api, otherApi, otherCampaign], [other, otherApi, api, campaign.id]] as const) {
      expect((await client.request.get(foreignApi)).status()).toBe(403);
      expect((await client.request.post(foreignApi, { headers, data })).status()).toBe(403);
      expect((await client.request.get(`${ownApi}/${foreignId}`)).status()).toBe(404);
      expect((await client.request.get(`${foreignApi}/${foreignId}`)).status()).toBe(403);
      expect((await (await client.request.get(ownApi)).json()).campaigns).toHaveLength(1);
    }
    await other.goto(`${root}/${campaign.id}`);
    await expect(other.getByRole("heading", { name: data.name })).toHaveCount(0);
    expect((await page.request.put(`/api/workspaces/${tenantId}/members`, { headers: { origin }, data: { email, role: "viewer" } })).status()).toBe(200);
    expect((await other.request.get(api)).status()).toBe(200);
    expect((await other.request.post(api, { headers, data })).status()).toBe(403);
    await other.goto(`${root}/${campaign.id}`);
    await expect(other.getByRole("heading", { name: data.name })).toBeVisible();
    expect((await page.request.patch(`${api}/${campaign.id}`, { headers: { origin }, data: { status: "active" } })).status()).toBe(405);
  } finally { await otherContext.close(); }
  expect(errors).toEqual([]);
});
