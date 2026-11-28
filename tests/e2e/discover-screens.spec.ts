import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Browser, type Page } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { discoverAdmin } from "./helpers/discover";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Discover screens: public /discover (search, filters, tiles, cards, quick look, report, load more), the owner's List in Discover card and My listings.
// Runs against the disposable database with the unified Discover gate open (non-production). Reviewer decisions are made through the privileged connection (they are ops functions, never a web route).
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const evidence = "docs/screenshots/discover";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const sizes = [[360, 740], [768, 1024], [1280, 900]] as const;

/** axe, no sideways scroll and 44px targets at three widths in both schemes; screenshots for the phone and the desktop widths. */
async function audit(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    // The theme bootstrap reads the scheme when the page loads; set the same attributes it sets so dialogs stay open while the scheme changes.
    await page.evaluate((value) => { const root = document.documentElement; root.dataset.theme = value; root.classList.toggle("dark", value === "dark"); }, scheme);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      // The webpack dev server can reload an open page after it compiles another route ("[Fast Refresh] rebuilding"); measure again after such a reload.
      for (let attempt = 0; ; attempt++) try {
        await settleForAxe(page);
        expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations, `${name} ${width} ${scheme}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width} ${scheme} scroll`).toBe(true);
        break;
      } catch (error) {
        if (attempt >= 2 || !String(error).includes("Execution context was destroyed")) throw error;
        await page.waitForLoadState("load");
      }
      if (width !== 768) await page.screenshot({ path: `${evidence}/${name}-${width}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.evaluate(() => { const root = document.documentElement; root.dataset.theme = "light"; root.classList.remove("dark"); });
  await page.setViewportSize({ width: 1280, height: 900 });
}
/** Visible buttons, links and fields of the main area reach 44px on a phone. */
async function expectTouchTargets(page: Page, scope: string) {
  await page.setViewportSize({ width: 360, height: 740 });
  const small = await page.evaluate((selector) => [...document.querySelectorAll(`${selector} :is(a[href],button,select,input:not([type=hidden]),[role=switch],[role=tab],[role=radio])`)].filter((element) => {
    // A card's title link covers the whole card through its ::after (the kit's stretched link), so its target is the card.
    const stretched = getComputedStyle(element, "::after").position === "absolute" ? element.closest("[data-slot=listing-card]") : null;
    const box = (stretched ?? element).getBoundingClientRect(), style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && !element.closest("[aria-hidden=true]") && (box.height < 43.5 || box.width < 43.5) && !element.classList.contains("sr-only") && element.getAttribute("type") !== "checkbox";
  }).map((element) => `${element.tagName} ${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)} ${Math.round(element.getBoundingClientRect().width)}x${Math.round(element.getBoundingClientRect().height)}`), scope);
  expect(small, "targets under 44px").toEqual([]);
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

test("public Discover, quick look, report, filters, load more and the owner's List in Discover", async ({ page, browser }) => {
  test.setTimeout(420_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [], admin = await discoverAdmin();
  await admin.reset();
  page.on("pageerror", (error) => errors.push(error.message));
  const ownerEmail = await signIn(page);
  void ownerEmail;
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const suffix = Date.now().toString(36), root = `/workspaces/${tenant}`, send = async (method: "post" | "put" | "patch", path: string, data: unknown) => {
    const response = await page.request[method](path, { headers: { origin }, data });
    expect(response.status(), `${method} ${path}`).toBeLessThan(300);
    return (await response.json()) as { id: string; version: number };
  };

  // Seed: one listed community with opt-in, and one published course (no Discover record yet). A product needs an uploaded file, which the browser tests do not seed: products share the course path in the server and unit tests.
  const community = await send("post", `/api/workspaces/${tenant}/communities`, { name: "Grace Bible Study", slug: `grace-study-${suffix}` });
  const c1 = await (await page.request.get(`/api/workspaces/${tenant}/communities/${community.id}`)).json();
  const patched = await send("patch", `/api/workspaces/${tenant}/communities/${community.id}`, { version: c1.version, tagline: "Weekly study and prayer", description: "We read through one book a term.", allowOpen: true, visibility: "listed", discoverOptIn: true, rulesList: ["Be kind."] });
  await send("post", `/api/workspaces/${tenant}/communities/${community.id}/publish`, { version: patched.version, published: true });
  const course = await send("post", `/api/workspaces/${tenant}/catalog`, { kind: "course", slug: `prayer-${suffix}`, title: "Foundations of Prayer", summary: "Six weeks on how to pray.", visibility: "listed", lessons: [{ title: "One", body: lesson, published: true }] });
  await send("put", `/api/workspaces/${tenant}/catalog/${course.id}/state`, { version: course.version, state: "published" });

  // Owner: My listings and the List in Discover card.
  await page.goto(`${root}/discover/manage`);
  await expect(page.getByRole("heading", { name: "Discover", level: 1 })).toBeVisible();
  const table = page.getByRole("table", { name: "Your listings" });
  await expect(table.getByRole("row", { name: /Grace Bible Study/ })).toContainText("In review");
  await expect(table.getByRole("row", { name: /Foundations of Prayer/ })).toContainText("Not listed");
  await expect(page.getByRole("tab", { name: /Courses/ })).toContainText("1");
  await expect(page.getByRole("link", { name: "Browse Discover" })).toHaveAttribute("href", "/discover");
  await hydrated(page);
  await audit(page, "owner-my-listings");
  await expectTouchTargets(page, "main");
  await page.getByRole("button", { name: "Manage Foundations of Prayer" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("List in Discover", { exact: true })).toBeVisible();
  await expect(panel.getByText(/sends an approved listing back to review/)).toBeVisible();
  await panel.getByLabel("Category").selectOption("prayer");
  await expect(panel.getByRole("status")).toHaveText("Saved");
  await panel.getByLabel("Language").selectOption("en");
  await expect(panel.getByRole("status")).toHaveText("Saved");
  await panel.getByRole("switch", { name: "List in Discover" }).click();
  await expect(panel.getByText("In review", { exact: true })).toBeVisible();
  await expect(panel.getByText("Waiting for review. It is not public until approved.")).toBeVisible();
  await audit(page, "owner-card");
  await page.keyboard.press("Escape");
  await expect(table.getByRole("row", { name: /Foundations of Prayer/ })).toContainText("In review");
  // A community's switch lives in its own settings: the panel points there.
  await page.getByRole("button", { name: "Manage Grace Bible Study" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Open community settings" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("switch", { name: "List in Discover" })).toBeDisabled();
  await page.keyboard.press("Escape");
  // The community editor shows the same card in the Joining step (replacing the old checkbox).
  await page.goto(`${root}/communities/${community.id}/edit`);
  await page.getByRole("button", { name: /Joining/ }).first().click();
  const card = page.locator('[data-slot="list-in-discover"]');
  await expect(card.getByRole("switch", { name: "List in Discover" })).toBeChecked();
  await expect(card.getByText("In review", { exact: true })).toBeVisible();
  await card.getByLabel("Category").selectOption("bible_study");
  await expect(card.getByRole("status")).toHaveText("Saved");
  await card.getByLabel("Language").selectOption("en");
  await expect(card.getByRole("status")).toHaveText("Saved");
  await audit(page, "owner-community-card");

  // Public, signed out: nothing is listed until a reviewer approves.
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }), anon = await visitor.newPage();
  anon.on("pageerror", (error) => errors.push(error.message));
  await anon.goto("/discover");
  await expect(anon.getByRole("heading", { name: "Discover", level: 1 })).toBeVisible();
  await expect(anon.getByText("Nothing listed yet")).toBeVisible();
  await expect(anon.getByRole("link", { name: /^Communities/ })).toContainText("0");
  await audit(anon, "public-empty");
  await admin.decide("community", community.id, "approve");
  await admin.decide("course", course.id, "approve");
  await anon.goto("/discover");
  await expect(anon.getByRole("heading", { name: "Grace Bible Study", level: 3 })).toBeVisible();
  await expect(anon.getByRole("heading", { name: "Foundations of Prayer", level: 3 })).toBeVisible();
  await expect(anon.getByText("2 results")).toBeVisible();
  await expect(anon.getByRole("navigation", { name: "Type" }).getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "page");
  await hydrated(anon);
  await audit(anon, "public-results");
  await expectTouchTargets(anon, "main");
  // No identifying data leaks into the page.
  const html = await anon.content();
  expect(html).not.toContain(tenant);

  // Type, category dropdown, language and free filters; search; sort; reset; the URL carries the state.
  await anon.getByRole("navigation", { name: "Type" }).getByRole("link", { name: /^Courses/ }).click();
  await expect(anon).toHaveURL(/type=course/);
  await expect(anon.getByRole("heading", { name: "Grace Bible Study", level: 3 })).toHaveCount(0);
  await expect(anon.getByRole("heading", { name: "Foundations of Prayer", level: 3 })).toBeVisible();
  await anon.getByRole("navigation", { name: "Type" }).getByRole("link", { name: /^Products/ }).click();
  await expect(anon.getByText("No results")).toBeVisible();
  await anon.getByRole("navigation", { name: "Type" }).getByRole("link", { name: /^Courses/ }).click();
  await expect(anon).toHaveURL(/type=course/);
  await expect(anon.getByRole("heading", { name: "Foundations of Prayer", level: 3 })).toBeVisible();
  await hydrated(anon);
  const categories = anon.getByRole("navigation", { name: "Category" }), prices = anon.getByRole("navigation", { name: "Price" });
  await categories.getByRole("button", { name: "Prayer", exact: true }).click();
  await expect(anon).toHaveURL(/category=prayer/);
  await expect(categories.getByRole("button", { name: "Prayer", exact: true })).toHaveAttribute("aria-pressed", "true");
  await anon.getByRole("button", { name: /^Filters/ }).click();
  await anon.getByLabel("Language").selectOption("en");
  await expect(anon).toHaveURL(/language=en/);
  await anon.keyboard.press("Escape");
  await prices.getByRole("button", { name: "Free", exact: true }).click();
  await expect(anon).toHaveURL(/free=1/);
  await expect(anon.getByRole("heading", { name: "Foundations of Prayer", level: 3 })).toBeVisible();
  await expect(anon.getByRole("button", { name: /^Filters, 1 filter active/ })).toBeVisible();
  await audit(anon, "public-filters");
  await anon.getByRole("button", { name: "Remove filter English" }).click();
  await expect(anon).not.toHaveURL(/language=en/);
  await categories.getByRole("button", { name: "All categories" }).click();
  await expect(anon).not.toHaveURL(/category=/);
  await prices.getByRole("button", { name: "Any price" }).click();
  await expect(anon).not.toHaveURL(/free=/);
  await anon.getByRole("navigation", { name: "Type" }).getByRole("link", { name: /^All/ }).click();
  await anon.getByRole("searchbox", { name: "Search Discover" }).fill("zzzz nothing");
  await anon.getByRole("button", { name: "Search", exact: true }).click();
  await expect(anon.getByText("No results")).toBeVisible();
  await audit(anon, "public-no-results");
  await anon.getByRole("link", { name: "Reset filters" }).click();
  await expect(anon.getByRole("heading", { name: "Grace Bible Study", level: 3 })).toBeVisible();
  await anon.getByLabel("Sort by").selectOption("name");
  await expect(anon).toHaveURL(/sort=name/);
  await expect(anon.getByRole("heading", { level: 3 }).filter({ hasText: /Foundations|Grace Bible/ }).first()).toHaveText("Foundations of Prayer");

  // Quick look: a course has no public page; a community links to /communities/:slug.
  await anon.goto("/discover");
  await hydrated(anon);
  await anon.getByRole("button", { name: "More options for Foundations of Prayer" }).click();
  await anon.getByRole("menuitem", { name: "Quick look" }).click();
  const look = anon.getByRole("dialog");
  await expect(look.getByText("Six weeks on how to pray.")).toBeVisible();
  await expect(look.locator("dd", { hasText: "Prayer" })).toBeVisible();
  // Courses and products now have their own public page (#264).
  await expect(look.getByRole("link", { name: "Open page" })).toHaveAttribute("href", /^\/courses\//);
  await audit(anon, "public-quick-look");
  // Signed out, Report offers sign-in instead of the form.
  await look.getByRole("button", { name: "Report" }).click();
  await expect(anon.getByRole("dialog").getByRole("link", { name: "Report", exact: false }).or(anon.getByRole("dialog").getByRole("link", { name: "Sign in to report" }))).toHaveAttribute("href", /\/sign-in\?next=%2Fdiscover/);
  await audit(anon, "public-report-signed-out");
  await anon.keyboard.press("Escape");
  await anon.getByRole("link", { name: "Grace Bible Study", exact: true }).click();
  await expect(anon).toHaveURL(new RegExp(`/communities/grace-study-${suffix}$`));

  // Signed in: report, duplicate, and a rate-limit answer.
  const member = await person(browser);
  member.page.on("pageerror", (error) => errors.push(error.message));
  await member.page.goto("/discover");
  await hydrated(member.page);
  await member.page.getByRole("button", { name: "More options for Grace Bible Study" }).click();
  await member.page.getByRole("menuitem", { name: "Report" }).click();
  const report = member.page.getByRole("dialog");
  await expect(report.getByRole("button", { name: "Send report" })).toBeDisabled();
  await report.getByLabel("Spam").check();
  await report.getByLabel("Note (optional)").fill("Looks like an advertisement.");
  await audit(member.page, "public-report-form");
  await report.getByRole("button", { name: "Send report" }).click();
  await expect(report.getByText("Thank you. We will review it.")).toBeVisible();
  await report.getByRole("button", { name: "Done" }).click();
  await member.page.getByRole("button", { name: "More options for Grace Bible Study" }).click();
  await member.page.getByRole("menuitem", { name: "Report" }).click();
  await member.page.getByRole("dialog").getByLabel("Misleading").check();
  await member.page.getByRole("dialog").getByRole("button", { name: "Send report" }).click();
  await expect(member.page.getByRole("dialog").getByText("You already reported this and it is still open.")).toBeVisible();
  await member.page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await member.page.route("**/api/discover/reports", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Too many" }) }));
  await member.page.getByRole("button", { name: "More options for Foundations of Prayer" }).click();
  await member.page.getByRole("menuitem", { name: "Report" }).click();
  await member.page.getByRole("dialog").getByLabel("Other").check();
  await member.page.getByRole("dialog").getByRole("button", { name: "Send report" }).click();
  await expect(member.page.getByRole("alert").filter({ hasText: "You have sent too many reports today. Try again tomorrow." })).toBeVisible();
  await audit(member.page, "public-report-rate-limited");
  await member.context.close();

  // A material change (the owner changes the category) returns the approved course to review and hides it.
  await page.goto(`${root}/discover/manage`);
  await hydrated(page);
  await page.getByRole("button", { name: "Manage Foundations of Prayer" }).click();
  await page.getByRole("dialog").getByLabel("Category").selectOption("missions");
  await expect(page.getByRole("dialog").getByText("In review", { exact: true })).toBeVisible();
  await anon.goto("/discover");
  await expect(anon.getByRole("heading", { name: "Foundations of Prayer", level: 3 })).toHaveCount(0);
  // Rejected: the owner sees the reason and can send it for review again.
  await admin.decide("course", course.id, "reject", "Needs a clearer summary.");
  await page.reload();
  await hydrated(page);
  await page.getByRole("button", { name: "Manage Foundations of Prayer" }).click();
  await expect(page.getByRole("dialog").getByText("Not approved: Needs a clearer summary.")).toBeVisible();
  await audit(page, "owner-rejected");
  await page.getByRole("dialog").getByRole("button", { name: "Send for review again" }).click();
  await expect(page.getByRole("dialog").getByText("In review", { exact: true })).toBeVisible();
  // The reviewer approves while the panel is still open: the owner's next change is refused as stale, and Reload shows the new state.
  await admin.decide("course", course.id, "approve");
  await page.getByRole("dialog").getByRole("switch", { name: "List in Discover" }).click();
  await expect(page.getByRole("dialog").getByText("This changed elsewhere. Reload and try again.")).toBeVisible();
  await audit(page, "owner-conflict");
  await page.getByRole("dialog").getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("dialog").getByText("Approved", { exact: true })).toBeVisible();
  // Opting out removes it at once and keeps the approval for the same fields.
  await page.getByRole("dialog").getByRole("switch", { name: "List in Discover" }).click();
  await expect(page.getByRole("dialog").getByRole("switch", { name: "List in Discover" })).not.toBeChecked();
  await expect(page.getByRole("dialog").getByText("Approved", { exact: true })).toBeVisible();
  await anon.goto("/discover");
  await expect(anon.getByRole("heading", { name: "Foundations of Prayer", level: 3 })).toHaveCount(0);

  // Load more: 26 approved courses make a second server page.
  for (let n = 1; n <= 26; n++) {
    const slug = `batch-${String(n).padStart(2, "0")}-${suffix}`;
    const item = await send("post", `/api/workspaces/${tenant}/catalog`, { kind: "course", slug, title: `Batch course ${String(n).padStart(2, "0")}`, summary: "Part of a set.", visibility: "listed", lessons: [{ title: "One", body: lesson, published: true }] });
    await send("put", `/api/workspaces/${tenant}/catalog/${item.id}/state`, { version: item.version, state: "published" });
    const fresh = await (await page.request.get(`/api/workspaces/${tenant}/discover/listings`)).json() as { items: { id: string; version: number }[] };
    await send("patch", `/api/workspaces/${tenant}/discover/listings/course/${item.id}`, { version: fresh.items.find((entry) => entry.id === item.id)?.version ?? 0, optIn: true, category: "service", language: "en" });
    await admin.decide("course", item.id, "approve");
  }
  await anon.goto("/discover?sort=name&type=course");
  await hydrated(anon);
  await expect(anon.getByRole("heading", { level: 3 }).filter({ hasText: "Batch course" })).toHaveCount(24);
  await expect(anon.getByText("26 results")).toBeVisible();
  await anon.getByRole("button", { name: "Load more" }).click();
  await expect(anon.getByRole("heading", { level: 3 }).filter({ hasText: "Batch course" })).toHaveCount(26);
  await expect(anon.getByRole("button", { name: "Load more" })).toHaveCount(0);
  // A failed page shows a retry, not a broken grid.
  await anon.goto("/discover?sort=name&type=course");
  await hydrated(anon);
  await anon.route("**/api/discover/listings*", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await anon.getByRole("button", { name: "Load more" }).click();
  await expect(anon.getByRole("alert").filter({ hasText: "Could not load more results." })).toBeVisible();
  await audit(anon, "public-load-failed");
  await visitor.close();
  await admin.end();
  expect(errors).toEqual([]);
});
