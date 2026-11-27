import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20000 });
// Link in bio rework PR 2: the owner adds the new block types (video, contact, location, Live now, testimonials), publishes and a visitor sees them; axe at
// 360 and 1280 in light and dark, and 44px targets on a phone. Products, courses, PDFs and forms need seeded records and are covered by the integration test.
test.use({ actionTimeout: 20000, reducedMotion: "reduce" });
const evidence = process.env.FOUNDER_SHOTS ?? "test-results/link-in-bio-blocks";
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(url, { headers: { origin }, data });
const smallTargets = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-bio-block] a, [data-bio-block] button, li[data-bio-block] a")]
  .filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0).filter((el) => { const r = el.getBoundingClientRect(); return r.height < 44 || r.width < 44; })
  .map((el) => `${el.tagName} ${el.textContent?.trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));

const step = (page: Page, name: string) => { const label = new RegExp(`^${name}\\s+(Done|Current step|Needs attention|Not started|Completed|Upcoming)`);
  return page.getByRole("button", { name: label }).or(page.getByRole("link", { name: label })).or(page.getByRole("tab", { name: label })).first(); };
async function audit(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(async () => { await page.reload(); }).toPass({ timeout: 90_000 });
    await expect(page.locator("[data-bio-page]").first()).toBeVisible();
    for (const [label, width, height] of [["phone", 360, 800], ["desktop", 1280, 900]] as const) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      const found = (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
      expect(found.map((v) => `${label}/${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 360) expect(await smallTargets(page), `${name} ${scheme}`).toEqual([]);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
}

test("owner adds the new blocks and a visitor sees them", async ({ page, browser }) => {
  test.setTimeout(420000);
  const handle = `blocks-${Date.now().toString(36)}`;
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await post(page, "/api/workspaces", { name: "Hope Chapel", audience: "church" })).json()).tenantId as string;
  await page.context().setExtraHTTPHeaders({});
  await page.goto(`/workspaces/${tenant}/link-in-bio`);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator('[data-testid="cover-input"]').nth(1).setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Photo updated.").first()).toBeVisible({ timeout: 90_000 });

  await step(page, "Links and blocks").click();
  await page.getByRole("radio", { name: "Single page" }).click();
  const add = async (name: string) => { await page.getByRole("button", { name: "Add block" }).click(); await page.getByRole("menuitem", { name }).click(); };
  // Video: only a YouTube or VK link is accepted.
  await add("Video");
  await page.getByLabel("Video link (YouTube or VK)").fill("https://example.org/not-a-video");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Paste a YouTube or VK video link.")).toBeVisible();
  await page.getByLabel("Video link (YouTube or VK)").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByLabel("Title (optional)").fill("Welcome to Hope Chapel");
  await add("Contact");
  await page.getByLabel("Email", { exact: true }).fill("hello@example.invalid");
  await page.getByLabel("WhatsApp number").fill("+351 912 345 678");
  await add("Location");
  await page.getByLabel("Address").fill("Rua Augusta 1, Lisboa");
  await add("Live now");
  await page.getByLabel("Live stream link (https)").fill("https://example.org/live");
  await page.getByRole("switch", { name: /Live now/ }).click();
  await add("Testimonials");
  await page.getByLabel("Quote").fill("This church welcomed our family.");
  await page.getByLabel("Name", { exact: true }).last().fill("Maria");
  await expect(page.locator("[data-bio-preview] [data-bio-live-badge]")).toBeVisible();
  await expect(page.locator("[data-bio-preview] [data-bio-contact]")).toBeVisible();

  await step(page, "Publish").click();
  await page.getByLabel("Address name").fill(handle);
  await expect(page.getByText("Available.")).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await expect(page.getByText("Published.", { exact: true }).first()).toBeVisible({ timeout: 90_000 });

  const visitor = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" });
  const pub = await visitor.newPage();
  await expect(async () => { expect((await pub.goto(`/l/${handle}`))?.status()).toBe(200); }).toPass({ timeout: 90_000 });
  await expect(pub.locator("[data-lesson-video-facade]")).toBeVisible();
  await expect(pub.locator("iframe")).toHaveCount(0);
  await expect(pub.locator('[data-bio-contact-channel="email"]')).toHaveAttribute("href", "mailto:hello@example.invalid");
  await expect(pub.locator('[data-bio-contact-channel="whatsapp"]')).toHaveAttribute("href", "https://wa.me/351912345678");
  await expect(pub.getByRole("link", { name: /Open in maps/ })).toHaveAttribute("href", "https://www.openstreetmap.org/search?query=Rua%20Augusta%201%2C%20Lisboa");
  await expect(pub.locator("[data-bio-live]")).toHaveAttribute("href", "https://example.org/live");
  await expect(pub.locator("[data-bio-live-badge]")).toHaveText("Live");
  await expect(pub.locator("[data-bio-testimonials]")).toContainText("This church welcomed our family.");
  await audit(pub, "blocks-public");

  // Live now switched off: the block leaves the public page.
  await step(page, "Links and blocks").click();
  await page.getByRole("switch", { name: /Live now/ }).click();
  await page.getByRole("button", { name: "Publish changes", exact: true }).first().click();
  await expect(page.getByText("Published.", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await pub.reload();
  await expect(pub.locator("[data-bio-live]")).toHaveCount(0);
  await visitor.close();
});
