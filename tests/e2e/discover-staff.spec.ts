import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { discoverAdmin } from "./helpers/discover";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Harvest staff Discover review screens: neutral 404 for everyone else, reviewer and admin powers, report resolution, ministry standing and the re-sign-in prompt.
// Staff roles are granted through the privileged connection (the ops script in a real deployment); there is no UI to grant them.
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const evidence = "docs/screenshots/discover";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const sizes = [[360, 740], [768, 1024], [1280, 900]] as const;

async function audit(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    // The theme bootstrap reads the scheme when the page loads; set the same attributes it sets so dialogs stay open while the scheme changes.
    await page.evaluate((value) => { const root = document.documentElement; root.dataset.theme = value; root.classList.toggle("dark", value === "dark"); }, scheme);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations, `${name} ${width} ${scheme}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width} ${scheme} scroll`).toBe(true);
      if (width !== 768) await page.screenshot({ path: `${evidence}/${name}-${width}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.evaluate(() => { const root = document.documentElement; root.dataset.theme = "light"; root.classList.remove("dark"); });
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function person(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }), page = await context.newPage();
  return { context, page, email: await signIn(page) };
}
async function hydrated(page: Page) {
  await page.waitForFunction(() => { const control = document.querySelector("main button, main input, main select"); return !!control && Object.keys(control).some((key) => key.startsWith("__reactProps")); });
}
const lesson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Lesson" }] }] };

test("staff review queue: neutral 404, reviewer and admin powers, reports, standing and re-sign-in", async ({ page, browser }) => {
  test.setTimeout(420_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [], admin = await discoverAdmin();
  await admin.reset();
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const suffix = Date.now().toString(36), send = async (method: "post" | "put" | "patch", path: string, data: unknown) => {
    const response = await page.request[method](path, { headers: { origin }, data });
    expect(response.status(), `${method} ${path}`).toBeLessThan(300);
    return (await response.json()) as { id: string; version: number };
  };
  const listing = async (title: string, slug: string) => {
    const item = await send("post", `/api/workspaces/${tenant}/catalog`, { kind: "course", slug: `${slug}-${suffix}`, title, summary: `${title} summary.`, visibility: "listed", lessons: [{ title: "One", body: lesson, published: true }] });
    await send("put", `/api/workspaces/${tenant}/catalog/${item.id}/state`, { version: item.version, state: "published" });
    const mine = await (await page.request.get(`/api/workspaces/${tenant}/discover/listings`)).json() as { items: { id: string; version: number }[] };
    await send("patch", `/api/workspaces/${tenant}/discover/listings/course/${item.id}`, { version: mine.items.find((entry) => entry.id === item.id)?.version ?? 0, optIn: true, category: "discipleship", language: "en" });
    return item.id;
  };
  const approveMe = await listing("Foundations of Prayer", "prayer"), suspendMe = await listing("Discipleship Basics", "basics");
  await listing("Spammy Course", "spam");

  // Neutral 404: signed out, and a signed-in person who is not staff.
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } }), anon = await visitor.newPage();
  expect((await anon.goto("/platform/discover"))?.status()).toBe(404);
  await expect(anon.getByRole("heading", { name: "Discover review" })).toHaveCount(0);
  const plain = await person(browser);
  expect((await plain.page.goto("/platform/discover"))?.status()).toBe(404);
  expect((await plain.page.request.get("/api/platform/discover/queue")).status()).toBe(404);
  await plain.context.close();
  await visitor.close();

  // Reviewer.
  const reviewer = await person(browser);
  reviewer.page.on("pageerror", (error) => errors.push(error.message));
  await admin.grantStaff(reviewer.email, "reviewer");
  const r = reviewer.page;
  await r.goto("/platform/discover");
  await expect(r.getByRole("heading", { name: "Discover review", level: 1 })).toBeVisible();
  await expect(r.getByText("Signed in as reviewer")).toBeVisible();
  await expect(r.getByRole("tab", { name: /Pending/ })).toContainText("3");
  await expect(r.getByRole("table", { name: "Listings to review" }).getByRole("row", { name: /Spammy Course/ })).toContainText("In review");
  await hydrated(r);
  await audit(r, "staff-queue");
  await r.getByRole("button", { name: "Review Foundations of Prayer" }).click();
  const panel = r.getByRole("dialog");
  await expect(panel.getByText("Foundations of Prayer summary.")).toBeVisible();
  await expect(panel.getByText("Grace Community Church")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Approve" })).toBeVisible();
  // A reviewer has no Suspend and no ministry standing.
  await expect(panel.getByRole("button", { name: "Suspend", exact: true })).toHaveCount(0);
  await expect(panel.getByText("Ministry in Discover")).toHaveCount(0);
  await audit(r, "staff-drawer-reviewer");
  await panel.getByRole("button", { name: "Approve" }).click();
  await expect(r.getByRole("status").filter({ hasText: "Approved." })).toBeVisible();
  await expect(r.getByRole("tab", { name: /Pending/ })).toContainText("2");
  await expect(r.getByRole("tab", { name: /Approved/ })).toContainText("1");
  // Reject needs a reason, then a confirmation.
  await r.getByRole("button", { name: "Review Spammy Course" }).click();
  await r.getByRole("dialog").getByRole("button", { name: "Reject", exact: true }).click();
  await expect(r.getByRole("dialog").getByText("Enter a reason.")).toBeVisible();
  await r.getByLabel("Reason", { exact: true }).fill("Looks like an advertisement.");
  await r.getByRole("dialog").getByRole("button", { name: "Reject", exact: true }).click();
  const confirm = r.getByRole("alertdialog");
  await expect(confirm.getByText("Reject this listing?")).toBeVisible();
  await audit(r, "staff-confirm-reject");
  await confirm.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(r.getByRole("status").filter({ hasText: "Rejected." })).toBeVisible();
  await r.getByRole("tab", { name: /Rejected/ }).click();
  await r.getByRole("button", { name: "Review Spammy Course" }).click();
  await expect(r.getByRole("dialog").getByText("Looks like an advertisement.")).toBeVisible();
  await expect(r.getByRole("dialog").getByRole("button", { name: "Approve" })).toHaveCount(0);
  await r.keyboard.press("Escape");
  // A stale version (the owner changed it meanwhile) is explained, not applied.
  await r.getByRole("tab", { name: /Pending/ }).click();
  await r.getByRole("button", { name: "Review Discipleship Basics" }).click();
  await page.request.get(`/api/workspaces/${tenant}/discover/listings`);
  const mine = await (await page.request.get(`/api/workspaces/${tenant}/discover/listings`)).json() as { items: { id: string; version: number }[] };
  await send("patch", `/api/workspaces/${tenant}/discover/listings/course/${suspendMe}`, { version: mine.items.find((entry) => entry.id === suspendMe)!.version, language: "es" });
  await r.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(r.getByRole("dialog").getByRole("alert")).toContainText("This listing changed. Refresh and review it again.");
  await r.keyboard.press("Escape");
  await r.getByRole("button", { name: "Refresh" }).click();
  // Reports: the member flags the approved course; the reviewer resolves it.
  const member = await person(browser);
  expect((await member.page.request.post("/api/discover/reports", { headers: { origin }, data: { type: "course", id: approveMe, reason: "misleading", note: "Not what it says." } })).status()).toBe(201);
  await member.context.close();
  await r.getByRole("button", { name: "Refresh" }).click();
  await expect(r.getByRole("tab", { name: /Reports/ })).toContainText("1");
  await r.getByRole("tab", { name: /Reports/ }).click();
  await expect(r.getByRole("table", { name: "Open reports" }).getByRole("row", { name: /Foundations of Prayer/ })).toContainText("Misleading");
  await hydrated(r);
  await audit(r, "staff-reports");
  await r.getByRole("button", { name: "Review Foundations of Prayer" }).click();
  await expect(r.getByRole("dialog").getByText("Not what it says.")).toBeVisible();
  await audit(r, "staff-report-drawer");
  await r.getByRole("dialog").getByRole("button", { name: "Mark reviewed" }).click();
  await expect(r.getByRole("status").filter({ hasText: "Report resolved." })).toBeVisible();
  await expect(r.getByRole("tab", { name: /Reports/ })).toContainText("0");
  await expect(r.getByText("No open reports.")).toBeVisible();
  await audit(r, "staff-reports-empty");

  // Re-sign-in: a sign-in older than 15 minutes still opens the page and the screen asks for a new one.
  await admin.ageSessions(reviewer.email, 30);
  await r.reload();
  await expect(r.getByRole("alert").filter({ hasText: "Sign in again" })).toBeVisible();
  await expect(r.getByRole("table")).toHaveCount(0);
  await audit(r, "staff-reauth");
  await r.getByRole("button", { name: "Sign in again" }).click();
  await expect(r).toHaveURL(/\/sign-in\?next=%2Fplatform%2Fdiscover/);
  await reviewer.context.close();

  // Admin: suspend, reinstate and ministry standing.
  const boss = await person(browser);
  boss.page.on("pageerror", (error) => errors.push(error.message));
  await admin.grantStaff(boss.email, "admin");
  const a = boss.page;
  await a.goto("/platform/discover");
  await expect(a.getByText("Signed in as admin")).toBeVisible();
  await a.getByRole("tab", { name: /Approved/ }).click();
  await hydrated(a);
  await a.getByRole("button", { name: "Review Foundations of Prayer" }).click();
  await expect(a.getByText("Ministry in Discover")).toBeVisible();
  await a.getByLabel("Reason", { exact: true }).first().fill("Policy breach.");
  await a.getByRole("dialog").getByRole("button", { name: "Suspend", exact: true }).click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(a.getByRole("status").filter({ hasText: "Suspended." })).toBeVisible();
  await a.getByRole("tab", { name: /Suspended/ }).click();
  await a.getByRole("button", { name: "Review Foundations of Prayer" }).click();
  await expect(a.getByRole("dialog").getByText("Policy breach.")).toBeVisible();
  await audit(a, "staff-drawer-admin-suspended");
  await a.getByRole("dialog").getByRole("button", { name: "Reinstate" }).click();
  await expect(a.getByRole("status").filter({ hasText: "Reinstated." })).toBeVisible();
  await a.getByRole("tab", { name: /Approved/ }).click();
  await expect(a.getByRole("button", { name: "Review Foundations of Prayer" })).toBeVisible();
  // Ministry standing hides every listing of the ministry, and restoring brings them back.
  const publicPage = await browser.newPage();
  await publicPage.goto("/discover");
  await expect(publicPage.getByRole("heading", { name: "Foundations of Prayer", level: 3 })).toBeVisible();
  await a.getByRole("button", { name: "Review Foundations of Prayer" }).click();
  await a.getByLabel("Reason", { exact: true }).last().fill("Under investigation.");
  await a.getByRole("dialog").getByRole("button", { name: "Suspend ministry" }).click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Suspend ministry" }).click();
  await expect(a.getByRole("status").filter({ hasText: "Ministry suspended in Discover." })).toBeVisible();
  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { name: "Foundations of Prayer", level: 3 })).toHaveCount(0);
  await a.getByRole("button", { name: "Review Foundations of Prayer" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Restore ministry" }).click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Confirm" }).click();
  await expect(a.getByRole("status").filter({ hasText: "Ministry restored in Discover." })).toBeVisible();
  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { name: "Foundations of Prayer", level: 3 })).toBeVisible();
  await publicPage.close();
  await boss.context.close();
  await admin.end();
  expect(errors).toEqual([]);
});
