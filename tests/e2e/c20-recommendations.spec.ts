import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { discoverAdmin } from "./helpers/discover";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// C20: Discover "Recommended" and the QR page's recommended community (editor picker, guest card, normal join, count on the QR list). Synthetic data only.
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce", viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const evidence = "docs/screenshots/c20";
const axeTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function scheme(page: Page, value: "light" | "dark") {
  await page.emulateMedia({ colorScheme: value, reducedMotion: "reduce" });
  await page.evaluate((v) => { const root = document.documentElement; root.dataset.theme = v; root.classList.toggle("dark", v === "dark"); }, value);
}
/** axe, no sideways scroll and 44px targets inside `scope` below 1024px; then a 2x screenshot. */
async function shot(page: Page, name: string, width: number, value: "light" | "dark", scope = "main", folder = evidence) {
  await page.setViewportSize({ width, height: width < 1024 ? 740 : 900 });
  await scheme(page, value);
  await settleForAxe(page);
  expect((await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations, `${name} ${width} ${value}`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width} ${value} scroll`).toBe(true);
  if (width < 1024) {
    const small = await page.evaluate((selector) => [...document.querySelectorAll(`${selector} :is(a[href],button,select,input:not([type=hidden]))`)].filter((element) => {
      // A card's title link covers the whole card through its ::after (the kit's stretched link), so its target is the card.
      const stretched = getComputedStyle(element, "::after").position === "absolute" ? element.closest("[data-slot=listing-card]") : null;
      const box = (stretched ?? element).getBoundingClientRect(), style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && !element.closest("[aria-hidden=true]") && (box.height < 43.5 || box.width < 43.5) && !element.classList.contains("sr-only") && element.getAttribute("type") !== "checkbox";
    }).map((element) => `${element.tagName} ${(element.textContent ?? "").trim().slice(0, 30)}`), scope);
    expect(small, `${name} targets under 44px`).toEqual([]);
  }
  await page.screenshot({ path: `${folder}/${name}-${width}-${value}.png`, fullPage: true });
}

async function visit(page: Page, url: string) {
  try { await page.goto(url); } catch (error) { if (!String(error).includes("ERR_ABORTED")) throw error; await page.goto(url); }
}

test("Discover recommendations, the QR page's recommended community, a normal join and the count", async ({ page, browser }) => {
  test.setTimeout(420_000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [], admin = await discoverAdmin();
  await admin.reset();
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const suffix = Date.now().toString(36);
  const send = async (method: "post" | "patch", path: string, data: unknown, headers: Record<string, string> = {}) => {
    const response = await page.request[method](path, { headers: { origin, ...headers }, data });
    expect(response.status(), `${method} ${path}`).toBeLessThan(300);
    return (await response.json()) as { id: string; version: number };
  };
  async function community(name: string, slug: string, tagline: string, category: string, visibility: "listed" | "hidden" = "listed") {
    const created = await send("post", `/api/workspaces/${tenant}/communities`, { name, slug });
    const current = await (await page.request.get(`/api/workspaces/${tenant}/communities/${created.id}`)).json();
    const patched = await send("patch", `/api/workspaces/${tenant}/communities/${created.id}`, { version: current.version, tagline, description: "We meet every week.", allowOpen: true, visibility, discoverOptIn: visibility === "listed", rulesList: [] });
    await send("post", `/api/workspaces/${tenant}/communities/${created.id}/publish`, { version: patched.version, published: true });
    if (visibility === "listed") {
      const listings = await (await page.request.get(`/api/workspaces/${tenant}/discover/listings`)).json() as { items: { id: string; version: number }[] };
      await send("patch", `/api/workspaces/${tenant}/discover/listings/community/${created.id}`, { version: listings.items.find((i) => i.id === created.id)?.version ?? 0, category, language: "en" });
      expect(await admin.decide("community", created.id, "approve")).toBe("approved");
    }
    return created.id;
  }
  const prayerSlug = `prayer-${suffix}`;
  const prayer = await community("Prayer Circle", prayerSlug, "Pray together each week", "prayer");
  await community("Morning Prayer", `morning-${suffix}`, "Short prayers before work", "prayer");
  await community("Bible Study", `study-${suffix}`, "Read one book a term", "bible_study");
  await community("Worship Night", `worship-${suffix}`, "Songs and prayer on Fridays", "worship");
  await community("Leaders Room", `leaders-${suffix}`, "For team leads only", "leadership", "hidden");
  // Shelves show only with enough listings (src/lib/discover-shelves.ts): eight more approved communities make twelve.
  for (let n = 1; n <= 8; n++) await community(`Serve Team ${n}`, `serve-${n}-${suffix}`, "Serve on Sundays", "service");

  // Owner: QR page with a recommended community.
  const campaign = (await send("post", `/api/workspaces/${tenant}/campaigns`, { name: "Welcome Evening", type: "conference" }, { "Idempotency-Key": randomUUID() })).id;
  const root = `/workspaces/${tenant}/campaigns/${campaign}/connect`, api = `/api${root}`;
  const link = await send("post", `${api}/links`, { label: "Welcome table" }) as unknown as { id: string; publicCode: string };
  await send("post", `${api}/links/${link.id}/actions`, { action: "publish" });
  await page.goto(`${root}/${link.id}/landing`);
  const picker = page.getByLabel("Recommended community", { exact: true });
  await expect(picker.locator("option")).toHaveText(["None", "Bible Study", "Morning Prayer", "Prayer Circle", ...Array.from({ length: 8 }, (_, n) => `Serve Team ${n + 1}`), "Worship Night"]);
  await picker.selectOption({ label: "Prayer Circle" });
  const preview = page.getByRole("region", { name: "Preview your page", exact: true });
  await expect(preview.getByRole("heading", { name: "Prayer Circle", exact: true })).toBeVisible();
  await expect(preview.getByRole("button", { name: "View community" })).toBeDisabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved privately." })).toBeVisible();
  await page.getByRole("button", { name: "Publish changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changes published." })).toBeVisible();
  await picker.scrollIntoViewIfNeeded();
  await shot(page, "editor-picker", 1280, "light");
  await scheme(page, "light");

  // Guest (signed out): the card comes after the free resources and only links to the community page.
  const guestContext = await browser.newContext({ viewport: { width: 360, height: 740 }, reducedMotion: "reduce", deviceScaleFactor: 2 }), guest = await guestContext.newPage();
  guest.on("pageerror", (error) => errors.push(error.message));
  await guest.goto(`/c/${link.publicCode}`);
  const card = guest.locator("[data-slot=landing-community]");
  await expect(card.getByRole("heading", { name: "Prayer Circle" })).toBeVisible();
  await expect(card.getByText("Optional community")).toBeVisible();
  const view = card.getByRole("link", { name: "View community" });
  await expect(view).toHaveAttribute("href", `/communities/${prayerSlug}?qr=${link.publicCode}`);
  // After the free resources: the free resources card precedes the community card in the page order.
  expect(await guest.evaluate(() => {
    const free = [...document.querySelectorAll("a[href='/resources/start']")].at(-1)!, community = document.querySelector("[data-slot=landing-community]")!;
    return Boolean(free.compareDocumentPosition(community) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  for (const value of ["light", "dark"] as const) await shot(guest, "landing-community", 360, value);
  await scheme(guest, "light");
  // Follow the card's own link. A first dev compile can reload the page and abort a navigation (the same retry as the other community specs).
  await visit(guest, (await view.getAttribute("href"))!);
  await expect(guest).toHaveURL(new RegExp(`/communities/${prayerSlug}\\?qr=${link.publicCode}$`));
  // No auto-join: the page offers the normal Join step, signed out it asks to sign in and keeps the QR code through sign-in.
  await expect(guest.getByRole("link", { name: "Join", exact: true })).toHaveAttribute("href", `/sign-in?personal=1&next=${encodeURIComponent(`/communities/${prayerSlug}?qr=${link.publicCode}`)}`);
  await guestContext.close();

  // A signed-in person joins through the normal join dialog from the QR page link.
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }), member = await memberContext.newPage();
  member.on("pageerror", (error) => errors.push(error.message));
  await signIn(member);
  await visit(member, `/communities/${prayerSlug}?qr=${link.publicCode}`);
  await member.getByRole("button", { name: "Join", exact: true }).click();
  const dialog = member.getByRole("dialog", { name: "Join Prayer Circle" });
  await dialog.getByLabel("I confirm I am 18 or older").click();
  await dialog.getByRole("button", { name: "Join", exact: true }).click();
  // First dev compiles of the join route and the forum can be slow.
  await expect(member).toHaveURL(new RegExp(`/communities/${prayerSlug}/forum`), { timeout: 150_000 });
  expect((await admin.q<{ n: number }>("select coalesce(sum(joins),0)::int n from connect_community_join_counts where link_id = $1", [link.id]))[0].n).toBe(1);

  // Discover: the Picks shelf for the member puts the other prayer community first and leaves out the one they joined; the hidden one never appears.
  await visit(member, "/discover");
  const recommended = member.locator("[data-slot=discover-recommended]");
  await expect(recommended.getByRole("heading", { name: "Picks", level: 2 })).toBeVisible();
  await expect(recommended.getByText("Based on what you joined")).toBeVisible();
  await expect(recommended.locator("[data-slot=listing-card] h3").first()).toHaveText("Morning Prayer");
  await expect(recommended.getByText("Prayer Circle", { exact: true })).toHaveCount(0);
  await expect(member.getByText("Leaders Room")).toHaveCount(0);
  await memberContext.close();

  // Signed out: a non-personal order (most recent public change first), still without hidden items.
  const anonContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 2 }), anon = await anonContext.newPage();
  anon.on("pageerror", (error) => errors.push(error.message));
  await visit(anon, "/discover");
  const anonRecommended = anon.locator("[data-slot=discover-recommended]");
  await expect(anonRecommended.locator("[data-slot=listing-card]")).toHaveCount(8);
  // Every community is free, so "Free to start" would repeat the grid and is left out.
  await expect(anon.locator("[data-slot=discover-free]")).toHaveCount(0);
  await expect(anon.getByText("Leaders Room")).toHaveCount(0);
  for (const width of [360, 1280]) for (const value of ["light", "dark"] as const) await shot(anon, "discover-recommended", width, value);
  // Discover redesign evidence (phone 390, desktop 1440, both schemes, 2x): shelves, chip rows and the All grid; then a card menu open.
  await mkdir("docs/screenshots/discover-v2", { recursive: true });
  for (const width of [390, 1440]) for (const value of ["light", "dark"] as const) await shot(anon, "discover", width, value, "main", "docs/screenshots/discover-v2");
  await anon.getByRole("button", { name: "Next in Picks" }).click();
  await expect(anon.getByRole("button", { name: "Previous in Picks" })).toBeEnabled();
  await anon.locator("section[aria-labelledby=discover-all]").getByRole("button", { name: /^More options for / }).first().click();
  await expect(anon.getByRole("menuitem", { name: "Quick look" })).toBeVisible();
  await anon.screenshot({ path: "docs/screenshots/discover-v2/card-menu-1440-dark.png" });
  await anon.keyboard.press("Escape");
  await visit(anon, "/discover?category=service");
  await expect(anon.locator("[data-slot=discover-recommended]")).toHaveCount(0);
  for (const width of [390, 1440]) for (const value of ["light", "dark"] as const) await shot(anon, "discover-filtered", width, value, "main", "docs/screenshots/discover-v2");
  // A search or filter shows results only.
  await visit(anon, "/discover?q=prayer");
  await expect(anon.locator("[data-slot=discover-recommended]")).toHaveCount(0);
  await anonContext.close();

  // Owner: the QR list shows the count with the small-group rule (1 to 4 is withheld).
  await page.goto(root);
  await expect(page.locator("[data-slot=community-joins]")).toHaveText("Fewer than 5 joined from this QR page");

  // Hiding the community removes the card from the guest page at once.
  const current = await (await page.request.get(`/api/workspaces/${tenant}/communities/${prayer}`)).json();
  await send("patch", `/api/workspaces/${tenant}/communities/${prayer}`, { version: current.version, visibility: "hidden", discoverOptIn: false });
  const after = await browser.newContext(), afterPage = await after.newPage();
  await visit(afterPage, `/c/${link.publicCode}`);
  await expect(afterPage.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(afterPage.locator("[data-slot=landing-community]")).toHaveCount(0);
  await after.close();
  await admin.end();
  expect(errors).toEqual([]);
});
