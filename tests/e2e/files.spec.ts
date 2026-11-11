import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const origin = "http://127.0.0.1:3100";
async function signIn(page: Page, email: string) {
  // Authenticate through the real OTP API; the foundation spec covers login UI.
  // This also avoids clicking an unhydrated sign-in form in a fresh context.
  const sent = await page.request.post(`${origin}/api/auth/email-otp/send-verification-otp`, {
    headers: { origin }, data: { email, type: "sign-in" },
  });
  expect(sent.status()).toBe(200);
  let code = "";
  await expect.poll(async () => {
    const lines = (await readFile(process.env.HARVEST_E2E_MAILBOX!, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    const mail = lines.map((line) => JSON.parse(line)).find((message) => message.to === email);
    code = mail?.text.match(/\b\d{6}\b/)?.[0] ?? ""; return code.length;
  }).toBe(6);
  const signedIn = await page.request.post(`${origin}/api/auth/sign-in/email-otp`, { headers: { origin }, data: { email, otp: code } });
  expect(signedIn.status()).toBe(200);
  await page.goto(`${origin}/workspaces`);
  await expect(page).toHaveURL(/\/workspaces$/);
}
test("workspace upload → progress → verified file → private download; public quarantine and isolation", async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const capture = (name: string) => page.screenshot({ path: `docs/screenshots/pr02/${name}.png`, fullPage: true,
    style: "nextjs-portal { visibility: hidden !important; }",
  });
  await mkdir("docs/screenshots/pr02", { recursive: true });
  await signIn(page, `files-${randomUUID()}@example.test`);
  await page.getByLabel("Workspace name").fill("Harvest files workspace");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "Files", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Workspace files" })).toBeVisible({ timeout: 30_000 });
  const tenantId = page.url().match(/workspaces\/([^/]+)/)![1];
  const base = `/api/workspaces/${tenantId}/files`;
  await expect(page.getByText("No files yet.", { exact: false })).toBeVisible();
  await capture("01-empty");
  const payload = Buffer.from("Harvest files browser upload\n".repeat(10_000));
  const metadata = { name: "workspace-notes.txt", mime: "text/plain", size: payload.length, checksum: createHash("sha256").update(payload).digest("hex") };
  const unknownFile = randomUUID();
  for (const [method, url] of [["GET", base], ["POST", base], ["POST", `${base}/${unknownFile}/confirm`], ["GET", `${base}/${unknownFile}/download`]]) {
    expect((await request.fetch(url, { method, headers: { origin }, ...(method === "POST" ? { data: metadata } : {}) })).status()).toBe(401);
  }
  for (const url of [base, `${base}/${unknownFile}/confirm`]) {
    expect((await page.request.post(url, { headers: { origin: "https://untrusted.example.test" }, data: metadata })).status()).toBe(403);
  }
  for (const change of [{ mime: "text/html" }, { size: 10 * 1024 * 1024 + 1 }, { key: "injected" }, { ownerId: "injected" }, { status: "ready" }]) {
    expect((await page.request.post(base, { headers: { origin }, data: { ...metadata, ...change } })).status()).toBe(400);
  }
  let releaseConfirm!: () => void;
  const holdConfirm = new Promise<void>((resolve) => { releaseConfirm = resolve; });
  await page.route("**/files/*/confirm", async (route) => { await holdConfirm; await route.continue(); }, { times: 1 });
  await page.getByLabel("Choose file").setInputFiles({ name: metadata.name, mimeType: metadata.mime, buffer: payload });
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Upload progress" })).toHaveAttribute("aria-valuenow", "100");
  await capture("02-progress");
  releaseConfirm();
  await expect(page.getByRole("status").filter({ hasText: "File uploaded and ready." })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: metadata.name });
  await expect(row.getByText("ready", { exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: /Public link/ })).toHaveCount(0);
  await page.reload();
  await expect(row.getByText("ready", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await capture("03-ready");
  const downloadPromise = page.waitForEvent("download");
  await row.getByRole("button", { name: `Download ${metadata.name}` }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(metadata.name);
  expect(await readFile((await download.path())!)).toEqual(payload);
  const fileId = (await (await page.request.get(base)).json())[0].id;
  expect((await request.get(`${base}/${fileId}/download`)).status()).toBe(401);
  expect((await request.get(`/api/files/public/${tenantId}/${fileId}`)).status()).toBe(404);
  await page.getByLabel("Visibility", { exact: true }).selectOption("public");
  await page.getByLabel("Choose file").setInputFiles({ name: "public-notes.txt", mimeType: "text/plain", buffer: Buffer.from("awaiting malware check") });
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  const publicRow = page.getByRole("row").filter({ hasText: "public-notes.txt" });
  await expect(publicRow.getByText("quarantined", { exact: true })).toBeVisible();
  await expect(publicRow.getByRole("button", { name: /Download/ })).toHaveCount(0);
  await expect(publicRow.getByRole("link", { name: /Public link/ })).toHaveCount(0);
  await capture("04-quarantined");
  const publicFile = (await (await page.request.get(base)).json()).find((file: { name: string }) => file.name === "public-notes.txt");
  expect((await request.get(`/api/files/public/${tenantId}/${publicFile.id}`)).status()).toBe(404);
  await page.getByLabel("Choose file").setInputFiles({ name: "unsafe.html", mimeType: "text/html", buffer: Buffer.from("<script>bad()</script>") });
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Choose a JPEG" })).toBeVisible();
  await capture("05-validation");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await capture("06-mobile");
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage, `files-other-${randomUUID()}@example.test`);
    const foreignWorkspace = await otherPage.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name: "Other workspace" } });
    expect(foreignWorkspace.status()).toBe(201);
    const foreignTenant = (await foreignWorkspace.json()).tenantId;
    expect((await otherPage.request.get(base)).status()).toBe(403);
    expect((await otherPage.request.post(base, { headers: { origin }, data: metadata })).status()).toBe(403);
    expect((await otherPage.request.post(`${base}/${fileId}/confirm`, { headers: { origin } })).status()).toBe(403);
    expect((await otherPage.request.get(`${base}/${fileId}/download`)).status()).toBe(403);
    expect((await page.request.get(`/api/workspaces/${foreignTenant}/files/${fileId}/download`)).status()).toBe(403);
    const foreignPage = await otherPage.goto(`/workspaces/${tenantId}/files`);
    expect(foreignPage?.status()).toBe(404);
    await expect(otherPage.getByText(metadata.name)).toHaveCount(0);
  } finally { await other.close(); }
  expect(errors).toEqual([]);
});
