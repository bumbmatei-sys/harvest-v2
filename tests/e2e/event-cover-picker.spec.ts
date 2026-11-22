import { mkdir, readFile } from "node:fs/promises";
import { deflateSync, crc32 } from "node:zlib";
import { createHash } from "node:crypto";
import { expect as base, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Event cover picker on the owner event form: choose and upload, progress, scan state, replace, remove, every error state, the signed picture,
// roles, keyboard, axe (WCAG 2.2 AA) and no sideways scroll at 360, 768 and 1280 in both colour schemes. Synthetic data and the loopback storage mock only.
const expect = base.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const shots = process.env.COVER_SHOTS ?? "/tmp/event-cover-shots";

/** A real 16:9 PNG (gradient), so the picture decodes in the browser; `seed` makes the bytes differ between files. */
function png(seed: number, width = 320, height = 180) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (width * 3 + 1) + 1 + x * 3;
    raw[at] = (x * 255 / width + seed * 40) & 255; raw[at + 1] = y * 255 / height; raw[at + 2] = 120 + seed * 30 & 255;
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const file = (name: string, seed: number) => ({ name, mimeType: "image/png", buffer: png(seed) });

async function audit(page: Page, name: string) {
  const session = await page.context().newCDPSession(page);
  for (const scheme of ["light", "dark"] as const) for (const [width, height, scale] of [[1280, 900, 1], [768, 900, 1], [360, 800, 2]] as const) {
    if (width === 1280) { await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", scheme); }
    await page.setViewportSize({ width, height });
    await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    await expect(page.getByTestId("cover-zone")).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await settleForAxe(page);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} ${scheme} ${width} overflow`).toBe(true);
    await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true, animations: "disabled" });
  }
  await session.send("Emulation.clearDeviceMetricsOverride");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 900 });
}
/** 44px tap targets at phone width. */
async function tall(page: Page, selector: string, min = 44) {
  await page.setViewportSize({ width: 390, height: 800 });
  const items = await page.locator(selector).all(); expect(items.length).toBeGreaterThan(0);
  for (const item of items) { if (!(await item.isVisible())) continue; const box = await item.boundingBox(); if (box) expect(box.height, await item.innerText().catch(() => "")).toBeGreaterThanOrEqual(min - 0.5); }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("event cover picker: upload, progress, scan state, replace, remove, errors, signed picture, keyboard and layout", async ({ page }) => {
  test.setTimeout(600_000);
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name: "Grace Owner", locale: null, cityRegion: null } })).ok()).toBe(true);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  /** Outside production a skipped scan releases the image at once; to see the other states the next confirm answer is replaced (the real confirm still runs on Check again). */
  const confirmOnce = (status: "uploaded" | "quarantined") => page.route("**/cover/uploads/*/confirm", (route) => route.fulfill({ json: { id: "x", name: "c.png", mime: "image/png", size: 1, status, kind: "cover" } }), { times: 1 });
  const id = crypto.randomUUID(), api = `/api/workspaces/${tenant}/events/${id}`, start = Date.now() + 3 * 86_400_000;
  expect((await page.request.put(api, { headers: { origin }, data: { version: 0, title: "Sunday gathering", description: "", timeZone: "UTC", startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3_600_000).toISOString(), capacity: null, reminderMinutes: null, joinUrl: null } })).ok()).toBe(true);
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/cover/uploads")) requests.push(request.method() + " " + request.url()); });
  const zone = page.getByTestId("cover-zone"), input = page.getByTestId("cover-input"), image = page.getByTestId("cover-image");
  const isStorage = (url: URL) => url.pathname.startsWith("/harvest-files-test/");
  const storagePut = (handler: (route: Route) => Promise<void> | void) => page.route(isStorage, async (route) => route.request().method() === "PUT" ? handler(route) : route.fallback());

  try {
    await test.step("a new, unsaved event offers no upload", async () => {
      await page.goto(`/workspaces/${tenant}/events/new`);
      await expect(zone.getByText("Save the event to add a cover.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Select image" })).toHaveCount(0);
      await expect(input).toBeDisabled();
    });

    await page.goto(`/workspaces/${tenant}/events/${id}`);
    await test.step("an event without a cover shows the empty zone", async () => {
      await expect(page.getByText("Cover image", { exact: true })).toBeVisible();
      await expect(zone.getByText("Drop an image here")).toBeVisible();
      await expect(zone.getByText("JPG, PNG or WebP, up to 10 MB")).toBeVisible();
      await expect(page.getByRole("button", { name: "Replace" })).toHaveCount(0);
      expect((await zone.boundingBox())!.width / (await zone.boundingBox())!.height).toBeCloseTo(16 / 9, 1);
      await audit(page, "empty");
    });

    await test.step("wrong type and too large are refused before any upload starts", async () => {
      await input.setInputFiles({ name: "notes.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
      await expect(page.getByTestId("cover-error")).toContainText("Use a JPG, PNG or WebP image.");
      await input.setInputFiles({ name: "wrong.png", mimeType: "image/jpeg", buffer: png(1) });
      await expect(page.getByTestId("cover-error")).toContainText("Use a JPG, PNG or WebP image.");
      await input.setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 1) });
      await expect(page.getByTestId("cover-error")).toContainText("at most 10 MB");
      await page.screenshot({ path: `${shots}/error-size-1280-light.png`, fullPage: true, animations: "disabled" });
      expect(requests).toEqual([]);
    });

    await test.step("a rejected slot request: the server refuses what the browser let through", async () => {
      await page.route("**/cover/uploads", (route) => route.request().method() === "POST" ? route.fulfill({ status: 400, json: { error: { code: "checkTheSuppliedDetails" } } }) : route.fallback());
      await input.setInputFiles(file("cover.png", 1));
      await expect(page.getByTestId("cover-error")).toContainText("This image was not accepted. Choose another.");
      await page.unroute("**/cover/uploads");
    });

    await test.step("upload interrupted: Try again repeats the upload", async () => {
      await storagePut((route) => route.abort("connectionfailed"));
      await input.setInputFiles(file("cover.png", 1));
      await expect(page.getByTestId("cover-error")).toContainText("The upload was interrupted. Try again.");
      await page.unroute(isStorage);
    });

    await test.step("storage refuses the bytes: a clear failure with Try again", async () => {
      await storagePut((route) => route.fulfill({ status: 403, body: "<Error/>" }));
      await input.setInputFiles(file("cover.png", 1));
      await expect(page.getByTestId("cover-error")).toContainText("The image could not be uploaded. Try again.");
      await page.unroute(isStorage);
    });

    await test.step("progress, then the scan state while the safety check is pending", async () => {
      let go: () => void = () => undefined; const gate = new Promise<void>((resolve) => { go = resolve; });
      await storagePut(async (route) => { await gate; await route.continue(); });
      await confirmOnce("uploaded");
      await input.setInputFiles(file("cover.png", 1));
      await expect(page.getByRole("progressbar", { name: "Upload progress" })).toBeVisible();
      await expect(page.getByTestId("cover-progress")).toContainText("Uploading");
      await expect(input).toBeDisabled();
      await page.screenshot({ path: `${shots}/uploading-1280-light.png`, fullPage: true, animations: "disabled" });
      go();
      await expect(page.getByTestId("cover-scanning")).toContainText("Waiting for the safety check.");
      await page.unroute(isStorage);
      await page.screenshot({ path: `${shots}/scanning-1280-light.png`, fullPage: true, animations: "disabled" });
      await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
      await expect(image).toHaveCount(0);
    });

    await test.step("a file that fails the safety check is refused", async () => {
      await page.getByRole("button", { name: "Dismiss" }).click();
      await confirmOnce("quarantined");
      await input.setInputFiles(file("cover.png", 5));
      await expect(page.getByTestId("cover-error")).toContainText("failed the safety check");
      await page.screenshot({ path: `${shots}/error-scan-1280-light.png`, fullPage: true, animations: "disabled" });
      await expect(page.getByRole("button", { name: "Choose another" })).toBeVisible();
    });

    await test.step("a clean file becomes the cover, through the signed address only", async () => {
      await confirmOnce("uploaded");
      await input.setInputFiles(file("cover.png", 2));
      await expect(page.getByTestId("cover-scanning")).toBeVisible();
      const signed = page.waitForResponse((response) => response.url().endsWith(`${api}/cover`) && response.request().method() === "GET" && response.ok());
      await page.getByRole("button", { name: "Check again" }).click();
      await expect(page.getByText("Cover updated.")).toBeVisible();
      const body = await (await signed).json() as { url: string; expiresIn: number };
      expect(body.expiresIn).toBe(60);
      await expect(image).toBeVisible();
      expect(await image.getAttribute("src")).toBe(body.url);
      expect(body.url).toContain("X-Amz-Signature=");
      await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(320);
      await expect(page.getByTestId("cover-preview")).toBeVisible();
      await expect(page.getByRole("button", { name: "Replace" })).toBeVisible();
      await expect(page.getByTestId("cover-scanning")).toHaveCount(0);
      const box = (await zone.boundingBox())!; expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
    });

    await test.step("the cover survives a reload and does not block Save", async () => {
      await page.reload();
      await expect(image).toBeVisible();
      await page.getByLabel("Title").fill("Sunday gathering, updated");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Saved.")).toBeVisible();
      await expect(image).toBeVisible();
      await audit(page, "with-cover");
    });

    await test.step("replace: a new image takes over", async () => {
      await expect(image).toBeVisible();
      const before = await image.getAttribute("src");
      await confirmOnce("uploaded");
      await input.setInputFiles(file("cover2.png", 3));
      await expect(page.getByTestId("cover-scanning")).toBeVisible();
      await page.getByRole("button", { name: "Check again" }).click();
      await expect(page.getByText("Cover updated.")).toBeVisible();
      await expect.poll(async () => await image.getAttribute("src")).not.toBe(before);
      await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(320);
      expect((await admin.query("select count(*)::int as n from event_files where event_id=$1 and retired_at is not null", [id])).rows[0].n).toBe(1);
    });

    await test.step("keyboard: Select and Replace open the file chooser, Remove asks first", async () => {
      // Wait until the picker is idle (no upload or scan notice) and the buttons are enabled, then focus explicitly and prove focus before pressing a key.
      await expect(page.getByTestId("cover-progress")).toHaveCount(0);
      await expect(page.getByTestId("cover-scanning")).toHaveCount(0);
      const replace = page.getByRole("button", { name: "Replace" }), remove = page.getByRole("button", { name: "Remove" });
      await expect(replace).toBeEnabled();
      await expect(async () => { await replace.focus(); await expect(replace).toBeFocused({ timeout: 1000 }); }).toPass({ timeout: 10_000 });
      const chooser = page.waitForEvent("filechooser", { timeout: 15_000 }); await page.keyboard.press("Enter"); expect((await chooser).isMultiple()).toBe(false);
      await expect(remove).toBeEnabled();
      await expect(async () => { await remove.focus(); await expect(remove).toBeFocused({ timeout: 1000 }); }).toPass({ timeout: 10_000 });
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("alertdialog", { name: "Remove the cover?" });
      await expect(dialog).toBeVisible(); await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
      await expect(image).toBeVisible();
      await tall(page, "main button");
    });

    await test.step("remove: confirmed, the picture is gone and the cover route answers 404", async () => {
      await page.getByRole("button", { name: "Remove" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
      await expect(page.getByText("Cover removed.")).toBeVisible();
      await expect(image).toHaveCount(0);
      await expect(zone.getByText("Drop an image here")).toBeVisible();
      expect((await page.request.get(`${api}/cover`)).status()).toBe(404);
      await expect(page.getByTestId("cover-preview")).toHaveCount(0);
    });

    await test.step("drag and drop uploads through the same path", async () => {
      const data = await page.evaluateHandle(({ bytes }) => { const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], "dropped.png", { type: "image/png" })); return transfer; }, { bytes: [...png(4)] });
      await confirmOnce("uploaded");
      await zone.dispatchEvent("dragenter", { dataTransfer: data });
      await expect(zone).toHaveAttribute("data-dragging", "true");
      await zone.dispatchEvent("drop", { dataTransfer: data });
      await expect(page.getByTestId("cover-scanning")).toBeVisible();
    });

    await test.step("a stale version asks for a reload instead of overwriting", async () => {
      // Another manager changes the event while this form is open.
      const current = await (await page.request.get(api)).json() as { version: number };
      expect((await page.request.put(api, { headers: { origin }, data: { version: current.version, title: "Changed elsewhere", description: "", timeZone: "UTC", startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3_600_000).toISOString(), capacity: null, reminderMinutes: null, joinUrl: null } })).ok()).toBe(true);
      await page.getByRole("button", { name: "Check again" }).click();
      await expect(page.getByTestId("cover-error")).toContainText("This event changed since you opened it.");
      await expect(page.getByTestId("cover-error").getByRole("button", { name: "Reload" })).toBeVisible();
    });

    expect(errors).toEqual([]);
  } finally { await admin.end(); }
});

test("a viewer, a member and a stranger cannot change or read an event's cover", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Roles Church", audience: "church" } })).json()).tenantId as string;
  const id = crypto.randomUUID(), api = `/api/workspaces/${tenant}/events/${id}`, start = Date.now() + 86_400_000;
  expect((await page.request.put(api, { headers: { origin }, data: { version: 0, title: "Prayer", description: "", timeZone: "UTC", startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3_600_000).toISOString(), capacity: null, reminderMinutes: null, joinUrl: null } })).ok()).toBe(true);
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  const bytes = png(1), body = { kind: "cover", name: "c.png", mime: "image/png", size: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  try {
    for (const role of ["member", "viewer", "none"] as const) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
      const other = await context.newPage();
      other.on("pageerror", (error) => errors.push(error.message));
      const email = await signIn(other);
      if (role !== "none") {
        const user = (await admin.query("select id from users where email=$1", [email])).rows[0].id as string;
        await admin.query("insert into workspace_members(tenant_id,user_id,role_id) values ($1,$2,$3)", [tenant, user, role]);
      }
      await other.goto(`/workspaces/${tenant}/events/${id}`);
      await expect(other.getByTestId("cover-zone")).toHaveCount(0);
      await expect(other.getByRole("heading", { name: /access|workspace/i }).first()).toBeVisible();
      for (const [method, url, data] of [["post", `${api}/cover/uploads`, body], ["put", `${api}/cover`, { fileId: null, version: 1 }], ["get", `${api}/cover`, undefined], ["post", `${api}/cover/uploads/${crypto.randomUUID()}/confirm`, undefined]] as const) {
        const response = await other.request[method](url, { headers: { origin }, ...(data ? { data } : {}) });
        expect(response.ok(), `${role} ${method} ${url}`).toBe(false);
        expect([403, 404]).toContain(response.status());
      }
      await context.close();
    }
    expect((await admin.query("select count(*)::int as n from event_files where event_id=$1", [id])).rows[0].n).toBe(0);
    expect(errors).toEqual([]);
  } finally { await admin.end(); }
});
