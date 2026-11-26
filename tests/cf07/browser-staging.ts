import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, type Page, type Response } from "playwright";
import { checkForLeaks } from "../cf03/leak-scan";

// CF-07e browser smoke of the staging Worker in a real Chromium: sign-in page, OTP sign-in through the form with the
// synthetic mailbox helper, the ministries page, one module page (CRM people), light and dark, and phone width.
// The local Playwright suite cannot point at staging (it starts its own server and seeds the local database), so this
// is a separate script. Skips by default and in CI; refuses any origin other than a harvest-staging workers.dev host.
// The operator injects origins and tokens; nothing here prints them. Optional CF07_SCREENSHOTS=<dir> saves screenshots.
if (process.env.CI || process.env.CF07_RUN_STAGING !== "1") {
  console.log("SKIP CF-07 staging browser smoke");
} else {
  const origin = new URL(process.env.CF07_STAGING_ORIGIN ?? "").origin;
  const harness = new URL(process.env.CF07_HARNESS_ORIGIN ?? "").origin;
  const token = process.env.CF07_HARNESS_TOKEN ?? "";
  const needles = (process.env.CF07_NEEDLES ?? "").split(",").filter((value) => value.length >= 16);
  const stagingHost = /^https:\/\/harvest-staging(?:-[a-z0-9]+)?\.[a-z0-9-]+\.workers\.dev$/;
  if (!stagingHost.test(origin) || !stagingHost.test(harness) || origin === harness || token.length < 32 || needles.length < 3) {
    throw new Error("Set CF07_STAGING_ORIGIN and CF07_HARNESS_ORIGIN to harvest-staging workers.dev origins, CF07_HARNESS_TOKEN and CF07_NEEDLES");
  }
  needles.push(token);
  const shots = process.env.CF07_SCREENSHOTS;
  if (shots) await mkdir(shots, { recursive: true });
  const passed: string[] = [];
  let step = "setup";
  const seed = async <T>(path: string, body: object) => {
    const response = await fetch(new URL(path, harness), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, `${step}: harness ${path} failed`);
    return await response.json() as T;
  };
  // Chromium does not read the proxy environment by itself; an operator behind an egress proxy needs it passed through.
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, proxy });
  const pageErrors: string[] = [];
  const check = async (page: Page, response: Response | null, name: string) => {
    assert.ok(response, `${name}: no response`);
    assert.equal(response.status(), 200, `${name}: status`);
    assert.equal(response.headers()["cache-control"], "private, no-store", `${name}: cache-control`);
    assert.ok(!["HIT", "STALE", "REVALIDATED", "UPDATING"].includes(response.headers()["cf-cache-status"] ?? ""), `${name}: edge cache hit`);
    await page.waitForLoadState("networkidle");
    checkForLeaks(`${name} page`, await page.content(), needles);
    assert.equal(await page.getByText("Couldn't load this page", { exact: false }).count(), 0, `${name}: error boundary shown`);
  };
  const noSideScroll = async (page: Page, name: string) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${name}: ${overflow}px horizontal scroll at phone width`);
  };
  const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.name));

    step = "sign-in page";
    await check(page, await page.goto(`${origin}/sign-in`), step);
    await page.getByRole("heading", { name: "Sign in to Harvest" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    await shot(page, "sign-in-light");
    passed.push(step);

    step = "OTP sign-in through the form";
    const email = `${randomUUID()}@example.invalid`;
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await page.getByRole("status").waitFor();
    const { code } = await seed<{ code: string | null }>("/code", { to: email });
    assert.ok(code, "synthetic mailbox received one code");
    await page.getByLabel("Six-digit code").pressSequentially(code);
    await Promise.all([page.waitForURL(`${origin}/workspaces`), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
    const session = await (await page.request.get(`${origin}/api/auth/get-session`)).json() as { user: { id: string; email: string } };
    assert.equal(session.user.email, email);
    passed.push(step);

    step = "ministries page";
    const ministry = `Smoke ministry ${randomUUID().slice(0, 8)}`;
    const { tenantId } = await seed<{ tenantId: string }>("/workspace", { user: session.user.id, name: ministry });
    await check(page, await page.goto(`${origin}/workspaces`), step);
    await page.getByText(ministry).first().waitFor();
    await shot(page, "ministries-light");
    passed.push(step);

    step = "module page (CRM people)";
    await check(page, await page.goto(`${origin}/workspaces/${tenantId}/crm/people`), step);
    await page.getByRole("heading").first().waitFor();
    await shot(page, "crm-people-light");
    passed.push(step);

    step = "dark mode";
    await page.emulateMedia({ colorScheme: "dark" });
    await check(page, await page.reload(), step);
    const dark = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, hasClass: document.documentElement.classList.contains("dark"), bg: getComputedStyle(document.body).backgroundColor }));
    assert.equal(dark.theme, "dark");
    assert.ok(dark.hasClass, "html has the dark class");
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    await page.waitForLoadState("networkidle");
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.notEqual(dark.bg, lightBg, "dark and light backgrounds differ");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await shot(page, "crm-people-dark");
    passed.push(step);

    step = "phone width";
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await context.storageState() });
    const mobile = await phone.newPage();
    mobile.on("pageerror", (error) => pageErrors.push(error.name));
    for (const [name, path] of [["sign-in", "/sign-in"], ["ministries", "/workspaces"], ["crm-people", `/workspaces/${tenantId}/crm/people`]] as const) {
      await check(mobile, await mobile.goto(`${origin}${path}`), `${step} ${name}`);
      await noSideScroll(mobile, `${step} ${name}`);
      await shot(mobile, `${name}-phone`);
    }
    passed.push(step);

    step = "signed out";
    const anonymous = await browser.newContext();
    const signedOut = await anonymous.newPage();
    await signedOut.goto(`${origin}/workspaces/${tenantId}/crm/people`);
    assert.ok(new URL(signedOut.url()).pathname === "/sign-in", "signed-out module page lands on sign-in");
    passed.push(step);

    assert.deepEqual(pageErrors, [], "no uncaught page errors");
    console.log(`PASS CF-07 staging browser smoke (${passed.length} steps): ${passed.join(", ")}; no uncaught page errors`);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message.split("\n")[0]}` : "";
    checkForLeaks("failure message", detail, needles);
    console.error(`CF-07 staging browser smoke failed during ${step}${detail}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
