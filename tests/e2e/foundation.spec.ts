import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ context }, testInfo) => {
  // Keep real server rate limits independent across journeys, retries and repeats.
  const [a, b, c] = createHash("sha256").update(`${testInfo.testId}:${testInfo.workerIndex}:${testInfo.retry}:${testInfo.repeatEachIndex}`).digest();
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${a}.${b}.${c}` });
});

test("email code → session → workspace persistence → sign out", async ({ page, context, request }, testInfo) => {
  // This journey includes multiple axe runs, responsive screenshots and cold
  // development route compilation; its complete flow exceeds the 30s default.
  test.setTimeout(90_000);
  await page.goto("/workspaces");
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await request.post("/api/workspaces", { headers: { origin: "http://127.0.0.1:3100" }, data: { name: "Unauthorized" } })).status()).toBe(401);
  expect((await request.post("/api/auth/sign-in/email", { data: { email: "test@example.test", password: "unused" } })).status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Sign in to Harvest" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("sign-in.png"), fullPage: true });
  const email = `browser-${Date.now()}@example.test`;
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  const codeField = page.getByRole("textbox", { name: "Six-digit code", exact: true });
  const slots = page.locator('[data-slot="input-otp-slot"]');
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(slots).toHaveCount(6);
  await expect(codeField).toHaveAttribute("inputmode", "numeric");
  await expect(codeField).toHaveAttribute("autocomplete", "one-time-code");
  await expect(codeField).toHaveAttribute("maxlength", "6");
  await expect(signIn).toBeDisabled();
  await page.getByText("Six-digit code", { exact: true }).click();
  await expect(codeField).toBeFocused();
  await codeField.pressSequentially("abc!");
  await expect(codeField).toHaveValue("");
  await codeField.pressSequentially("12345");
  await expect(codeField).toHaveValue("12345");
  await expect(signIn).toBeDisabled();
  await codeField.press("Backspace");
  await expect(codeField).toHaveValue("1234");
  await codeField.pressSequentially("56");
  await expect(codeField).toHaveValue("123456");
  await expect(signIn).toBeEnabled();
  // Further typing may replace the selected last slot, but cannot add slots.
  await codeField.pressSequentially("789");
  await expect(codeField).toHaveValue(/^\d{6}$/);
  await codeField.fill("");
  await expect(codeField).toHaveValue("");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("sign-in-code.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("sign-in-code-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  let code = "";
  await expect.poll(async () => {
    const lines = (await readFile(process.env.HARVEST_E2E_MAILBOX!, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    const mail = lines.map((line) => JSON.parse(line)).find((message) => message.to === email);
    code = mail?.text.match(/\b\d{6}\b/)?.[0] ?? ""; return code.length;
  }).toBe(6);
  const wrongCode = `${code[0] === "0" ? "1" : "0"}${code.slice(1)}`;
  await codeField.fill(wrongCode);
  await signIn.click();
  await expect(codeField).toHaveAttribute("aria-invalid", "true");
  await expect(codeField).toHaveAttribute("aria-describedby", /sign-in-error/);
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.locator('[data-slot="input-otp-slot"][aria-invalid="true"]')).toHaveCount(6);
  // The submit button is disabled (50% opacity) while the request runs, then fades
  // back; scan once it has settled, or axe measures a half-transparent button.
  await expect(signIn).toBeEnabled();
  await expect.poll(() => signIn.evaluate((button) => getComputedStyle(button).opacity)).toBe("1");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("sign-in-code-error.png"), fullPage: true });
  // Focus before clearing: InputOTP selects its last slot when focus returns.
  await codeField.focus();
  await codeField.fill("");
  await expect(codeField).toHaveValue("");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((value) => navigator.clipboard.writeText(value), "abc!");
  await codeField.focus();
  await codeField.press("ControlOrMeta+V");
  await expect(codeField).toHaveValue("");
  await page.evaluate((value) => navigator.clipboard.writeText(value), code);
  await codeField.press("ControlOrMeta+V");
  await expect(codeField).toHaveValue(code);
  await expect(slots).toHaveText(code.split(""));
  await signIn.click();
  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByText("You don’t have a workspace yet.", { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspaces-empty.png"), fullPage: true });
  expect((await page.request.post("/api/workspaces", { headers: { origin: "https://untrusted.example.test" }, data: { name: "Forbidden origin" } })).status()).toBe(403);
  expect((await page.request.post("/api/workspaces", { headers: { origin: "http://127.0.0.1:3100" }, data: { name: "Injected", tenantId: "client-controlled" } })).status()).toBe(400);
  await page.getByLabel("Workspace name").fill("Browser workspace");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText("Browser workspace", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Browser workspace", { exact: true })).toBeVisible();
  await expect(page.getByText("Role: owner")).toBeVisible();
  // Before hydration the form button is disabled (50% opacity) and then fades in;
  // scan once it has settled, or axe measures a half-transparent button.
  const create = page.getByRole("button", { name: "Create workspace" });
  await expect(create).toBeEnabled();
  await expect.poll(() => create.evaluate((button) => getComputedStyle(button).opacity)).toBe("1");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("workspaces-created.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("workspaces-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/workspaces"); await expect(page).toHaveURL(/\/sign-in$/);
});

test("resend cooldown keeps the code usable and change email resets the step", async ({ page }) => {
  await page.goto("/sign-in");
  const email = `browser-options-${Date.now()}@example.test`;
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  const codeField = page.getByRole("textbox", { name: "Six-digit code", exact: true });
  await expect(codeField).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveAttribute("readonly", "");
  await codeField.fill("123456");
  await page.getByRole("button", { name: "Resend code" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Please wait before requesting another code");
  await expect(codeField).toHaveValue("123456");
  await expect(codeField).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: "Change email" }).click();
  await expect(codeField).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("status")).toHaveCount(0);
  await expect(page.getByLabel("Email address")).toBeEditable();
  await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeEnabled();
});
