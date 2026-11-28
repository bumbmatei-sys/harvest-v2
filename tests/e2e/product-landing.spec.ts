import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Browser, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Product and course landing page: the owner's Sales page step, the public page (free and priced), reviews by people who have the course, hiding a review,
// and the evidence screenshots. Synthetic data only; checkout stays off.
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const evidence = "docs/screenshots/product-landing";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const doc = (title: string, text: string) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: title }] }, { type: "paragraph", content: [{ type: "text", text }] }] });
const hydrated = (page: Page) => page.waitForFunction(() => { const field = document.querySelector("main button, main input"); return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps")); });

async function scheme(page: Page, value: "light" | "dark") {
  await page.emulateMedia({ colorScheme: value, reducedMotion: "reduce" });
  await page.evaluate((v) => { const root = document.documentElement; root.dataset.theme = v; root.classList.toggle("dark", v === "dark"); }, value);
}
/** axe (WCAG 2.2 AA), no sideways scroll and 44px targets below 1024px, then a full-page 2x screenshot, at phone 390 and desktop 1440 in both schemes. */
async function shots(page: Page, name: string, scope = "main") {
  for (const width of [390, 1440]) for (const value of ["light", "dark"] as const) {
    await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
    await scheme(page, value);
    await settleForAxe(page);
    expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations, `${name} ${width} ${value}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width} ${value} scroll`).toBe(true);
    if (width < 1024) {
      const small = await page.evaluate((selector) => [...document.querySelectorAll(`${selector} :is(a[href],button:not([disabled]),select,input:not([type=hidden]):not([disabled]),textarea)`)].filter((element) => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && !element.closest("[aria-hidden=true]") && (box.height < 43.5 || box.width < 43.5) && !element.classList.contains("sr-only")
          && !element.closest(".ProseMirror, [data-slot=sales-page-editor] [role=toolbar]");
      }).map((element) => `${element.tagName} ${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}`), scope);
      expect(small, `${name} targets under 44px`).toEqual([]);
    }
    await page.screenshot({ path: `${evidence}/${name}-${width}-${value}.png`, fullPage: true });
  }
  await scheme(page, "light");
  await page.setViewportSize({ width: 1440, height: 900 });
}
async function person(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 2 }), page = await context.newPage();
  await signIn(page);
  return { context, page };
}

