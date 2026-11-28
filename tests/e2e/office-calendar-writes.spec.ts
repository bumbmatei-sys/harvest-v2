import { mkdir } from "node:fs/promises";
import { expect as base, test, type Page, type Route } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Office Calendar writes, against the real Office routes with the non-production fake provider (grant, create, edit, delete with a confirm, the video link and the
// last-used calendar) and against a stubbed connection for the calendar picker, the conflict message, the video link reason and the disabled state. No real provider,
// no real calendar, no invite and no email: the fake provider is the only one the routes can reach.
const expect = base.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });
const shots = process.env.OFFICE_CALENDAR_SHOTS ?? "docs/screenshots/office-calendar";

async function ministry(page: Page, name: string) {
  const response = await page.request.post("/api/workspaces", { headers: { origin }, data: { name, audience: "church" } });
  expect(response.status()).toBe(201);
  return (await response.json()).tenantId as string;
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

const caps = { calendars: "available", events: "available", event: "available", freeBusy: "available", availability: "available", createEvent: "available", updateEvent: "available", deleteEvent: "available", meeting: "available" };
const connection = (extra: Record<string, unknown> = {}, capabilities: Record<string, string> = caps) => ({ id: "22222222-2222-4222-8222-222222222222", kind: "calendar", platform: "microsoft", health: "healthy", grants: 10, noticeVersion: 1, capabilities, ...extra });
const overview = (...connections: unknown[]) => ({ notice: { key: "Office.personalConnectionNotice", version: 1 }, connections });
const at = (days: number, hour: number) => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hour, 0, 0, 0); return date.toISOString(); };

