import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 20000 });
// Link in bio: the editor (profile with cover, photo and icons; tabs; links and blocks; design; publish; live preview; messages) and the public page, with axe at
// three widths in both schemes, 44px targets on a phone and a touch swipe between tabs. Founder screenshots of the rework go to FOUNDER_SHOTS when it is set.
test.use({ actionTimeout: 20000, reducedMotion: "reduce" });
const evidence = process.env.FOUNDER_SHOTS ?? "docs/screenshots/link-in-bio";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;
const post = (page: Page, url: string, data: unknown = {}) => page.request.post(url, { headers: { origin }, data });

/** axe, retried when the dev server reloads the page mid-run (a late compile or a restart); a real violation is returned, never retried away. */
async function axe(page: Page) {
  for (let attempt = 0; ; attempt++) {
    try { await settleForAxe(page); return (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations; }
    catch (error) { if (attempt >= 6 || !/Execution context was destroyed|navigat|appendChild/i.test(String(error))) throw error; await page.waitForTimeout(2000); await page.waitForLoadState("load"); }
  }
}
/** One scene per width and scheme: axe (WCAG 2.0 to 2.2 A and AA), no horizontal overflow, and a screenshot. */
async function audit(page: Page, name: string, ready: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    // The dev server may restart itself under memory pressure; a reset reload is retried.
    await expect(async () => { await page.reload(); }).toPass({ timeout: 90_000 });
    await expect(page.locator(ready).first()).toBeVisible();
    await prepare?.();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      const found = await axe(page);
      expect(found.map((v) => `${label}/${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
      // Allow a late layout pass (fonts, the tab carousel measuring itself) before judging sideways overflow; name the widest element when it fails.
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth ? "ok"
        : [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(-3).map((el) => `${el.tagName}.${el.className}`.slice(0, 120)).join(" | ")), { timeout: 10_000 }).toBe("ok");
      if (width === 360) expect(await smallTargets(page), `${name} ${scheme}`).toEqual([]);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}
/** Header controls, tabs, icons and block rows of a link in bio page (public or preview) must be at least 44 by 44 px on a phone. Panels out of view are skipped. */
const smallTargets = (page: Page) => page.evaluate(() => {
  const selector = ["[data-bio-page] header a", "[data-bio-page] header button", "[data-bio-page] [role=tab]", "[data-bio-socials] a", "[data-bio-block] > a", "li[data-bio-block] a"].join(", ");
  return [...document.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0)
    .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((el) => `${el.tagName} ${el.textContent?.trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
});
/** A step of the editor: a sidebar step button with shell modes on, a stepper entry with them off. */
const step = (page: Page, name: string) => { const label = new RegExp(`^${name}\\s+(Done|Current step|Needs attention|Not started|Completed|Upcoming)`);
  return page.getByRole("button", { name: label }).or(page.getByRole("link", { name: label })).or(page.getByRole("tab", { name: label })).first(); };
const saved = (page: Page) => expect(page.locator('[data-save-state="saved"]:visible, [role="status"]:has-text("Draft saved.")').first()).toBeVisible();

test("editor, public page, click counts, Message me and messages", async ({ page, browser }) => {
  test.setTimeout(900000);
  // A unique address per attempt: a retry must not collide with the first attempt's published page.
  const handle = `grace-church-${Date.now().toString(36)}`;
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
  await expect(page.locator("[data-bio-preview] [data-bio-initials]")).toHaveText("GC");
  await page.getByLabel("Name", { exact: true }).fill("Grace Church");
  // Header (founder decision 27 Nov): name, photo, one line of short bio and the icons; no subtitle, details list or main button.
  await expect(page.getByLabel("One-line subtitle")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add detail" })).toHaveCount(0);
  await page.getByLabel("Short bio (one line)").fill("Sundays at 10:00. Everyone is welcome.");
  await expect(page.locator("[data-bio-preview] [data-bio-line]")).toHaveText("Sundays at 10:00. Everyone is welcome.");
  // Cover image through the scanned picker; the brand gradient shows until then.
  await expect(page.locator("[data-bio-preview] [data-bio-cover]")).toHaveAttribute("data-bio-cover", "gradient");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator('[data-testid="cover-input"]').first().setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Cover updated.").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-bio-preview] [data-bio-cover]")).toHaveAttribute("data-bio-cover", "image");
  // The cover can be switched off and on again; the uploaded image stays.
  await page.getByRole("switch", { name: "Show a cover" }).click();
  await expect(page.locator("[data-bio-preview] [data-bio-cover]")).toHaveCount(0);
  await page.getByRole("switch", { name: "Show a cover" }).click();
  await expect(page.locator("[data-bio-preview] [data-bio-cover]")).toHaveAttribute("data-bio-cover", "image");
  // The profile photo (required to publish), placed left or centre.
  await page.locator('[data-testid="cover-input"]').nth(1).setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Photo updated.").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-bio-preview] [data-bio-photo]")).toBeVisible();
  await page.getByRole("radio", { name: "Left" }).click();
  await expect(page.locator("[data-bio-preview] [data-bio-align]")).toHaveAttribute("data-bio-align", "left");
  await page.getByRole("radio", { name: "Centre" }).click();
  await expect(page.locator("[data-bio-preview] [data-bio-align]")).toHaveAttribute("data-bio-align", "center");
  await expect(page.locator("[data-bio-preview]")).toContainText("Sundays at 10:00");
  // Social and website icons: one style for the page.
  await page.getByRole("button", { name: "Add social icon" }).click();
  await page.getByLabel("Profile link (https)").fill("https://example.org/grace");
  await page.getByRole("radio", { name: "Colour" }).click();
  await expect(page.locator("[data-bio-preview] [data-bio-socials]")).toHaveAttribute("data-bio-icon-style", "color");
  await expect(page.locator("[data-bio-preview] [data-bio-socials] [data-colored]")).toHaveCount(1);

  // Tabs: the two first tabs, plus one the owner adds, names and moves by keyboard and by button.
  await step(page, "Links and blocks").click();
  await page.getByRole("button", { name: "Add tab" }).click();
  const tabRows = page.locator("[data-bio-tab-row]");
  await expect(tabRows).toHaveCount(3);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Add a name.")).toBeVisible();
  await page.getByLabel("Name of tab 3").fill("Watch");
  await page.getByRole("button", { name: "Drag Watch to reorder" }).focus();
  await page.keyboard.press("Space"); await page.waitForTimeout(250); await page.keyboard.press("ArrowUp"); await page.waitForTimeout(250); await page.keyboard.press("Space");
  await expect(tabRows.nth(1).getByRole("textbox")).toHaveValue("Watch");
  await page.getByRole("button", { name: "Move Watch down" }).click();
  await expect(tabRows.nth(2).getByRole("textbox")).toHaveValue("Watch");
  await page.getByRole("button", { name: "Move Watch up" }).click();
  await expect(tabRows.nth(1).getByRole("textbox")).toHaveValue("Watch");
  // Links: add, validate, reorder with the buttons, hide.
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
  // The Watch services link goes on the Watch tab.
  await page.locator('[data-bio-row]').first().getByLabel("Tab", { exact: true }).selectOption({ label: "Watch" });
  await expect(page.locator("[data-bio-preview]").getByRole("tab", { name: "Watch" })).toBeVisible();

  // Message me block and a social icon.
  await page.getByRole("button", { name: "Add block" }).click();
  await page.getByRole("menuitem", { name: /Message me/ }).click();
  await expect(page.getByText("No email is sent to the visitor or to you.")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await saved(page);
  await expect(page.getByText("Draft saved.")).toBeVisible();

  // Publish: the address checks, then the page is public.
  await step(page, "Publish").click();
  await page.getByLabel("Address name").fill("admin");
  await expect(page.getByText("That address is reserved.")).toBeVisible();
  await page.getByLabel("Address name").fill(`${handle}`);
  await expect(page.getByText("Available.")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await saved(page);
  await audit(page, "editor", "[data-bio-preview]");
  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await expect(page.getByText("Published.", { exact: true }).first()).toBeVisible({ timeout: 90_000 });

  // Public page: anonymous visitor, noindex-free published page, light and dark, three widths.
  // A unique visitor address: the per-visitor message limits must not be shared with other specs on the same server.
  const visitor = await browser.newContext({ baseURL: origin, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": `10.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}` } });
  const pub = await visitor.newPage();
  await expect(async () => { expect((await pub.goto(`/l/${handle}`))?.status()).toBe(200); }).toPass();
  await expect(pub.getByRole("heading", { name: "Grace Church", level: 1 })).toBeVisible();
  await expect(pub.getByRole("link", { name: /Give online/ })).toHaveAttribute("rel", "nofollow noopener noreferrer ugc");
  await expect(pub.getByRole("link", { name: /Give online/ })).toHaveAttribute("href", "https://example.org/give");
  await expect(pub.locator("[data-bio-line]")).toHaveText("Sundays at 10:00. Everyone is welcome.");
  await expect(pub.locator("[data-bio-primary]")).toHaveCount(0);
  await expect(pub.locator('[data-bio-cover="image"] img')).toHaveCount(1);
  await expect(pub.getByRole("tab")).toHaveText(["Home", "Watch", "Partnership"]);
  await expect(pub.locator("[data-bio-socials] [data-colored]")).toHaveCount(1);
  // Panels out of view are inert until their tab is chosen.
  await expect(pub.locator('[data-swipe-tab="partnership"]')).toHaveAttribute("inert", "");
  await audit(pub, "public", "[data-bio-page]");
  await audit(pub, "public-partnership", "[data-bio-page]", async () => { await pub.getByRole("tab", { name: "Partnership" }).click(); await expect(pub.locator("form[data-bio-message-form]")).toBeVisible(); });

  // On a touch phone a sideways swipe on the panel moves to the next tab.
  const phoneContext = await browser.newContext({ baseURL: origin, reducedMotion: "reduce", hasTouch: true, isMobile: true, viewport: { width: 360, height: 800 } });
  const phone = await phoneContext.newPage();
  await phone.goto(`/l/${handle}`);
  await expect(phone.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
  const cdp = await phoneContext.newCDPSession(phone);
  const box = (await phone.locator("[data-swipe-tabs]").boundingBox())!;
  const y = Math.round(box.y + Math.min(40, box.height / 2)), from = Math.round(box.x + box.width - 20);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from - i * 28, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(phone.getByRole("tab", { name: "Watch" })).toHaveAttribute("aria-selected", "true");
  await expect(phone.locator('[data-swipe-tab="home"]')).toHaveAttribute("inert", "");
  await phone.screenshot({ path: `${evidence}/public-swiped-phone-light.png`, fullPage: true });
  await phoneContext.close();

  // Clicks are counted without leaving the page.
  await pub.reload();
  const counted = pub.waitForResponse((r) => r.url().endsWith(`/l/${handle}/click`) && r.status() === 204);
  await pub.getByRole("link", { name: /Give online/ }).evaluate((a) => { a.addEventListener("click", (e) => e.preventDefault(), { capture: true }); (a as HTMLAnchorElement).click(); }).catch(() => undefined);
  await counted;

  // The Partnership tab holds the message form.
  await pub.getByRole("tab", { name: "Partnership" }).click();
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
  const submitted = pub.waitForResponse((r) => r.url().endsWith(`/l/${handle}/message`) && r.request().method() === "POST");
  await form.getByRole("button", { name: "Send message" }).click();
  const answer = await submitted;
  // Read the body only to explain a failure, and never wait on it: reading a response body after the page re-renders can block until the test times out.
  if (answer.status() !== 200) expect(answer.status(), await Promise.race([answer.text().catch(() => ""), new Promise<string>((resolve) => setTimeout(() => resolve("(no body)"), 5_000))])).toBe(200);
  await expect(pub.locator("[data-bio-message-sent]")).toContainText("Your message was sent.");
  await visitor.close();

  // Owner: counts, messages list, handled, delete.
  await page.goto(editor);
  await page.getByRole("link", { name: /Messages/ }).click();
  await page.waitForURL(/\/link-in-bio\/messages$/, { timeout: 90_000 });
  await expect(page.locator("[data-bio-message]")).toContainText("Could someone call me about baptism?", { timeout: 90_000 });
  await expect(page.locator("[data-bio-message]")).toContainText("ana@example.test");
  await audit(page, "messages", "[data-bio-messages]");
  await page.getByRole("button", { name: "Mark handled" }).click();
  await expect(page.getByText("Handled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No messages yet")).toBeVisible();

  // Single page: no tab bar, every visible block on one page.
  await page.goto(editor);
  await step(page, "Links and blocks").click();
  await page.getByRole("radio", { name: "Single page" }).click();
  await expect(page.locator("[data-bio-tab-row]")).toHaveCount(0);
  await expect(page.locator("[data-bio-preview] [role=tablist]")).toHaveCount(0);
  await page.getByRole("button", { name: "Publish changes", exact: true }).first().click();
  await expect(page.getByText("Published.", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  const single = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" });
  const flat = await single.newPage();
  await expect(async () => { expect((await flat.goto(`/l/${handle}`))?.status()).toBe(200); }).toPass({ timeout: 90_000 });
  await expect(flat.locator('[data-bio-layout="single"]')).toBeVisible();
  await expect(flat.getByRole("tab")).toHaveCount(0);
  await expect(flat.getByRole("link", { name: /Watch services/ })).toBeVisible();
  await expect(flat.locator("form[data-bio-message-form]")).toBeVisible();
  await audit(flat, "public-single", "[data-bio-page]");
  await single.close();

  // Unpublish: the public address is an honest 404 and the draft is kept.
  await page.goto(editor);
  await page.getByRole("button", { name: "Unpublish", exact: true }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(page.getByText(/Unpublished\./)).toBeVisible({ timeout: 90_000 });
  expect((await page.request.get(`/l/${handle}`)).status()).toBe(404);
  expect((await page.request.get("/l/no-such-page")).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("members cannot reach the editor", async ({ page, browser }) => {
  await signIn(page);
  const created = await post(page, "/api/workspaces", { name: "Closed Ministry", audience: "church" });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const tenant = (await created.json()).tenantId as string;
  const mine = await page.request.get(`/api/workspaces/${tenant}/link-in-bio`);
  expect(mine.status(), `${mine.status()} ${await mine.text()}`).toBe(200);
  const stranger = await browser.newContext({ baseURL: origin });
  const other = await stranger.newPage();
  await signIn(other);
  expect((await other.request.get(`/api/workspaces/${tenant}/link-in-bio`)).status()).toBe(403);
  await stranger.close();
});
