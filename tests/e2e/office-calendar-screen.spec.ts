import { mkdir } from "node:fs/promises";
import { expect as base, test, type Browser, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Office Calendar screen against the real Office routes with the non-production fake provider (one synthetic sample event), and against a stubbed connection for
// several calendars, all-day events, the social overlay, partial pages, failures and the reconnect and attention states. Creating, editing and deleting events are
// hard-off: every test records the Office requests and asserts that no calendar write is ever sent.
const expect = base.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });
const shots = process.env.OFFICE_CALENDAR_SHOTS ?? "docs/screenshots/office-calendar";
const off = process.env.HARVEST_SHELL_MODES === "disabled";
const writes = ["createEvent", "updateEvent", "deleteEvent"];

async function ministry(page: Page, name: string) {
  const response = await page.request.post("/api/workspaces", { headers: { origin }, data: { name, audience: "church" } });
  expect(response.status()).toBe(201);
  return (await response.json()).tenantId as string;
}
async function guest(browser: Browser) {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  const email = await signIn(page);
  return { context, page, email };
}

/** Every scene is checked at 1280, 768 and 360 in both schemes, once loaded: WCAG 2.2 AA through axe, no horizontal overflow, and a screenshot. */
async function audit(page: Page, name: string, ready: () => Promise<void>, restore: () => Promise<void> = async () => {}) {
  const session = await page.context().newCDPSession(page);
  for (const scheme of ["light", "dark"] as const) for (const [width, height] of [[1280, 900], [768, 900], [360, 800]] as const) {
    if (width === 1280) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.setViewportSize({ width, height }); await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme); await restore();
    }
    await page.setViewportSize({ width, height });
    await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await ready();
    await expect(page.locator('[data-slot="skeleton"], [aria-busy="true"]'), `${name} ${scheme} ${width} still loading`).toHaveCount(0);
    await settleForAxe(page);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} ${scheme} ${width} overflow`).toBe(true);
    await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true, animations: "disabled" });
  }
  await session.send("Emulation.clearDeviceMetricsOverride");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Records every Office action the page sends, so a test can prove which were never made. */
function recordActions(page: Page) {
  const actions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/workspaces\/[^/]+\/office$/.test(new URL(request.url()).pathname)) actions.push((request.postDataJSON() as { action: string }).action);
  });
  return actions;
}

test("office calendar: connect, views, detail, person link, disabled writes, keyboard and disconnect (fake provider)", async ({ page }) => {
  test.setTimeout(900_000);
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const actions = recordActions(page);
  await signIn(page);
  const tenant = await ministry(page, "Grace Community Church");
  const api = `/api/workspaces/${tenant}`, calendar = `/workspaces/${tenant}/calendar`;

  // ---- Not connected: the notice and one button per provider, never a calendar ---------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(calendar);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  const connect = page.getByTestId("calendar-connect");
  await expect(connect).toHaveAttribute("data-state", "connect");
  await expect(page.getByTestId("connect-notice")).toContainText("Only you can access this connection in Harvest");
  await expect(connect.getByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
  await expect(connect.getByRole("button", { name: "Connect Outlook" })).toBeVisible();
  await expect(page.getByTestId("calendar")).toHaveCount(0);
  await audit(page, "connect", async () => { await expect(connect).toBeVisible(); });

  // ---- Connect: the month opens with the sample event -----------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(calendar);
  await page.getByTestId("connect-google").click();
  await expect(page.getByTestId("calendar")).toBeVisible();
  expect(actions).toEqual(expect.arrayContaining(["startConnect", "finishConnect"]));
  await expect(page.getByTestId("account-chip")).toContainText("Google Calendar");
  await expect(page.getByTestId("calendar-title")).toContainText(String(new Date().getFullYear()));
  await expect(page.locator("[data-slot='month-view']")).toContainText("Planning meeting");
  // One calendar and no overlay: a single source, so no chips and no marks on the events.
  await expect(page.getByTestId("source-filter")).toHaveCount(0);
  await audit(page, "month", async () => { await expect(page.locator("[data-slot='month-view']")).toContainText("Planning meeting"); });

  // ---- The sidebar link and the other views ---------------------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(calendar);
  if (!off) await expect(page.locator('[data-sidebar="menu-button"][href$="/calendar"]')).toBeVisible();
  await page.getByTestId("view-week").click();
  await expect(page).toHaveURL(/view=week/);
  await expect(page.locator("[data-slot='week-view']")).toBeVisible();
  await page.getByTestId("view-day").click();
  await expect(page.locator("[data-slot='week-view']")).toBeVisible();
  await page.getByTestId("view-agenda").click();
  const row = page.getByTestId("agenda-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Planning meeting");
  await audit(page, "agenda", async () => { await expect(row).toBeVisible(); });

  // ---- Event detail: time, calendar, no join link from this provider --------------------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  await row.click();
  const panel = page.getByTestId("event-panel");
  await expect(panel.getByTestId("detail-title")).toHaveText("Planning meeting");
  await expect(panel.getByTestId("detail-when")).toContainText(":");
  await expect(panel.getByTestId("attendees")).toContainText("participant@example.test");
  await expect(panel.getByTestId("join-link")).toHaveCount(0);
  // Edit and Delete exist, disabled, with the one short notice.
  await expect(panel.getByTestId("event-edit")).toBeDisabled();
  await expect(panel.getByTestId("event-delete")).toBeDisabled();
  await expect(panel.getByTestId("writes-note")).toHaveText("Creating and editing events isn't available yet");
  await audit(page, "detail", async () => { await page.getByTestId("view-agenda").click().catch(() => undefined); await row.click().catch(() => undefined); await expect(panel.getByTestId("detail-title")).toBeVisible(); }, async () => { await expect(row).toBeVisible(); });

  // ---- Link the event to a CRM person: an explicit reference, no contact created, no event title stored -----------------------------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${calendar}?view=agenda`);
  await row.click();
  const person = await (await page.request.post(`${api}/contacts`, { headers: { origin }, data: { name: "Synthetic Grace Okafor", email: "grace.okafor@example.test" } })).json() as { id: string };
  await panel.getByTestId("person-link").click();
  await page.getByPlaceholder("Search people").fill("Okafor");
  await page.getByRole("option", { name: /Synthetic Grace Okafor/ }).click();
  await expect(panel.getByTestId("person-chip")).toContainText("Linked to Synthetic Grace Okafor");
  const overview = await (await page.request.get(`${api}/office`)).json() as { connections: { id: string; kind: string; platform: string; health: string; capabilities: Record<string, string> }[] };
  const connection = overview.connections.find((item) => item.kind === "calendar")!;
  expect(connection).toMatchObject({ platform: "google", health: "healthy" });
  expect(connection.capabilities).toMatchObject({ events: "available", availability: "available", createEvent: "disabled", updateEvent: "disabled", deleteEvent: "disabled" });
  const refs = await (await page.request.post(`${api}/office`, { headers: { origin }, data: { action: "contactReferences", connectionId: connection.id, input: { contactId: person.id } } })).json() as { data: { items: { ref: string; kind: string; name: string | null }[] } };
  expect(refs.data.items).toEqual([expect.objectContaining({ ref: "sample-event", kind: "event", name: null })]);
  expect(JSON.stringify(refs)).not.toContain("Planning meeting");
  await panel.getByTestId("person-unlink").click();
  await expect(panel.getByTestId("person-link")).toBeVisible();
  const after = await (await page.request.post(`${api}/office`, { headers: { origin }, data: { action: "contactReferences", connectionId: connection.id, input: { contactId: person.id } } })).json() as { data: { items: unknown[] } };
  expect(after.data.items).toHaveLength(0);
  expect(((await (await page.request.get(`${api}/contacts`)).json()) as { total: number }).total).toBe(1);
  await page.getByTestId("detail-close").click();

  // ---- New event: the form is in place and entirely disabled; attendees and the meeting link stay off ------------------------------------------------
  await page.getByTestId("new-event").click();
  const form = page.getByTestId("event-form");
  await expect(form.getByTestId("form-writes-note")).toHaveText("Creating and editing events isn't available yet");
  for (const label of ["Title", "Notes", "Start date", "Start time", "End date", "End time", "Location"]) await expect(form.getByLabel(label, { exact: true })).toBeDisabled();
  await expect(form.getByLabel("Time zone")).toBeDisabled();
  await expect(form.getByLabel("Calendar", { exact: true })).toBeDisabled();
  await expect(form.getByTestId("form-attendees")).toBeDisabled();
  await expect(form.getByTestId("form-meeting")).toBeDisabled();
  await expect(form.getByTestId("form-save")).toBeDisabled();
  await audit(page, "form", async () => { if (!(await form.isVisible())) await page.getByTestId("new-event").click(); await expect(form).toBeVisible(); });
  await page.keyboard.press("Escape");

  // ---- Availability ---------------------------------------------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${calendar}?view=availability`);
  await expect(page.getByTestId("availability")).toBeVisible();
  await expect(page.getByTestId("slot").first()).toBeVisible();
  await page.getByTestId("availability-length").selectOption("60");
  await expect(page.getByTestId("slot").first()).toBeVisible();
  await audit(page, "availability", async () => { await expect(page.getByTestId("slot").first()).toBeVisible(); });

  // ---- Keyboard: the view switch and the event row work without a pointer ---------------------------------------------------------------------------
  await page.goto(calendar);
  await page.getByTestId("view-day").focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/view=day/);
  await page.getByTestId("view-agenda").focus(); await page.keyboard.press("Enter");
  await row.focus(); await page.keyboard.press("Enter");
  await expect(panel.getByTestId("detail-title")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // ---- Disconnect -----------------------------------------------------------------------------------------------------------------------------------
  await page.getByTestId("disconnect").click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).last().click();
  await expect(page.getByTestId("calendar-connect")).toBeVisible();
  expect(((await (await page.request.get(`${api}/office`)).json()) as { connections: unknown[] }).connections).toHaveLength(0);

  // ---- Hard-off: no calendar write request was ever made ---------------------------------------------------------------------------------------------
  expect(actions.filter((action) => writes.includes(action))).toEqual([]);
  expect(errors).toEqual([]);
});