test("office calendar writes: grant, create once, edit, delete with a confirm, video link and last-used calendar (fake provider)", async ({ page }) => {
  test.setTimeout(900_000);
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const actions = recordActions(page);
  await signIn(page);
  const tenant = await ministry(page, "Grace Community Church"), api = `/api/workspaces/${tenant}`, calendar = `/workspaces/${tenant}/calendar`;
  // The new-event form defaults to the next quarter hour of the browser clock, read in the calendar's zone (New York, UTC-5). Late in the UTC day that default
  // event crosses UTC midnight (about 19:00 UTC) or its end date rolls to tomorrow (about 22:46 to 23:44 UTC), and the agenda then lists the one event on two
  // days. Pin the page clock to midday UTC today so the default start and end are always on the same day, whatever time the run happens.
  const pinned = new Date(); pinned.setUTCHours(12, 0, 0, 0);
  await page.clock.setFixedTime(pinned);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(calendar);
  await page.getByTestId("connect-google").click();
  await expect(page.getByTestId("calendar")).toBeVisible();
  const read = async () => ((await (await page.request.get(`${api}/office`)).json()) as { connections: { id: string; grants: number; capabilities: Record<string, string> }[] }).connections[0];
  expect(await read()).toMatchObject({ grants: 2, capabilities: { createEvent: "available", meeting: "available" } });

  // Write access is a separate grant, asked for the first time an event is created.
  await page.goto(`${calendar}?view=agenda`);
  await page.getByTestId("new-event").click();
  const form = page.getByTestId("event-form");
  await expect(form.getByTestId("grant-prompt")).toContainText("Allow Harvest to add events to your calendar");
  await form.getByTestId("grant-allow").click();
  await expect(form.getByLabel("Title", { exact: true })).toBeVisible();
  expect((await read()).grants).toBe(10);
  expect(actions.filter((action) => action === "createEvent")).toEqual([]);

  // The form: the calendar's own zone, no attendees, a video link that is off.
  await expect(form.getByTestId("form-calendar")).toContainText("Personal calendar");
  await expect(form.getByTestId("form-zone")).toHaveText("Time zone: America/New_York");
  await expect(form.getByTestId("form-attendees")).toBeDisabled();
  await expect(form.getByTestId("form-attendees-note")).toHaveText("Invites aren't available yet");
  const meeting = form.getByTestId("form-meeting");
  await expect(meeting).toBeEnabled();
  await expect(meeting).not.toBeChecked();
  await expect(form.getByTestId("form-save")).toBeDisabled();
  await audit(page, "new-event", async () => {
    if (!(await form.isVisible())) await page.getByTestId("new-event").click();
    await expect(form.getByLabel("Title", { exact: true })).toBeVisible();
  });

  // Create: one request, one event, a video link from the calendar's own provider.
  await form.getByLabel("Title", { exact: true }).fill("Prayer breakfast");
  await form.getByLabel("Notes", { exact: true }).fill("Bring a friend");
  await meeting.click();
  await expect(meeting).toBeChecked();
  await form.getByTestId("form-save").click();
  await expect(form).toHaveCount(0);
  const row = page.getByTestId("agenda-row").filter({ hasText: "Prayer breakfast" });
  await expect(row).toHaveCount(1);
  expect(actions.filter((action) => action === "createEvent")).toHaveLength(1);
  await row.click();
  const panel = page.getByTestId("event-panel");
  await expect(panel.getByTestId("join-link")).toBeVisible();
  await expect(panel.getByTestId("meeting-kind")).toHaveText("Google Meet");
  await expect(panel.getByTestId("event-edit")).toBeEnabled();
  await expect(panel.getByTestId("event-delete")).toBeEnabled();
  await expect(panel.getByTestId("writes-note")).toHaveCount(0);
  await audit(page, "created-detail", async () => { await page.getByTestId("view-agenda").click().catch(() => undefined); await row.click().catch(() => undefined); await expect(panel.getByTestId("detail-title")).toBeVisible(); },
    async () => { await page.goto(`${calendar}?view=agenda`); });

  // Edit: only the Harvest-created event; the calendar cannot move.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${calendar}?view=agenda`);
  await row.click();
  await panel.getByTestId("event-edit").click();
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Prayer breakfast");
  await expect(form.getByTestId("form-calendar")).toBeDisabled();
  await form.getByLabel("Title", { exact: true }).fill("Prayer breakfast (updated)");
  await form.getByTestId("form-save").click();
  await expect(form).toHaveCount(0);
  const updated = page.getByTestId("agenda-row").filter({ hasText: "Prayer breakfast (updated)" });
  await expect(updated).toHaveCount(1);
  expect(actions.filter((action) => action === "updateEvent")).toHaveLength(1);

  // The sample event came from the provider, so it stays read only.
  await page.getByTestId("agenda-row").filter({ hasText: "Planning meeting" }).click();
  await expect(panel.getByTestId("event-edit")).toBeDisabled();
  await expect(panel.getByTestId("event-delete")).toBeDisabled();
  await expect(panel.getByTestId("writes-note")).toHaveText("Harvest can change only events it created.");
  await page.keyboard.press("Escape");

  // Delete asks first; cancelling keeps the event.
  await updated.click();
  await panel.getByTestId("event-delete").click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Delete this event?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(updated).toHaveCount(1);
  expect(actions.filter((action) => action === "deleteEvent")).toEqual([]);
  await panel.getByTestId("event-delete").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(updated).toHaveCount(0);
  expect(actions.filter((action) => action === "deleteEvent")).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("office calendar writes: calendar picker, zone, all-day, video link reason, conflict messages and the disabled state (stubbed)", async ({ page }) => {
  test.setTimeout(900_000);
  await mkdir(shots, { recursive: true });
  // The all-day form defaults its dates from the browser clock; pin it to midday UTC today so the span is one day whatever time the run happens (as in the fake-provider test above).
  const pinned = new Date(); pinned.setUTCHours(12, 0, 0, 0);
  await page.clock.setFixedTime(pinned);
  await signIn(page);
  const tenant = await ministry(page, "Hope Outreach"), calendar = `/workspaces/${tenant}/calendar?view=agenda`;
  const actions = recordActions(page);
  const state = { writes: true, meeting: true, conflict: true, sent: [] as Record<string, unknown>[], reads: 0 };
  const mine = { ref: "e1", calendarRef: "staff", version: "v1", timezone: "Europe/London", createdHere: true, title: "Staff prayer", start: at(1, 10), end: at(1, 11), attendees: [], meetingLink: null };
  const other = { ref: "e2", calendarRef: "main", version: "v9", createdHere: false, title: "Elders meeting", start: at(1, 12), end: at(1, 13), attendees: [], meetingLink: null };
  await stubOffice(page, {
    get overview() { return overview(connection({}, { ...caps, createEvent: state.writes ? "available" : "disabled", updateEvent: state.writes ? "available" : "disabled", deleteEvent: state.writes ? "available" : "disabled", meeting: state.meeting ? "available" : "unavailable" })); },
    handle: (action, input) => {
      switch (action) {
        case "calendars": return { state: "available", data: { items: [{ ref: "main", name: "Ministry calendar", primary: true, timezone: "Europe/London" }, { ref: "staff", name: "Staff meetings", timezone: "Europe/London" }], defaultRef: "staff" } };
        case "events": state.reads++; return { state: "available", data: { items: [mine, other], nextCursor: null } };
        case "createEvent": state.sent.push(input); return { state: "available", data: { ...mine, ref: "e3", version: "v1" } };
        case "updateEvent":
        case "deleteEvent": return state.conflict ? 409 : { state: "available", data: action === "deleteEvent" ? { deleted: true } : mine };
        default: return 404;
      }
    },
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(calendar);
  const form = page.getByTestId("event-form");

  // The picker lists only the writable calendars it was given, with the last used one chosen; the zone is that calendar's.
  await page.getByTestId("new-event").click();
  await expect(form.getByTestId("form-calendar")).toContainText("Staff meetings");
  await form.getByTestId("form-calendar").click();
  await expect(page.getByRole("option")).toHaveText(["Ministry calendar", "Staff meetings"]);
  await page.keyboard.press("Escape");
  await expect(form.getByTestId("form-zone")).toHaveText("Time zone: Europe/London");
  await expect(form.getByTestId("form-meeting")).toBeEnabled();
  // All-day: dates only, the end is the day after the last day.
  await form.getByLabel("Title", { exact: true }).fill("Retreat day");
  await form.getByLabel("All day").click();
  await expect(form.getByLabel("Start time")).toHaveCount(0);
  await form.getByTestId("form-save").click();
  await expect(form).toHaveCount(0);
  expect(state.sent).toHaveLength(1);
  const sent = state.sent[0] as { calendarRef: string; requestId: string; event: { allDay: boolean; start: string; end: string; timezone: string; attendees: unknown[]; meeting: boolean } };
  expect(sent).toMatchObject({ calendarRef: "staff", event: { allDay: true, timezone: "Europe/London", attendees: [], meeting: false } });
  expect(sent.event.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Date.parse(sent.event.end) - Date.parse(sent.event.start)).toBe(86_400_000);
  expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);

  // Changed elsewhere: the save is refused with a clear message and a reload.
  await page.getByTestId("agenda-row").filter({ hasText: "Staff prayer" }).click();
  const panel = page.getByTestId("event-panel");
  await panel.getByTestId("event-edit").click();
  await form.getByLabel("Title", { exact: true }).fill("Staff prayer 2");
  await form.getByTestId("form-save").click();
  await expect(form.getByTestId("form-changed")).toContainText("This event changed elsewhere. Reload and try again.");
  await audit(page, "conflict", async () => {
    if (!(await form.isVisible())) { await page.getByTestId("agenda-row").filter({ hasText: "Staff prayer" }).click(); await panel.getByTestId("event-edit").click(); await form.getByLabel("Title", { exact: true }).fill("Staff prayer 2"); await form.getByTestId("form-save").click(); }
    await expect(form.getByTestId("form-changed")).toBeVisible();
  });
  const before = state.reads;
  await form.getByTestId("form-reload").click();
  await expect(form).toHaveCount(0);
  await expect.poll(() => state.reads).toBeGreaterThan(before);
  await page.getByTestId("agenda-row").filter({ hasText: "Staff prayer" }).click();
  await panel.getByTestId("event-delete").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("This event changed elsewhere");
  const reads = state.reads;
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => state.reads).toBeGreaterThan(reads);

  // The video link is disabled with a short honest reason when the account cannot create one.
  state.meeting = false;
  await page.goto(calendar);
  await page.getByTestId("new-event").click();
  await expect(form.getByTestId("form-meeting")).toBeDisabled();
  await expect(form.getByTestId("form-meeting-note")).toHaveText("A video link can't be added for this account");
  await page.keyboard.press("Escape");

  // Writes not available: the screen keeps its disabled form and notice.
  const writesSent = actions.filter((action) => action === "updateEvent" || action === "deleteEvent").length;
  expect(writesSent).toBeGreaterThanOrEqual(2);
  state.writes = false;
  await page.goto(calendar);
  await page.getByTestId("new-event").click();
  await expect(form.getByTestId("form-writes-note")).toHaveText("Creating and editing events isn't available yet");
  await expect(form.getByLabel("Title", { exact: true })).toBeDisabled();
  await expect(form.getByTestId("form-save")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("agenda-row").filter({ hasText: "Staff prayer" }).click();
  await expect(panel.getByTestId("event-edit")).toBeDisabled();
  await expect(panel.getByTestId("writes-note")).toHaveText("Creating and editing events isn't available yet");
  expect(actions.filter((action) => action === "updateEvent" || action === "deleteEvent")).toHaveLength(writesSent);
});