test("owner writes the sales page; visitors see the landing; people who have it review; the owner hides a review", async ({ page, browser }) => {
  test.setTimeout(480_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${page.url()} ${error.message.slice(0, 120)}`));
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}`, stamp = Date.now().toString(36), slug = `pray-daily-${stamp}`, paidSlug = `deeper-prayer-${stamp}`;
  const send = async (method: "post" | "put", path: string, data: unknown) => {
    const response = await page.request[method](path, { headers: { origin }, data });
    expect(response.status(), `${method} ${path}`).toBeLessThan(300);
    return (await response.json()) as { id: string; version: number };
  };
  const course = await send("post", `${api}/catalog`, { kind: "course", slug, title: "Pray daily", summary: "A six-week path into daily prayer.", visibility: "listed",
    sections: [{ title: "Start", lessons: [{ title: "Why pray", body: doc("Why pray", "Prayer is talking with God."), published: true }, { title: "When", body: doc("When", "Morning and evening."), published: true }] },
      { title: "Grow", lessons: [{ title: "Listening", body: doc("Listening", "Be still."), published: true }] }] });
  await send("put", `${api}/catalog/${course.id}/state`, { version: course.version, state: "published" });
  const paid = await send("post", `${api}/catalog`, { kind: "course", slug: paidSlug, title: "Deeper prayer", summary: "For leaders who pray for others.", visibility: "listed",
    lessons: [{ title: "One", body: doc("One", "Intercession."), published: true }] });
  await send("put", `${api}/catalog/${paid.id}/state`, { version: paid.version, state: "published" });
  const now = Date.now();
  await send("put", `${api}/catalog/${paid.id}/landing`, { version: 0, subtitle: "Pray for your church with confidence", body: doc("What you will learn", "How to pray for others, week by week."),
    included: ["Four video lessons", "A printable prayer plan", "Weekly reflection questions"], aboutHeading: "Pastor Ruth", aboutBody: "Ruth has led prayer ministry for twenty years.",
    aboutPhotoId: null, faq: [{ question: "Who is this for?", answer: "Anyone who leads prayer in a church." }], ctaQuote: "Prayer is the work.", ctaLabel: "", price: { cents: 4900, currency: "USD" },
    sale: { cents: 2900, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 2 * 86_400_000 + 3 * 3_600_000).toISOString() } });

  // Owner: the Sales page step of the existing editor.
  await page.goto(`/workspaces/${tenant}/products/${course.id}`);
  await hydrated(page);
  await page.getByRole("button", { name: /Sales page/ }).first().click();
  const editor = page.locator("[data-slot=sales-page-editor]");
  await editor.getByLabel("Subtitle", { exact: true }).fill("Learn to pray every day, in six weeks");
  await editor.getByRole("textbox", { name: "Long description" }).click();
  await page.keyboard.type("Prayer can become the best part of your day. This course walks with you, one small step at a time.");
  for (const [index, text] of ["Six short lessons", "A daily prayer plan", "Questions for small groups"].entries()) {
    await editor.getByRole("button", { name: "Add item" }).click();
    await editor.getByLabel(`Item ${index + 1}`, { exact: true }).fill(text);
  }
  await editor.getByLabel("Heading", { exact: true }).fill("About Grace Community Church");
  await editor.getByLabel("Bio", { exact: true }).fill("A church family that has taught prayer in its city for thirty years.");
  await editor.getByRole("button", { name: "Add question" }).click();
  await editor.getByLabel("Question 1", { exact: true }).fill("How long does it take?");
  await editor.getByLabel("Answer 1", { exact: true }).fill("About ten minutes a day for six weeks.");
  await editor.getByRole("button", { name: "Add question" }).click();
  await editor.getByLabel("Question 2", { exact: true }).fill("Is it really free?");
  await editor.getByLabel("Answer 2", { exact: true }).fill("Yes. Enrol and start today.");
  await editor.getByLabel("Quote", { exact: true }).fill("Ten minutes a day changed how I pray.");
  // A sale without a price is refused before it is sent.
  await editor.getByLabel("Sale price", { exact: true }).fill("10");
  await editor.getByRole("button", { name: "Save sales page" }).click();
  await expect(editor.getByText("Set a price before a sale.")).toBeVisible();
  await editor.getByLabel("Sale price", { exact: true }).fill("");
  await editor.getByRole("button", { name: "Save sales page" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Sales page saved." })).toBeVisible();
  // The editor shell around the step is shared and checked by its own specs; this checks the Sales page step.
  await shots(page, "editor", "[data-slot=sales-page-editor]");

  // Signed out: the free course's landing page.
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 2 }), anon = await visitor.newPage();
  anon.on("pageerror", (error) => errors.push(`${anon.url()} ${error.message.slice(0, 120)}`));
  await anon.goto(`/courses/${slug}`);
  await expect(anon.getByRole("heading", { name: "Pray daily", level: 1 })).toBeVisible();
  await expect(anon.getByText("Learn to pray every day, in six weeks")).toBeVisible();
  await expect(anon.getByText("2 modules")).toBeVisible();
  await expect(anon.getByText("Fewer than 5 have it")).toBeVisible();
  await expect(anon.getByRole("heading", { name: "What's included", level: 2 })).toBeVisible();
  await expect(anon.getByRole("heading", { name: "Questions", level: 2 })).toBeVisible();
  await expect(anon.getByRole("link", { name: "Sign in to enrol" })).toBeVisible();
  await expect(anon.getByText(/checkout/i)).toHaveCount(0);
  const html = await anon.content();
  expect(html).not.toContain(tenant);
  expect(html).not.toContain(course.id);

  // Two people enrol and review; a third signs in without enrolling and cannot.
  const one = await person(browser), two = await person(browser), outsider = await person(browser);
  for (const { page: learner } of [one, two]) {
    expect((await learner.request.post(`/api/catalog/${slug}/enrolment`, { headers: { origin } })).status()).toBe(200);
  }
  expect((await outsider.page.request.put(`/api/catalog/${slug}/review`, { headers: { origin }, data: { rating: 5, body: "Not enrolled" } })).status()).toBe(403);
  await one.page.goto(`/courses/${slug}`);
  await hydrated(one.page);
  const form = one.page.locator("[data-slot=review-form]");
  await form.getByRole("radio", { name: "5 stars" }).click();
  await form.getByLabel("Review (optional)").fill("Clear, gentle and practical. I pray every morning now.");
  await form.getByRole("button", { name: "Save review" }).click();
  await expect(form.getByText("Review saved.")).toBeVisible();
  expect((await two.page.request.put(`/api/catalog/${slug}/review`, { headers: { origin }, data: { rating: 4, body: "Good for our small group." } })).status()).toBe(200);
  await anon.reload();
  await expect(anon.getByText("Clear, gentle and practical. I pray every morning now.").first()).toBeVisible();
  await expect(anon.getByText("4.5 out of 5 · 2 reviews").first()).toBeVisible();
  await hydrated(anon);
  await shots(anon, "course-free");

  // The priced course: price with the sale, the countdown, and the button turned off.
  await anon.goto(`/courses/${paidSlug}`);
  const box = anon.locator("[data-slot=landing-buy-box]");
  await expect(box.getByText("$29")).toBeVisible();
  await expect(box.getByText("$49")).toBeVisible();
  await expect(box.getByText(/Sale ends in 2d/)).toBeVisible();
  await expect(box.getByRole("button", { name: "Buy now" })).toBeDisabled();
  await expect(box.getByText("Checkout opens soon.")).toBeVisible();
  expect((await one.page.request.post(`/api/catalog/${paidSlug}/enrolment`, { headers: { origin } })).status()).toBe(404);
  await hydrated(anon);
  await shots(anon, "course-paid");

  // The owner hides one review: it leaves the public page, and the average follows.
  await page.goto(`/workspaces/${tenant}/products/${course.id}`);
  await hydrated(page);
  await page.getByRole("button", { name: /Sales page/ }).first().click();
  const reviews = page.locator("[data-slot=sales-page-editor]").getByRole("list", { name: "Reviews" });
  await expect(reviews.getByRole("listitem")).toHaveCount(2);
  await reviews.getByRole("button", { name: /^Hide review by/ }).last().click();
  await expect(reviews.getByText("Hidden", { exact: true })).toHaveCount(1);
  await anon.goto(`/courses/${slug}`);
  await expect(anon.getByText(/out of 5 · 1 review$/).first()).toBeVisible();
  for (const context of [visitor, one.context, two.context, outsider.context]) await context.close();
  expect(errors).toEqual([]);
});
