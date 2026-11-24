import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20000 });
// Link in bio: the editor (profile, links, blocks, design, publish, live preview, messages) and the public page, with axe at three widths in both schemes.
test.use({ actionTimeout: 20000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/link-in-bio";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(url, { headers: { origin }, data });

/** One scene per width and scheme: axe (WCAG 2.0 to 2.2 A and AA), no horizontal overflow, and a screenshot. */
async function audit(page: Page, name: string, ready: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator(ready).first()).toBeVisible();
    await prepare?.();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      const found = (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
      expect(found.map((v) => `${label}/${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}
/** A step of the editor: a sidebar step button with shell modes on, a stepper entry with them off. */
const step = (page: Page, name: string) => { const label = new RegExp(`^${name}\\s+(Done|Current step|Needs attention|Not started|Completed|Upcoming)`);
  return page.getByRole("button", { name: label }).or(page.getByRole("link", { name: label })).or(page.getByRole("tab", { name: label })).first(); };
const saved = (page: Page) => expect(page.locator('[data-save-state="saved"]:visible, [role="status"]:has-text("Draft saved.")').first()).toBeVisible();

test("editor, public page, click counts, Message me and messages", async ({ page, browser }) => {
  test.setTimeout(420000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const tenant = (await (await post(page, "/api/workspaces", { name: "Grace Community Church", audience: "church" })).json()).tenantId as string;
  // The sign-in helper adds a forwarded-for header to every request; a signed storage upload from the browser must not carry it (CORS preflight).
  await page.context().setExtraHTTPHeaders({});
  const editor = `/workspaces/${tenant}/link-in-bio`;

  // Navigation: the entry sits in Public > Website for owners (shell modes on) and the editor opens with a draft.
  await page.goto(editor);
  await expect(page.getByRole("heading", { name: "Link in bio", exact: true })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Grace Community Church");
  await expect(page.locator("[data-bio-preview]")).toBeVisible();

  // Profile: name and bio feed the live preview.
  await page.getByLabel("Name", { exact: true }).fill("Grace Church");
  await page.getByLabel("One-line subtitle").fill("Pastor and church planter");
  await page.getByLabel("Short bio").fill("Sundays at 10:00. Everyone is welcome.");
  await expect(page.locator("[data-bio-preview]")).toContainText("Pastor and church planter");
  // Cover image through the scanned picker; the brand gradient shows until then.
  await expect(page.locator("[data-bio-preview] [data-bio-cover]")).toHaveAttribute("data-bio-cover", "gradient");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator('[data-testid="cover-input"]').first().setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Cover updated.").first()).toBeVisible();
  await expect(page.locator("[data-bio-preview] [data-bio-cover]")).toHaveAttribute("data-bio-cover", "image");
  // Details: only what the owner types; each row can be hidden.
  await page.getByRole("button", { name: "Add detail" }).click();
  await page.getByLabel("Text", { exact: true }).first().fill("Lisbon, Portugal");
  await page.getByRole("button", { name: "Add detail" }).click();
  await page.getByLabel("Text", { exact: true }).nth(1).fill("Secret ministry text");
  await expect(page.locator("[data-bio-preview] [data-bio-details]")).toContainText("Secret ministry text");
  await page.getByRole("button", { name: /^Hide Ministry or church/ }).click();
  await expect(page.locator("[data-bio-preview] [data-bio-details]")).not.toContainText("Secret ministry text");
  await expect(page.locator("[data-bio-preview] [data-bio-details]")).toContainText("Lisbon, Portugal");
  await expect(page.locator("[data-bio-preview]")).toContainText("Sundays at 10:00");
  await expect(page.locator("[data-bio-preview] [data-bio-initials]")).toHaveText("GC");

  // Links: add, validate, reorder with the buttons, hide.
  await step(page, "Links and blocks").click();
  await expect(page.locator("[data-bio-empty]")).toBeVisible();
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await page.getByLabel("Label").first().fill("Give online");
  await page.getByLabel("Link (https)").first().fill("http://insecure.example");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Use a full https address.").first()).toBeVisible();
  await page.getByLabel("Link (https)").first().fill("https://example.org/give");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await page.getByLabel("Label").nth(1).fill("Watch services");
  await page.getByLabel("Link (https)").nth(1).fill("https://example.org/watch");
  await page.getByRole("button", { name: "Move Watch services up" }).click();
  await expect(page.locator("[data-bio-row]").first().getByLabel("Label")).toHaveValue("Watch services");
  await page.getByRole("button", { name: "Hide Watch services" }).click();
  await expect(page.locator("[data-bio-preview]")).not.toContainText("Watch services");
  await page.getByRole("button", { name: "Show Watch services" }).click();
  await expect(page.locator("[data-bio-preview]")).toContainText("Watch services");

  // Message me block and a social icon.
  await page.getByRole("button", { name: "Add block" }).click();
  await page.getByRole("menuitem", { name: /Message me/ }).click();
  await expect(page.getByText("No email is sent to the visitor or to you.")).toBeVisible();
  await page.getByRole("button", { name: "Add social icon" }).click();
  await page.getByLabel("Profile link (https)").fill("https://example.org/grace");
  await page.getByRole("button", { name: "Save draft" }).click();
  await saved(page);
  await expect(page.getByText("Draft saved.")).toBeVisible();

  // Publish: the address checks, then the page is public.
  await step(page, "Publish").click();
  await page.getByLabel("Address name").fill("admin");
  await expect(page.getByText("That address is reserved.")).toBeVisible();
  await page.getByLabel("Address name").fill("grace-church");
  await expect(page.getByText("Available.")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await saved(page);
  await audit(page, "editor", "[data-bio-preview]");
  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await expect(page.getByText("Published.", { exact: true }).first()).toBeVisible();

  // Public page: anonymous visitor, noindex-free published page, light and dark, three widths.
  const visitor = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" });
  const pub = await visitor.newPage();
  await expect(async () => { expect((await pub.goto("/l/grace-church"))?.status()).toBe(200); }).toPass();
  await expect(pub.getByRole("heading", { name: "Grace Church", level: 1 })).toBeVisible();
  await expect(pub.getByRole("link", { name: /Give online/ })).toHaveAttribute("rel", "nofollow noopener noreferrer ugc");
  await expect(pub.getByRole("link", { name: /Give online/ })).toHaveAttribute("href", "https://example.org/give");
  await expect(pub.locator("[data-bio-details]")).toContainText("Lisbon, Portugal");
  await expect(pub.locator("body")).not.toContainText("Secret ministry text");
  await expect(pub.locator('[data-bio-cover="image"] img')).toHaveCount(1);
  await expect(pub.getByRole("tab", { name: "Home" })).toBeVisible();
  await expect(pub.getByRole("tab", { name: "Partnership" })).toBeVisible();
  await expect(pub.locator("form[data-bio-message-form]")).toHaveCount(0);
  await audit(pub, "public", "[data-bio-page]");
  await audit(pub, "public-partnership", "[data-bio-page]", async () => { await pub.getByRole("tab", { name: "Partnership" }).click(); await expect(pub.locator("form[data-bio-message-form]")).toBeVisible(); });

  // Clicks are counted without leaving the page.
  await pub.reload();
  const counted = pub.waitForResponse((r) => r.url().endsWith("/l/grace-church/click") && r.status() === 204);
  await pub.getByRole("link", { name: /Give online/ }).evaluate((a) => { a.addEventListener("click", (e) => e.preventDefault(), { capture: true }); (a as HTMLAnchorElement).click(); }).catch(() => undefined);
  await counted;

  // The main button opens the Partnership tab at the message form.
  await pub.locator("[data-bio-primary]").click();
  await expect(pub.locator("form[data-bio-message-form]")).toBeVisible();
  await expect(pub.getByText("Your details go to Grace Community Church. You can ask them to delete them.")).toBeVisible();
  await expect(pub.getByRole("checkbox")).not.toBeChecked();
  // Message me: consent required, then stored; nothing else happens.
  const form = pub.locator("form[data-bio-message-form]");
  await form.getByLabel("Your name").fill("Ana Visitor");
  await form.getByLabel("Email").fill("ana@example.test");
  await form.getByLabel("Message", { exact: true }).fill("Could someone call me about baptism?");
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(form.getByRole("alert")).toContainText("Check your details");
  await form.getByRole("checkbox").check();
  await pub.waitForTimeout(1200);
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(pub.locator("[data-bio-message-sent]")).toContainText("Your message was sent.");
  await visitor.close();

  // Owner: counts, messages list, handled, delete.
  await page.goto(editor);
  await page.getByRole("link", { name: /Messages/ }).click();
  await expect(page.locator("[data-bio-message]")).toContainText("Could someone call me about baptism?");
  await expect(page.locator("[data-bio-message]")).toContainText("ana@example.test");
  await audit(page, "messages", "[data-bio-messages]");
  await page.getByRole("button", { name: "Mark handled" }).click();
  await expect(page.getByText("Handled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No messages yet")).toBeVisible();

  // Unpublish: the public address is an honest 404 and the draft is kept.
  await page.goto(editor);
  await page.getByRole("button", { name: "Unpublish", exact: true }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(page.getByText(/Unpublished\./)).toBeVisible();
  expect((await page.request.get("/l/grace-church")).status()).toBe(404);
  expect((await page.request.get("/l/no-such-page")).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("members cannot reach the editor", async ({ page, browser }) => {
  await signIn(page);
  const created = await post(page, "/api/workspaces", { name: "Closed Ministry", audience: "church" });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const tenant = (await created.json()).tenantId as string;
  expect((await page.request.get(`/api/workspaces/${tenant}/link-in-bio`)).status()).toBe(200);
  const stranger = await browser.newContext({ baseURL: origin });
  const other = await stranger.newPage();
  await signIn(other);
  expect((await other.request.get(`/api/workspaces/${tenant}/link-in-bio`)).status()).toBe(403);
  await stranger.close();
});
