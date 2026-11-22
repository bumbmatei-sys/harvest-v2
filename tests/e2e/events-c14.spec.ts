import { mkdir, readFile } from "node:fs/promises";
import { expect as base, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// C14 Events screens: member list, calendar and detail (RSVP, waitlist and claim, join window, cancelled), owner form and roster.
// Synthetic data and the local test database only. The placement of an event in a community has no API yet, so the spec writes it with the privileged test connection.
// Pages compile on first use in the dev server, so assertions wait longer than the default.
const expect = base.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const shots = process.env.C14_SHOTS ?? "/tmp/c14-screens-shots";
const day = 86_400_000, hour = 3_600_000;
const local = (ms: number) => new Date(ms).toISOString().slice(0, 16);

async function person(browser: Browser, errors: string[], name: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const email = await signIn(page);
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name, locale: null, cityRegion: null } })).ok()).toBe(true);
  return { context, page, email };
}
async function join(page: Page, slug: string, communityName: string) {
  await page.goto(`/communities/${slug}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Join ${communityName}` });
  await dialog.getByLabel("I confirm I am 18 or older").click();
  await dialog.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/communities/${slug}/forum$`));
}
/** Axe and no sideways scroll in both colour schemes and at 1280 and 360; one screenshot per scheme and width (360 at device scale 2). */
async function audit(page: Page, name: string) {
  const session = await page.context().newCDPSession(page);
  for (const scheme of ["light", "dark"] as const) for (const [width, height, scale] of [[1280, 900, 1], [360, 800, 2]] as const) {
    // The theme follows the system scheme when the page loads, so a scheme change needs a reload.
    if (width === 1280) { await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", scheme); }
    await page.setViewportSize({ width, height });
    await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await settleForAxe(page);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} ${scheme} ${width} overflow`).toBe(true);
    await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true, animations: "disabled" });
  }
  await session.send("Emulation.clearDeviceMetricsOverride");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 900 });
}
/** 44px tap targets, checked at phone width (the shared wizard buttons are compact from 1024px). */
async function tall(locator: ReturnType<Page["locator"]>, min = 44) {
  const page = locator.page();
  await page.setViewportSize({ width: 390, height: 800 });
  for (const item of await locator.all()) {
    if (!(await item.isVisible())) continue; const box = await item.boundingBox(); if (box) expect(box.height, await item.innerText().catch(() => "")).toBeGreaterThanOrEqual(min - 0.5); }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("events: owner form and roster, member list, calendar and detail with RSVP, waitlist, claim, join window and cancellation", async ({ page: owner, browser }) => {
  test.setTimeout(600_000);
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  owner.on("pageerror", (error) => errors.push(error.message));
  await signIn(owner);
  expect((await owner.request.put("/api/account/profile", { headers: { origin }, data: { name: "Grace Owner", locale: null, cityRegion: null } })).ok()).toBe(true);
  const tenant = (await (await owner.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `events-${Date.now().toString(36)}`, api = `/api/workspaces/${tenant}/communities`, name = "Sunday Circle";
  const community = (await (await owner.request.post(api, { headers: { origin }, data: { name, slug } })).json()) as { id: string };
  let current = (await (await owner.request.get(`${api}/${community.id}`)).json()) as { version: number };
  current = await (await owner.request.patch(`${api}/${community.id}`, { headers: { origin }, data: { version: current.version, visibility: "listed", allowOpen: true } })).json();
  expect((await owner.request.post(`${api}/${community.id}/publish`, { headers: { origin }, data: { version: current.version, published: true } })).ok()).toBe(true);

  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  const place = (id: string) => admin.query("insert into community_event_links(tenant_id,event_id,community_id) values ($1,$2,$3) on conflict do nothing", [tenant, id, community.id]);
  const eventsApi = (id: string) => `/api/workspaces/${tenant}/events/${id}`;
  const create = async (id: string, body: Record<string, unknown>) => {
    const saved = await owner.request.put(eventsApi(id), { headers: { origin }, data: { version: 0, description: "", timeZone: "UTC", capacity: null, reminderMinutes: null, joinUrl: null, ...body } });
    expect(saved.ok()).toBe(true);
    await place(id);
    expect((await owner.request.patch(eventsApi(id), { headers: { origin }, data: { action: "publish", version: 1 } })).ok()).toBe(true);
  };
  const m1 = await person(browser, errors, "Andrew Member"), m2 = await person(browser, errors, "Rebecca Member"), outsider = await person(browser, errors, "Nora Outsider");
  const at = (ms: number) => new Date(ms).toISOString();
  try {
    await join(m1.page, slug, name); await join(m2.page, slug, name);
    const now = Date.now(), notFoundText = "This page could not be found";

    // 1. Owner creates the main event in the form, then publishes it.
    let mainId = "";
    await test.step("owner: create, save and publish in the event form", async () => {
      await owner.goto(`/workspaces/${tenant}/events`);
      await expect(owner.getByText("No events yet.")).toBeVisible();
      await owner.getByRole("link", { name: "New event" }).first().click();
      await expect(owner).toHaveURL(/\/events\/new$/);
      await owner.getByLabel("Title").fill("Sunday gathering");
      await owner.getByLabel("Description").fill("Worship, a short message and tea afterwards.");
      await owner.getByRole("button", { name: /Schedule/ }).first().click();
      await owner.getByLabel("Starts").fill(local(now + 3 * day));
      await owner.getByLabel("Ends").fill(local(now + 3 * day + 2 * hour));
      await owner.getByRole("button", { name: /Access/ }).first().click();
      await owner.getByLabel("Join link").fill("https://meet.example.test/sunday");
      await owner.getByLabel("Capacity").fill("1");
      await owner.getByLabel("Reminder").selectOption("60");
      await owner.getByLabel("Capacity").fill("0");
      await owner.getByRole("button", { name: "Save", exact: true }).click();
      await expect(owner.getByText("Enter a whole number above zero.")).toBeVisible();
      await owner.getByLabel("Capacity").fill("1");
      await owner.getByRole("button", { name: "Save", exact: true }).click();
      await expect(owner).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
      mainId = owner.url().split("/").pop()!;
      await expect(owner.getByRole("heading", { name: "Sunday gathering" })).toBeVisible();
      await expect(owner.getByLabel("Join link")).toHaveCount(0);
      await owner.getByRole("button", { name: /Access/ }).first().click();
      await expect(owner.getByLabel("Join link")).toHaveValue("https://meet.example.test/sunday");
      await expect(owner.getByLabel("Capacity")).toHaveValue("1");
      await audit(owner, "owner-form");
      await place(mainId);
      await owner.getByRole("button", { name: "Publish" }).click();
      await expect(owner.getByText("Published.")).toBeVisible();
      await tall(owner.getByRole("main").locator("button"));
    });

    // The other events: a far one with a link, one near enough to ask, one inside its window, and a draft.
    const idFor = () => crypto.randomUUID();
    const far = idFor(), soon = idFor(), live = idFor(), draft = idFor(), cancelled = idFor(), past = idFor();
    await create(far, { title: "Retreat planning", startsAt: at(now + 10 * day), endsAt: at(now + 10 * day + hour), joinUrl: "https://meet.example.test/retreat" });
    await create(soon, { title: "Prayer evening", startsAt: at(now + 20 * hour), endsAt: at(now + 21 * hour), joinUrl: "https://meet.example.test/prayer" });
    await create(live, { title: "Youth night", startsAt: at(now - 5 * 60_000), endsAt: at(now + 2 * hour), joinUrl: "https://meet.example.test/youth" });
    await create(cancelled, { title: "Garden day", startsAt: at(now + 5 * day), endsAt: at(now + 5 * day + 3 * hour) });
    expect((await owner.request.put(eventsApi(draft), { headers: { origin }, data: { version: 0, title: "Secret draft", description: "", timeZone: "UTC", startsAt: at(now + 6 * day), endsAt: at(now + 6 * day + hour), capacity: null, reminderMinutes: null, joinUrl: null } })).ok()).toBe(true);
    await place(draft);
    void past;

    await test.step("member: the upcoming list, the calendar, drafts hidden", async () => {
      await m1.page.goto(`/communities/${slug}/events`);
      const list = m1.page.getByRole("main");
      for (const title of ["Sunday gathering", "Prayer evening", "Youth night", "Retreat planning", "Garden day"]) await expect(list.getByRole("link", { name: new RegExp(title) })).toBeVisible();
      await expect(list.getByText("Secret draft")).toHaveCount(0);
      await expect(list.getByText("1 seat left")).toBeVisible();
      await expect(list.getByText("Happening now")).toBeVisible();
      await audit(m1.page, "member-list");
      await tall(list.getByRole("link"));
      await m1.page.getByRole("link", { name: "Calendar", exact: true }).click();
      await expect(m1.page.getByRole("heading", { name: "Calendar" })).toBeVisible();
      await expect(m1.page.getByRole("button", { name: /\d+ events?, |no events/ }).first()).toBeVisible();
      const cell = m1.page.getByRole("button", { name: new RegExp(`${new Date(now + 3 * day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}, 1 event`) });
      if (await cell.count()) { await cell.first().click(); await expect(m1.page.getByRole("link", { name: /Sunday gathering/ })).toBeVisible(); }
      await audit(m1.page, "member-calendar");
      await tall(m1.page.getByRole("main").getByRole("button"));
    });

    await test.step("member: going, then full for the next member, the waitlist and the claim", async () => {
      await m1.page.goto(`/communities/${slug}/events/${mainId}`);
      await expect(m1.page.getByRole("heading", { name: "Sunday gathering" })).toBeVisible();
      await m1.page.getByRole("button", { name: "Going", exact: true }).click();
      await expect(m1.page.getByRole("button", { name: "Going", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(m1.page.getByText("You are going.")).toBeVisible();
      await expect(m1.page.getByRole("link", { name: "Add to calendar" })).toHaveAttribute("href", `/api/workspaces/${tenant}/events/${mainId}/calendar`);
      expect((await m1.page.request.get(`/api/workspaces/${tenant}/events/${mainId}/calendar`)).headers()["content-type"]).toContain("text/calendar");
      await expect(m1.page.getByRole("button", { name: "Join online" })).toHaveCount(0);
      await audit(m1.page, "event-going");

      await m2.page.goto(`/communities/${slug}/events/${mainId}`);
      await expect(m2.page.getByText("Full", { exact: true })).toBeVisible();
      await expect(m2.page.getByRole("button", { name: "Going", exact: true })).toHaveCount(0);
      await audit(m2.page, "event-full");
      await m2.page.getByRole("button", { name: "Join waitlist" }).click();
      await expect(m2.page.getByText("You are on the waitlist.")).toBeVisible();
      await expect(m2.page.getByRole("button", { name: "Claim seat" })).toHaveCount(0);
      await audit(m2.page, "event-waitlist");

      await m1.page.getByRole("button", { name: "Not going" }).click();
      await expect(m1.page.getByText("You are not going.")).toBeVisible();
      await m2.page.reload();
      await m2.page.getByRole("button", { name: "Claim seat" }).click();
      await expect(m2.page.getByText("You are going.")).toBeVisible();
      await tall(m2.page.getByRole("main").getByRole("button"));
      await tall(m2.page.getByRole("main").getByRole("link"));
    });

    await test.step("member: the join link is requested only inside the window and never shown outside it", async () => {
      await m1.page.goto(`/communities/${slug}/events/${far}`);
      await expect(m1.page.getByRole("button", { name: "Join online" })).toHaveCount(0);
      await expect(m1.page.content()).resolves.not.toContain("meet.example.test");
      await m1.page.goto(`/communities/${slug}/events/${soon}`);
      await m1.page.getByRole("button", { name: "Join online" }).click();
      await expect(m1.page.getByText("The join link is not available right now.")).toBeVisible();
      await expect(m1.page.content()).resolves.not.toContain("meet.example.test");
      await m1.page.goto(`/communities/${slug}/events/${live}`);
      await expect(m1.page.getByText("Happening now")).toBeVisible();
      await m1.page.getByRole("button", { name: "Join online" }).click();
      await expect(m1.page.getByRole("link", { name: "Open meeting" })).toHaveAttribute("href", "https://meet.example.test/youth");
    });

    await test.step("member: cancelled events say so and offer no response; a draft, a stranger and a bad id all 404 alike", async () => {
      expect((await owner.request.patch(eventsApi(cancelled), { headers: { origin }, data: { action: "cancel", version: 2 } })).ok()).toBe(true);
      await m1.page.goto(`/communities/${slug}/events/${cancelled}`);
      await expect(m1.page.getByText("This event was cancelled.")).toBeVisible();
      await expect(m1.page.getByRole("button", { name: "Going", exact: true })).toHaveCount(0);
      await expect(m1.page.getByRole("link", { name: "Add to calendar" })).toHaveCount(0);
      await audit(m1.page, "event-cancelled");
      const answers: string[] = [];
      for (const target of [draft, crypto.randomUUID()]) {
        const response = await m1.page.goto(`/communities/${slug}/events/${target}`);
        await expect(m1.page.getByText(notFoundText)).toBeVisible();
        answers.push(`${response?.status()} ${(await m1.page.locator("body").innerText()).trim()}`);
      }
      expect(answers[0]).toBe(answers[1]);
      expect(answers[0]).toMatch(/^404 /);
      expect((await m1.page.goto(`/communities/${slug}/events/not-a-uuid`))?.status()).toBe(404);
      const stranger = await outsider.page.goto(`/communities/${slug}/events/${mainId}`);
      await expect(outsider.page).toHaveURL(new RegExp(`/communities/${slug}$`));
      expect(stranger?.status()).toBe(200);
      const otherTenant = await owner.goto(`/workspaces/${crypto.randomUUID()}/events/${mainId}`);
      expect(otherTenant?.status()).toBeLessThan(500);
    });

    await test.step("owner: the list shows drafts and the roster shows responses", async () => {
      await owner.goto(`/workspaces/${tenant}/events`);
      await expect(owner.getByText("Secret draft")).toBeVisible();
      await expect(owner.getByText("Draft", { exact: true }).first()).toBeVisible();
      await audit(owner, "owner-list");
      await owner.goto(`/workspaces/${tenant}/events/${mainId}`);
      await owner.getByRole("link", { name: "Roster" }).click();
      const table = owner.getByRole("table", { name: "Roster" });
      await expect(table.getByRole("cell", { name: "Andrew Member" })).toBeVisible();
      await expect(table.getByRole("cell", { name: "Rebecca Member" })).toBeVisible();
      await expect(table.getByText("Going", { exact: true })).toBeVisible();
      await expect(table.getByText("Not going", { exact: true })).toBeVisible();
      await audit(owner, "owner-roster");
      expect((await m1.page.request.get(`/api/workspaces/${tenant}/events/${mainId}/roster`)).status()).toBe(404);
      await m1.page.goto(`/workspaces/${tenant}/events`);
      await expect(m1.page.getByRole("heading", { name: /access/i })).toBeVisible();
    });

    await test.step("owner: cancelling asks first, then locks the form and shows members the cancelled state", async () => {
      await owner.goto(`/workspaces/${tenant}/events/${mainId}`);
      await owner.getByRole("button", { name: /Access/ }).first().click();
      await owner.getByRole("button", { name: "Cancel event" }).click();
      const dialog = owner.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel event" }).click();
      await expect(owner.getByText("A cancelled event cannot be changed.")).toBeVisible();
      await expect(owner.getByLabel("Capacity")).toBeDisabled();
      await m2.page.goto(`/communities/${slug}/events/${mainId}`);
      await expect(m2.page.getByText("This event was cancelled.")).toBeVisible();
    });
    expect(errors).toEqual([]);
  } finally {
    await admin.end();
    await Promise.all([m1.context.close(), m2.context.close(), outsider.context.close()]);
  }
});
