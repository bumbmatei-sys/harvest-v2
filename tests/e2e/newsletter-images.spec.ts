import { mkdir } from "node:fs/promises";
import { deflateSync, crc32 } from "node:zlib";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 30000 });
// Newsletter images: cover image, image block, video thumbnail. Upload, library, alt text rule, preview, errors, persistence, axe at 360/768/1280 in both schemes.
// Synthetic images and the loopback storage mock only; no thumbnail is fetched from the internet (the suggestion button is only checked for presence).
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/newsletter-images";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;

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
const image = (name: string, seed: number) => ({ name, mimeType: "image/png", buffer: png(seed) });

async function shoot(page: Page, name: string, prepare?: () => Promise<void>) {
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload(); await page.waitForTimeout(400);
    await prepare?.();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
      const result = await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${scheme} ${width} overflow`).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
const preview = (page: Page) => page.frameLocator('iframe[title="Email preview"]').first();
const picker = (page: Page, scope: string) => page.locator(`[data-image-picker="${scope}"]`);

test("newsletter images: cover, image block, library, alt rule, video thumbnail, errors and persistence", async ({ page }) => {
  test.setTimeout(600000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  // The sign-in helper pins a forwarded address on every request; storage is another origin and its CORS policy does not allow that header.
  await page.context().setExtraHTTPHeaders({});
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  await page.goto(`/workspaces/${tenant}/newsletter/campaigns`);
  await page.locator('section [data-template="weekly-update"]').getByRole("button", { name: "Use Weekly update" }).click();
  await expect(page).toHaveURL(/\/newsletter\/campaigns\/[0-9a-f-]{36}$/);
  const editorUrl = page.url();
  const requests: string[] = [];
  page.on("request", (request) => { if (/\/newsletter\/images/.test(request.url())) requests.push(request.method() + " " + new URL(request.url()).pathname); });

  // Cover: wrong type and oversize never start an upload.
  const cover = picker(page, "nl-cover");
  await expect(cover.getByTestId("image-zone")).toBeVisible();
  await cover.getByTestId("image-input").setInputFiles({ name: "photo.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(cover.getByTestId("image-error")).toContainText("Use a JPG, PNG or WebP image.");
  await cover.getByTestId("image-input").setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(cover.getByTestId("image-error")).toContainText("at most 5 MB");
  expect(requests).toEqual([]);

  // Upload a cover: signed slot, direct PUT, server verification and scan, then it is the cover and shows in the preview.
  await cover.getByTestId("image-input").setInputFiles(image("cover.png", 1));
  await expect(cover.getByTestId("image-preview")).toBeVisible();
  expect(requests.some((r) => r.startsWith("POST") && r.endsWith("/newsletter/images"))).toBe(true);
  expect(requests.some((r) => /\/images\/[0-9a-f-]{36}\/confirm$/.test(r))).toBe(true);
  // Alt text is required for an uploaded image until described or marked decorative.
  await expect(cover.getByText("Describe the image, or mark it decorative.")).toBeVisible();
  await expect(page.getByText("Fix the highlighted fields to save.")).toBeVisible();
  await cover.getByLabel("Image description").fill("Our church on a sunny morning");
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  const coverImage = preview(page).locator('img[alt="Our church on a sunny morning"]');
  await expect(coverImage).toBeVisible();
  await expect.poll(() => coverImage.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(coverImage).toHaveAttribute("width", "600");

  // Image block: pick the uploaded cover from the library, then mark it decorative.
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  await page.getByRole("combobox", { name: "Search blocks" }).fill("image");
  await page.getByRole("option", { name: "Image", exact: true }).click();
  const block = page.locator('[data-block-type="image"] [data-block-editor] [data-image-picker]');
  await block.getByRole("button", { name: "Library" }).click();
  await expect(page.getByTestId("image-library").getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "Use cover.png" }).click();
  await expect(block.getByTestId("image-preview")).toBeVisible();
  await expect(block.getByText("Describe the image, or mark it decorative.")).toBeVisible();
  await block.getByLabel("Image description").fill("Sunday gathering");
  await page.locator('[data-block-type="image"] [data-block-editor]').getByLabel("Image link (optional)").fill("https://example.com/visit");
  await expect(preview(page).locator('a[href="https://example.com/visit"] img[alt="Sunday gathering"]')).toBeVisible();
  await block.getByRole("switch", { name: "Decorative image (no description)" }).click();
  await expect(block.getByText("Describe the image, or mark it decorative.")).toHaveCount(0);
  await expect(preview(page).locator('a[href="https://example.com/visit"] img[alt=""]')).toBeVisible();
  await block.getByRole("switch", { name: "Decorative image (no description)" }).click();
  await block.getByLabel("Image description").fill("Sunday gathering");

  // Video block: a link, a suggestion offered for a known host (never fetched here), an uploaded thumbnail, a play button in the email.
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  await page.getByRole("combobox", { name: "Search blocks" }).fill("video");
  await page.getByRole("option", { name: "Video", exact: true }).click();
  const video = page.locator('[data-block-type="video"] [data-block-editor]');
  await video.getByLabel("Video link").fill("http://insecure.example/watch");
  await expect(video.getByText("Use a secure https link.")).toBeVisible();
  await video.getByLabel("Video link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(video.getByRole("button", { name: "Use the video's thumbnail" })).toBeVisible();
  await video.locator("[data-image-picker]").getByTestId("image-input").setInputFiles(image("thumb.png", 2));
  await expect(video.getByTestId("image-preview")).toBeVisible();
  await video.getByLabel("Image description").fill("Sunday service video");
  await expect(video.getByRole("button", { name: "Use the video's thumbnail" })).toHaveCount(0);
  await expect(preview(page).locator('a[href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"]').first()).toBeVisible();
  await expect(preview(page).getByText("▶")).toBeVisible();
  await expect(preview(page).getByText("Watch the video")).toBeVisible();
  const html = await page.locator('iframe[title="Email preview"]').first().getAttribute("srcdoc");
  expect(html).not.toContain("img.youtube.com");
  expect(html).toContain("background-image:url('/api/files/public/");

  // Library now shows both images; a different video host needs an uploaded thumbnail (no suggestion).
  await video.getByLabel("Video link").fill("https://vk.com/video-1_2");
  await expect(video.getByRole("button", { name: "Use the video's thumbnail" })).toHaveCount(0);

  await shoot(page, "editor-cover-image-video", () => page.getByRole("button", { name: "Edit Video" }).click());

  // Persistence: reload; cover, image and video thumbnail come back and render from the server.
  await page.goto(editorUrl);
  await expect(picker(page, "nl-cover").getByTestId("image-preview")).toBeVisible();
  await expect(preview(page).locator('img[alt="Our church on a sunny morning"]')).toBeVisible();
  await picker(page, "nl-cover").getByRole("button", { name: "Remove" }).click();
  await expect(picker(page, "nl-cover").getByTestId("image-preview")).toHaveCount(0);
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  await expect(preview(page).locator('img[alt="Our church on a sunny morning"]')).toHaveCount(0);

  // The test send renders through the server and only ever to the synthetic sink.
  await page.getByRole("button", { name: "Send me a test" }).click();
  await expect(page.getByText("Test sent to the test inbox.")).toBeVisible();
  expect(errors).toEqual([]);
});
