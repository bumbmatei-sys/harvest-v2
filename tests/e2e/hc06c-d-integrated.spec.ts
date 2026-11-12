import { readFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// HC-06C+D integrated acceptance: a verified Connect claim creates a contact with a Connect source,
// source rules narrow list = count = export identically, consent filters are split by channel, and the
// finished claim leaves no flow cookie behind. Synthetic data and the local mock mailbox only.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/hc06c-d";
const sizes = [["phone", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;

async function check(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function shoot(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.waitForFunction(s => { const t = document.documentElement.dataset.theme; return !t || t === s; }, scheme);
    await page.waitForTimeout(300);
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await check(page);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("HC-06C+D: Connect claim, source rules, channel consent filters and a cleared claim cookie", async ({ page, browser }) => {
  test.setTimeout(420000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name: "Synthetic source filter QA" } })).json()).tenantId;
  const root = `/workspaces/${tenant}`, api = `/api${root}`;
  const campaign = (await (await page.request.post(`${api}/campaigns`, { headers: { origin, "Idempotency-Key": randomUUID() }, data: { name: "Autumn welcome", type: "conference" } })).json()).id;
  const connect = `${api}/campaigns/${campaign}/connect`;
  const form = await page.request.post(`${connect}/forms`, { headers: { origin }, data: { name: "Autumn request", notice: "Synthetic choices", retentionDays: 1, purposes: ["account_communications", "newsletter"], definition: { kind: "connect-intake-v3", syntheticOnly: true, preferredName: true, followUpChannel: "email" } } });
  expect(form.status()).toBe(201);
  const link = await (await page.request.post(`${connect}/links`, { headers: { origin }, data: { label: "Front desk", formVersionId: (await form.json()).id } })).json();
  expect((await page.request.post(`${connect}/links/${link.id}/actions`, { headers: { origin }, data: { action: "publish" } })).status()).toBe(200);
  expect((await page.request.post(`${api}/contacts`, { headers: { origin }, data: { name: "Synthetic Manual Person", email: "manual@example.test" } })).status()).toBe(201);

  // A visitor claims through the real flow; the organizer never approves anything.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    const visitor = await context.newPage(), email = await signIn(visitor);
    await visitor.goto(`/s/${link.shortCode}`);
    await visitor.getByRole("checkbox", { name: "Send me an invitation to a personal Harvest account", exact: true }).check();
    await visitor.getByLabel("Email", { exact: true }).fill(email);
    await visitor.getByLabel("Preferred name (optional)", { exact: true }).fill("Synthetic Connect Person");
    await visitor.getByRole("button", { name: "Save test request", exact: true }).click();
    await expect(visitor.getByRole("heading", { name: "Test request saved", exact: true })).toBeVisible();
    const config = JSON.parse(await readFile(`${process.env.HARVEST_E2E_MAILBOX}.connect-worker`, "utf8"));
    await promisify(execFile)(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/drain-connect-invitations.ts"], { env: { ...process.env, ...config, NODE_ENV: "test", HARVEST_CONNECT_INTAKE: "synthetic", HARVEST_CONNECT_TEST_MAILBOX: process.env.HARVEST_E2E_MAILBOX, BETTER_AUTH_URL: origin }, timeout: 20000 });
    const mail = (await readFile(process.env.HARVEST_E2E_MAILBOX!, "utf8")).trim().split("\n").map((line) => JSON.parse(line)).find((item) => item.to === email && item.idempotencyKey);
    const url = mail.text.match(/http:\/\/127\.0\.0\.1:3100\/connect\/claim#token=[a-f0-9]{64}/)[0];
    await visitor.goto(url);
    await visitor.getByRole("button", { name: "Continue securely", exact: true }).click();
    await expect(visitor.getByRole("button", { name: "Confirm this request for my account", exact: true })).toBeVisible();
    expect((await context.cookies()).some((cookie) => cookie.name === "harvest_connect_flow")).toBe(true);
    await visitor.getByRole("button", { name: "Confirm this request for my account", exact: true }).click();
    await visitor.getByRole("button", { name: "Skip for now", exact: true }).click();
    await expect(visitor.getByRole("heading", { name: "Welcome to Harvest", exact: true })).toBeVisible();
    // HC-06D: the finished flow leaves no cookie, and a repeat finds nothing to act on.
    expect((await context.cookies()).some((cookie) => cookie.name === "harvest_connect_flow")).toBe(false);
    expect((await visitor.request.post("/api/connect/invitations/claim", { headers: { origin }, data: { action: "confirm" } })).status()).toBe(409);
  } finally { await context.close(); }

  // Source rule through the icon-only Filters popover.
  await page.goto(`${root}/crm/people`);
  const grid = page.getByRole("grid", { name: "People", exact: true });
  const trigger = page.getByRole("button", { name: "Filters", exact: true });
  const panel = page.getByRole("dialog", { name: "Filters", exact: true });
  await expect(grid.getByRole("row")).toHaveCount(3);
  await trigger.click();
  await expect(panel.getByRole("option", { name: /^Follow-up email/ })).toBeVisible();
  await expect(panel.getByRole("option", { name: /^Follow-up SMS/ })).toBeVisible();
  await expect(panel.getByText("Advanced filters")).toHaveCount(0);
  await panel.getByRole("option", { name: /^Source rule\s*Rule$/ }).click();
  await panel.getByRole("checkbox", { name: "Connect", exact: true }).click();
  await expect(panel.getByRole("group", { name: "Campaigns" })).toBeVisible();
  await panel.getByRole("checkbox", { name: "Autumn welcome", exact: true }).click();
  await shoot(page, "source-rule-editor");
  await panel.getByRole("button", { name: "Add rule", exact: true }).click();
  await expect(panel.getByRole("list", { name: "Source" })).toContainText("Autumn welcome");
  await panel.getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(page).toHaveURL(/[?&]s=include/);
  await expect(grid.getByRole("row")).toHaveCount(2);
  await expect(grid).toContainText("Synthetic Connect Person");
  await expect(grid).not.toContainText("Synthetic Manual Person");
  await shoot(page, "source-filtered-list");

  // The same predicate drives the export count and the file, with a Sources column only when shown.
  const included = new URL(page.url()).searchParams;
  included.set("entity", "person");
  const count = await (await page.request.get(`${api}/crm/export/count?${included}`)).json();
  expect(count.total).toBe(1);
  expect(count.sources).toBe(false);
  const withSource = new URLSearchParams(included);
  withSource.set("cols", "email,source");
  expect((await (await page.request.get(`${api}/crm/export/count?${withSource}`)).json()).sources).toBe(true);
  const csv = await (await page.request.get(`${api}/crm/export?${withSource}`)).text();
  expect(csv.split("\n")[0]).toContain("Sources");
  expect(csv).toContain("Synthetic Connect Person");
  expect(csv).not.toContain("Synthetic Manual Person");

  // Exclude is the complement within this Organization.
  await page.goto(`${root}/crm/people?s=${encodeURIComponent("exclude~any~connect~~~~~~")}`);
  await expect(grid.getByRole("row")).toHaveCount(2);
  await expect(grid).toContainText("Synthetic Manual Person");
  // A reference that no longer exists shows an empty, locked list rather than everyone.
  await page.goto(`${root}/crm/people?s=${encodeURIComponent(`include~any~connect~${randomUUID()}~~~~~`)}`);
  // Scope to main: the router's live announcer can also hold an alert on slower runners.
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByText("Synthetic Manual Person")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  await shoot(page, "source-invalid-notice");

  // Channel-specific follow-up permission filters.
  await page.goto(`${root}/crm/people?f=${encodeURIComponent("followup_sms~is_empty~")}`);
  await expect(grid.getByRole("row")).toHaveCount(3);
  await trigger.click();
  await panel.getByRole("option", { name: /^Follow-up SMS/ }).click();
  await shoot(page, "consent-filter-editor");
  expect(errors).toEqual([]);
});