test("office calendar: another admin never sees this admin's connection; members and strangers get the neutral answer", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await signIn(page);
  const tenant = await ministry(page, "Grace Community Church"), api = `/api/workspaces/${tenant}`, calendar = `/workspaces/${tenant}/calendar`;
  const admin = await guest(browser), member = await guest(browser), stranger = await guest(browser);
  expect((await page.request.put(`${api}/members`, { headers: { origin }, data: { email: admin.email, role: "admin" } })).status()).toBe(200);
  expect((await page.request.put(`${api}/members`, { headers: { origin }, data: { email: member.email, role: "member" } })).status()).toBe(200);

  await page.goto(calendar);
  await page.getByTestId("connect-google").click();
  await expect(page.getByTestId("calendar")).toBeVisible();
  const mine = ((await (await page.request.get(`${api}/office`)).json()) as { connections: { id: string }[] }).connections[0].id;
  const window = { start: new Date().toISOString(), end: new Date(Date.now() + 7 * 86_400_000).toISOString() };

  await admin.page.goto(calendar);
  await expect(admin.page.getByTestId("calendar-connect")).toBeVisible();
  await expect(admin.page.getByTestId("calendar")).toHaveCount(0);
  await expect(admin.page.getByText("Planning meeting")).toHaveCount(0);
  expect(((await (await admin.page.request.get(`${api}/office`)).json()) as { connections: unknown[] }).connections).toHaveLength(0);
  expect((await admin.page.request.post(`${api}/office`, { headers: { origin }, data: { action: "events", connectionId: mine, input: window } })).status()).toBe(404);
  expect((await admin.page.request.post(`${api}/office`, { headers: { origin }, data: { action: "event", connectionId: mine, input: { eventRef: "sample-event" } } })).status()).toBe(404);
  // The server refuses calendar writes for the owner too: hard-off.
  const refused = await page.request.post(`${api}/office`, { headers: { origin }, data: { action: "createEvent", connectionId: mine, input: { event: { title: "x", start: window.start, end: window.end, attendees: [] }, requestId: crypto.randomUUID() } } });
  expect((await refused.json()).state).toBe("disabled");
  await page.reload(); await expect(page.getByTestId("calendar")).toBeVisible();

  for (const person of [member, stranger]) {
    await person.page.goto(calendar);
    await expect(person.page.getByTestId("calendar")).toHaveCount(0);
    await expect(person.page.getByTestId("calendar-connect")).toHaveCount(0);
    await expect(person.page.getByRole("heading", { name: /workspace|available|access|ministry/i }).first()).toBeVisible();
    expect((await person.page.request.get(`${api}/office`)).status()).toBe(404);
  }
  await member.page.goto(`/workspaces/${tenant}/crm/people`);
  await expect(member.page.getByRole("link", { name: "Calendar", exact: true })).toHaveCount(0);
  await Promise.all([admin.context.close(), member.context.close(), stranger.context.close()]);
});

// ---- Stubbed states: several calendars, all-day, meeting links, the social overlay, partial pages, failures, reconnect and attention -------------------------
type Stub = { overview: unknown; handle: (action: string, body: Record<string, unknown>) => unknown };
async function stubOffice(page: Page, stub: Stub) {
  await page.route(/\/api\/workspaces\/[^/]+\/office$/, async (route: Route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stub.overview) });
    const body = request.postDataJSON() as { action: string; input: Record<string, unknown> };
    const result = stub.handle(body.action, body.input);
    if (typeof result === "number") return route.fulfill({ status: result, contentType: "application/json", body: JSON.stringify({ error: "stub" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
}
const caps = { calendars: "available", events: "available", event: "available", freeBusy: "available", availability: "available", createEvent: "disabled", updateEvent: "disabled", deleteEvent: "disabled" };
const conn = (health = "healthy", platform: string | null = "microsoft", grants = 2) => ({ id: "22222222-2222-4222-8222-222222222222", kind: "calendar", platform, health, grants, noticeVersion: 1, capabilities: caps });
const overview = (...connections: unknown[]) => ({ notice: { key: "Office.personalConnectionNotice", version: 1 }, connections });
const at = (days: number, hour: number, minutes = 0) => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hour, minutes, 0, 0); return date.toISOString(); };
const day = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

test("office calendar: calendars, source chips and marks, all-day, meeting link, social overlay, partial, failures, reconnect and attention (stubbed)", async ({ page }) => {
  test.setTimeout(900_000);
  await mkdir(shots, { recursive: true });
  await signIn(page);
  const tenant = await ministry(page, "Hope Outreach"), calendar = `/workspaces/${tenant}/calendar`;
  const actions = recordActions(page);
  const state = { fail: false, partial: true, health: "healthy" as string, planner404: false, plannerFail: false };
  const event = (ref: string, calendarRef: string, title: string, start: string, end: string, extra = {}) => ({ ref, calendarRef, title, start, end, attendees: ["pat@example.test"], meetingLink: null, ...extra });
  await stubOffice(page, {
    get overview() { return overview(conn(state.health, "microsoft", state.health === "reconnect_needed" ? 0 : 2)); },
    handle: (action, input) => {
      switch (action) {
        case "calendars": return { state: "available", data: { items: [{ ref: "main", name: "Ministry calendar", primary: true }, { ref: "staff", name: "Staff meetings" }] } };
        case "events": {
          if (state.fail) return { state: "temporarily_unavailable" };
          if (input.cursor === "p2") return { state: "available", data: { items: [event("e4", "staff", "Prayer walk", at(0, 17), at(0, 18)), event("e1", "main", "Elders meeting", at(0, 10), at(0, 11))], nextCursor: null } };
          return { state: "available", data: { items: [
            event("e1", "main", "Elders meeting", at(0, 10), at(0, 11), { meetingLink: "https://teams.example.test/join/1", meetingKind: "teams", description: "Agenda attached." }),
            event("e2", "staff", "Staff lunch", at(0, 12), at(0, 13)),
            event("e3", "main", "Retreat", day(0), day(3), { allDay: true }),
          ], nextCursor: "p2", partial: state.partial } };
        }
        case "availability": return { state: "available", data: { items: [{ start: at(1, 9), end: at(1, 9, 30) }, { start: at(1, 14), end: at(1, 14, 30) }], partial: false } };
        case "eventLink": return { state: "available", data: { ref: String(input.eventRef), kind: "event", name: null, startsAt: null, endsAt: null } };
        default: return 404;
      }
    },
  });
  await page.route(/\/api\/workspaces\/[^/]+\/social\/planner\?/, async (route) => {
    if (state.planner404) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    if (state.plannerFail) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    const item = { id: "33333333-3333-4333-8333-333333333333", draftId: null, connectionId: null, scheduleId: null, platform: "instagram", version: 1, deliveryVersion: 1, status: "scheduled", at: at(0, 15), displayTimezone: "UTC", type: "post", summary: "Sunday service reminder", lastErrorCode: null, scheduledFor: at(0, 15), publishedAt: null, retryable: false, day: day(0), week: day(0) };
    const draft = { ...item, id: "44444444-4444-4444-8444-444444444444", status: "draft", summary: "A draft that must not show" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ days: { [day(0)]: [item, draft] }, weeks: {}, timezone: "UTC", nextCursor: null }) });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${calendar}?view=week`);

  // Two calendars: chips with small marks; paging is followed and not duplicated; the partial notice is shown.
  const chips = page.getByTestId("source-filter");
  await expect(chips).toBeVisible();
  await expect(chips.getByTestId("source-all")).toHaveAttribute("aria-pressed", "true");
  await expect(chips.locator("[data-source-logo='outlook-calendar']")).toHaveCount(2);
  await expect(page.getByTestId("partial-notice")).toBeVisible();
  await expect(page.getByText("Elders meeting")).toHaveCount(1);
  await expect(page.getByText("Prayer walk")).toBeVisible();
  await expect(page.getByTestId("all-day-row")).toContainText("Retreat");
  await expect(page.locator("[data-source-logo='outlook-calendar']").nth(2)).toBeVisible();
  await audit(page, "week-sources", async () => { await expect(page.getByText("Prayer walk")).toBeVisible(); });

  // Filter by one calendar, then back to All.
  await page.setViewportSize({ width: 1280, height: 900 });
  await chips.getByTestId("source-cal:staff").click();
  await expect(chips.getByTestId("source-cal:staff")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Staff lunch")).toBeVisible();
  await expect(page.getByText("Elders meeting")).toHaveCount(0);
  await chips.getByTestId("source-all").click();
  await expect(page.getByText("Elders meeting")).toBeVisible();

  // Detail with a meeting link (provider supplied) and the join control; person link posts only an explicit reference.
  await page.getByText("Elders meeting").click();
  const panel = page.getByTestId("event-panel");
  await expect(panel.getByTestId("join-link")).toHaveAttribute("href", "https://teams.example.test/join/1");
  await expect(panel.getByTestId("meeting-kind")).toHaveText("Microsoft Teams");
  await expect(panel.getByTestId("detail-notes")).toHaveText("Agenda attached.");
  await expect(panel.locator("[data-source-logo='outlook-calendar']")).toBeVisible();
  await audit(page, "detail-meeting", async () => { if (!(await panel.isVisible())) await page.getByText("Elders meeting").click(); await expect(panel.getByTestId("join-link")).toBeVisible(); });
  await page.getByTestId("detail-close").click();

  // Social overlay: read only, platform mark, short title, planner link; drafts never show; the toggle is the URL.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${calendar}?view=agenda`);
  await expect(page.getByText("Sunday service reminder")).toHaveCount(0);
  await page.getByTestId("social-toggle").click();
  await expect(page).toHaveURL(/social=1/);
  await expect(page.getByText("Sunday service reminder")).toBeVisible();
  await expect(page.getByText("A draft that must not show")).toHaveCount(0);
  await expect(chips.getByTestId("source-social")).toContainText("Social posts");
  await page.getByText("Sunday service reminder").click();
  await expect(panel.getByTestId("open-planner")).toHaveAttribute("href", new RegExp(`/workspaces/${tenant}/social/planner\\?view=calendar`));
  await expect(panel.getByText("Scheduled post, read only")).toBeVisible();
  await expect(panel.getByTestId("event-edit")).toHaveCount(0);
  await audit(page, "agenda-social", async () => { await expect(page.getByText("Sunday service reminder")).toBeVisible(); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await chips.getByTestId("source-social").click();
  await expect(page.getByText("Elders meeting")).toHaveCount(0);
  await expect(page.getByText("Sunday service reminder")).toBeVisible();
  await page.getByTestId("social-toggle").click();
  await expect(page.getByText("Sunday service reminder")).toHaveCount(0);

  // The overlay failing or being unavailable is stated, and the calendar still shows.
  state.plannerFail = true;
  await page.goto(`${calendar}?view=agenda&social=1`);
  await expect(page.getByTestId("social-error")).toBeVisible();
  await expect(page.getByText("Elders meeting")).toBeVisible();
  state.plannerFail = false; state.planner404 = true;
  await page.reload();
  await expect(page.getByTestId("social-unavailable")).toBeVisible();
  state.planner404 = false;

  // Availability, a failed refresh with retry, then reconnect and attention states.
  await page.goto(`${calendar}?view=availability`);
  await expect(page.getByTestId("slot")).toHaveCount(2);
  state.fail = true;
  await page.goto(`${calendar}?view=month`);
  await expect(page.getByTestId("events-error")).toBeVisible();
  await audit(page, "events-error", async () => { await expect(page.getByTestId("events-error")).toBeVisible(); });
  state.fail = false;
  await page.getByTestId("events-error").getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("events-error")).toHaveCount(0);
  await expect(page.locator("[data-slot='month-view']")).toContainText("Elders meeting");

  state.health = "reconnect_needed";
  await page.goto(calendar);
  const connect = page.getByTestId("calendar-connect");
  await expect(connect).toHaveAttribute("data-state", "reconnect");
  await expect(connect.getByRole("button", { name: "Reconnect Outlook" })).toBeVisible();
  await expect(connect.getByRole("button", { name: /Google/ })).toHaveCount(0);
  await audit(page, "reconnect", async () => { await expect(connect).toBeVisible(); });
  state.health = "unavailable";
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(calendar);
  await expect(connect).toHaveAttribute("data-state", "attention");
  await expect(page.getByTestId("check-again")).toBeVisible();
  await audit(page, "attention", async () => { await expect(connect).toBeVisible(); });

  expect(actions.filter((action) => writes.includes(action))).toEqual([]);
});
