import { mkdir } from "node:fs/promises";
import { expect as base, test, type Browser, type Page, type Route } from "./helpers/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Office Mail screens against the real Office routes with the non-production fake provider (synthetic sample mailbox only). Sending is hard-off, so the composer
// is exercised up to its disabled Send; the test asserts that no review or send request is ever made. Failure, partial and paging states are answered by the
// test through route interception, with a stub connection.
const expect = base.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });
const shots = process.env.OFFICE_MAIL_SHOTS ?? "docs/screenshots/office-mail";
const off = process.env.HARVEST_SHELL_MODES === "disabled";
const subject = "Planning tomorrow’s meeting";

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

/** Opens the folder pane wherever it lives: always visible at 1280, the shell drawer in the shell-modes layout, the sheet without it. */
async function folderPane(page: Page) {
  const pane = page.getByTestId("folder-pane");
  const button = page.getByRole("button", { name: "Folders", exact: true });
  const trigger = page.locator('[data-shell-header] [data-sidebar="trigger"]');
  // After a viewport change the layout settles a moment later (media queries, shell drawer). Wait for the layout to show the pane or a control that opens it
  // before toggling, so a click against the old layout cannot close what the new one shows. The final assertion is unchanged.
  await expect.poll(async () => (await pane.isVisible()) || (await button.isVisible()) || (await trigger.isVisible())).toBe(true);
  if (!(await pane.isVisible())) { if (await button.isVisible()) await button.click(); else await trigger.click(); }
  await expect(pane).toBeVisible();
  return pane;
}
async function closeFolderPane(page: Page) {
  if (await page.getByTestId("folder-pane").isVisible() && (page.viewportSize()?.width ?? 1280) < 1024) await page.keyboard.press("Escape");
}

/** Records every Office action the page sends, so a test can prove which were never made. */
function recordActions(page: Page) {
  const actions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/workspaces\/[^/]+\/office$/.test(new URL(request.url()).pathname)) actions.push((request.postDataJSON() as { action: string }).action);
  });
  return actions;
}

async function connectGmail(page: Page) {
  await page.getByTestId("connect-gmail").click();
  await expect(page.getByTestId("mail")).toBeVisible();
  await expect(page.getByTestId("row").first()).toBeVisible();
}

test("office mail: connect, list, search, thread, markers, person link, drafts, disabled send, disconnect and keyboard", async ({ page }) => {
  test.setTimeout(900_000);
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const actions = recordActions(page);
  await signIn(page);
  const tenant = await ministry(page, "Grace Community Church");
  const api = `/api/workspaces/${tenant}`, mail = `/workspaces/${tenant}/mail`;
  const rows = page.getByTestId("row");

  // ---- Not connected: the notice and one button per provider, never an inbox ------------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(mail);
  await expect(page.getByRole("heading", { level: 1, name: "Email" })).toBeVisible();
  const connect = page.getByTestId("mail-connect");
  await expect(connect).toHaveAttribute("data-state", "connect");
  await expect(page.getByTestId("connect-notice")).toContainText("Only you can access this connection in Harvest");
  await expect(connect.getByRole("button", { name: "Connect Gmail" })).toBeVisible();
  await expect(connect.getByRole("button", { name: "Connect Outlook" })).toBeVisible();
  await expect(page.getByTestId("mail")).toHaveCount(0);
  await audit(page, "connect", async () => { await expect(connect).toBeVisible(); });

  // ---- Connect (the fake provider finishes at once) --------------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(mail);
  await connectGmail(page);
  expect(actions).toEqual(expect.arrayContaining(["startConnect", "finishConnect"]));
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(subject);
  await expect(rows.first()).toHaveAttribute("data-unread", "true");
  const overview = await (await page.request.get(`${api}/office`)).json() as { connections: { id: string; kind: string; platform: string; health: string; send?: string }[] };
  const connection = overview.connections.find((item) => item.kind === "mail")!;
  expect(connection).toMatchObject({ platform: "google", health: "healthy", send: "disabled" });

  // ---- Folders, the contextual sidebar and the back arrow -------------------------------------------------------------------------------------------
  const pane = await folderPane(page);
  await expect(pane.getByTestId("folder-inbox")).toHaveAttribute("aria-current", "true");
  await expect(pane.getByTestId("folder-archive")).toBeVisible();
  await expect(pane.getByTestId("folder-drafts")).toBeVisible();
  await expect(pane.getByTestId("account-chip")).toContainText("Gmail");
  await expect(pane.locator("[data-provider-logo='gmail']")).toHaveCount(1);
  if (off) {
    await expect(page.getByRole("group", { name: "Email folders" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Folders" })).toBeVisible();
  } else {
    const side = page.getByRole("group", { name: "Email folders" });
    await expect(side).toBeVisible();
    const back = side.getByRole("link", { name: "Back to Storage" });
    await expect(back).toBeVisible();
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(35);
    await expect(page.getByTestId("mail").getByTestId("folder-pane")).toHaveCount(0);
  }
  await pane.getByTestId("folder-archive").click();
  await expect(page.getByTestId("list-empty")).toBeVisible();
  await pane.getByTestId("folder-inbox").click();
  await expect(rows).toHaveCount(1);
  await closeFolderPane(page);

  // ---- Search goes to the mailbox; an empty result is explained and clears ---------------------------------------------------------------------------
  const search = page.getByRole("searchbox", { name: "Search email" }).or(page.getByRole("textbox", { name: "Search email" }));
  await search.fill("zzz-no-match"); await search.press("Enter");
  await expect(page.getByTestId("list-empty")).toContainText("No messages match");
  await page.getByTestId("list-empty").getByRole("button", { name: "Clear search" }).click();
  await expect(rows).toHaveCount(1);
  await search.fill("agenda");
  await expect(rows).toHaveCount(1);
  expect(page.url()).not.toContain("agenda");
  await search.fill("");
  await expect(rows).toHaveCount(1);

  // ---- Open the thread by keyboard: read live, marked read in Harvest only -----------------------------------------------------------------------------
  await rows.first().focus(); await page.keyboard.press("Enter");
  const thread = page.getByTestId("thread");
  await expect(thread).toBeVisible();
  await expect(thread.getByTestId("thread-subject")).toHaveText(subject);
  await expect(thread.getByTestId("message-body")).toContainText("review the agenda");
  await expect(thread.getByTestId("message-from")).toHaveText("sender@example.test");
  await expect(rows.first()).toHaveAttribute("data-unread", "false");
  await expect.poll(async () => ((await (await page.request.post(`${api}/office`, { headers: { origin }, data: { action: "threads", connectionId: connection.id, input: {} } })).json()) as { data: { items: { marker: { read: boolean } }[] } }).data.items[0].marker.read).toBe(true);

  // ---- Star and read markers are stored and survive a reload -------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  const star = thread.getByTestId("star-toggle");
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click(); await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(rows.first().getByTestId("starred-marker")).toBeVisible();
  await expect(thread.getByTestId("read-toggle")).toHaveAccessibleName("Mark as unread");
  const markedUnread = page.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== "POST" || new URL(request.url()).pathname !== `${api}/office`) return false;
    const data = request.postDataJSON();
    return data.action === "marker" && data.input.read === false;
  });
  await thread.getByTestId("read-toggle").click();
  expect((await markedUnread).ok()).toBe(true);
  await expect(rows.first()).toHaveAttribute("data-unread", "true");
  await page.reload();
  await expect(page.getByTestId("thread").getByTestId("star-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(rows.first().getByTestId("starred-marker")).toBeVisible();
  await page.getByTestId("star-toggle").click(); await expect(page.getByTestId("star-toggle")).toHaveAttribute("aria-pressed", "false");

  // The responsive audit reloads the page, so run it after testing markers on the originally opened thread.
  await audit(page, "thread", async () => { await expect(thread).toBeVisible(); await expect(thread.getByTestId("message")).toBeVisible(); });

  // ---- Link the thread to a CRM person (an explicit reference, nothing created) ----------------------------------------------------------------------
  const person = await (await page.request.post(`${api}/contacts`, { headers: { origin }, data: { name: "Synthetic Grace Okafor", email: "grace.okafor@example.test" } })).json() as { id: string };
  await page.getByTestId("person-link").click();
  await page.getByPlaceholder("Search people").fill("Okafor");
  await page.getByRole("option", { name: /Synthetic Grace Okafor/ }).click();
  const chip = page.getByTestId("person-chip");
  await expect(chip).toContainText("Linked to Synthetic Grace Okafor");
  await expect(rows.first().getByTestId("linked-marker")).toBeVisible();
  await expect(chip.getByRole("link")).toHaveAttribute("href", `/workspaces/${tenant}/crm/people/${person.id}`);
  await page.reload();
  await expect(page.getByTestId("person-chip")).toContainText("Synthetic Grace Okafor");
  await page.getByTestId("person-unlink").click();
  await expect(page.getByTestId("person-link")).toBeVisible();
  await expect(rows.first().getByTestId("linked-marker")).toHaveCount(0);
  const contacts = await (await page.request.get(`${api}/contacts`)).json() as { total: number };
  expect(contacts.total).toBe(1);

  // ---- Reply opens a draft prefilled for the sender; saving, reopening and deleting it work; sending never happens -----------------------------------
  await page.getByTestId("reply").click();
  const composer = page.getByTestId("composer");
  await expect(composer).toBeVisible();
  await expect(composer.locator("#mail-to")).toHaveValue("sender@example.test");
  await expect(composer.locator("#mail-subject")).toHaveValue(`Re: ${subject}`);
  await expect(composer.locator("#mail-body")).toBeFocused();
  await composer.locator("#mail-body").fill("Yes, the agenda works for me.");
  await expect(page.getByTestId("send")).toBeDisabled();
  await expect(page.getByTestId("send")).toHaveAccessibleDescription(/Sending is not available yet/);
  await page.getByTestId("save-draft").click();
  await expect(page.getByTestId("delete-draft")).toBeVisible();
  await audit(page, "composer", async () => { await expect(composer).toBeVisible(); }, async () => { if (!(await composer.isVisible())) await page.getByTestId("compose-new").click(); await expect(composer).toBeVisible(); });

  // Invalid recipients are refused before any request.
  await page.setViewportSize({ width: 1280, height: 900 });
  await composer.locator("#mail-to").fill("not-an-address");
  await page.getByTestId("save-draft").click();
  await expect(page.getByTestId("composer-error")).toContainText("valid email");
  await composer.locator("#mail-to").fill("sender@example.test");
  await page.getByTestId("composer-close").click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(composer).toHaveCount(0);

  const pane2 = await folderPane(page);
  await pane2.getByTestId("folder-drafts").click(); await closeFolderPane(page);
  const draftRows = page.getByTestId("draft-row");
  await expect(draftRows).toHaveCount(1);
  await expect(draftRows.first()).toContainText(`Re: ${subject}`);
  await draftRows.first().click();
  await expect(page.getByTestId("composer")).toBeVisible();
  await expect(page.locator("#mail-body")).toHaveValue("Yes, the agenda works for me.");
  await page.locator("#mail-body").fill("Yes, the agenda works. See you tomorrow.");
  await page.getByTestId("save-draft").click();
  await expect(page.getByTestId("save-draft")).toBeEnabled();
  await expect(draftRows).toHaveCount(1);
  await page.getByTestId("delete-draft").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("list-empty")).toContainText("No drafts");
  await page.getByTestId("compose-new").click();
  await expect(page.locator("#mail-to")).toBeFocused();
  await page.getByTestId("composer-close").click();
  await expect(page.getByTestId("composer")).toHaveCount(0);
  expect(actions.filter((action) => ["reviewMail", "sendMail", "createEvent", "updateEvent", "deleteEvent"].includes(action))).toEqual([]);

  // ---- Disconnect returns to the connect state; the markers go with the connection ------------------------------------------------------------------
  const side = await folderPane(page);
  await side.getByTestId("disconnect").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByTestId("mail-connect")).toBeVisible();
  await expect(page.getByTestId("mail")).toHaveCount(0);
  expect(((await (await page.request.get(`${api}/office`)).json()) as { connections: unknown[] }).connections).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("office mail: another admin never sees this admin's connection; members and strangers get the neutral answer", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await mkdir(shots, { recursive: true });
  await signIn(page);
  const tenant = await ministry(page, "Grace Community Church"), api = `/api/workspaces/${tenant}`, mail = `/workspaces/${tenant}/mail`;
  const admin = await guest(browser), member = await guest(browser), stranger = await guest(browser);
  expect((await page.request.put(`${api}/members`, { headers: { origin }, data: { email: admin.email, role: "admin" } })).status()).toBe(200);
  expect((await page.request.put(`${api}/members`, { headers: { origin }, data: { email: member.email, role: "member" } })).status()).toBe(200);

  await page.goto(mail); await connectGmail(page);
  const mine = ((await (await page.request.get(`${api}/office`)).json()) as { connections: { id: string }[] }).connections[0].id;

  // The second admin has no connection of their own: the connect state, an empty overview, and a neutral 404 for the first admin's connection id.
  await admin.page.goto(mail);
  await expect(admin.page.getByTestId("mail-connect")).toBeVisible();
  await expect(admin.page.getByTestId("mail")).toHaveCount(0);
  await expect(admin.page.getByText(subject)).toHaveCount(0);
  expect(((await (await admin.page.request.get(`${api}/office`)).json()) as { connections: unknown[] }).connections).toHaveLength(0);
  const foreign = await admin.page.request.post(`${api}/office`, { headers: { origin }, data: { action: "threads", connectionId: mine, input: {} } });
  expect(foreign.status()).toBe(404);
  expect((await admin.page.request.post(`${api}/office`, { headers: { origin }, data: { action: "thread", connectionId: mine, input: { threadRef: "sample-thread" } } })).status()).toBe(404);
  // And the first admin still has theirs.
  await page.reload(); await expect(page.getByTestId("mail")).toBeVisible();

  // A member and a stranger reach no mail screen and no Office data.
  for (const person of [member, stranger]) {
    await person.page.goto(mail);
    await expect(person.page.getByTestId("mail")).toHaveCount(0);
    await expect(person.page.getByTestId("mail-connect")).toHaveCount(0);
    await expect(person.page.getByRole("heading", { name: /workspace|available|access|ministry/i }).first()).toBeVisible();
    expect((await person.page.request.get(`${api}/office`)).status()).toBe(404);
  }
  await member.page.goto(`/workspaces/${tenant}/crm/people`);
  await expect(member.page.getByRole("link", { name: "Email", exact: true })).toHaveCount(0);
  await Promise.all([admin.context.close(), member.context.close(), stranger.context.close()]);
});

// ---- Stubbed states: paging, partial pages, failures, reconnect and attention ---------------------------------------------------------------------------
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
const caps = { threads: "available", thread: "available", folders: "available", labels: "available", drafts: "available", draft: "available", createDraft: "available", updateDraft: "available", deleteDraft: "available" };
const conn = (health = "healthy", platform: string | null = "microsoft", grants = 1) => ({ id: "11111111-1111-4111-8111-111111111111", kind: "mail", platform, health, grants, noticeVersion: 1, capabilities: caps, send: "disabled" });
const overview = (...connections: unknown[]) => ({ notice: { key: "Office.personalConnectionNotice", version: 1 }, connections });
const marker = (ref: string, extra = {}) => ({ ref, read: false, starred: false, contactId: null, ...extra });
const summary = (n: number) => ({ ref: `t${n}`, subject: `Synthetic thread ${n}`, snippet: `Snippet ${n}`, latestMessageReceivedAt: "2026-11-20T10:00:00.000Z", marker: marker(`t${n}`) });

test("office mail: paging, partial page, failures, drafts conflict, reconnect and attention states (stubbed mailbox)", async ({ page }) => {
  test.setTimeout(600_000);
  await mkdir(shots, { recursive: true });
  await signIn(page);
  const tenant = await ministry(page, "Hope Outreach"), mail = `/workspaces/${tenant}/mail`;
  const state = { threadsFail: false, partial: true, draftConflict: false, thread404: false, health: "healthy" as string };
  await stubOffice(page, {
    get overview() { return overview(conn(state.health, "microsoft", state.health === "reconnect_needed" ? 0 : 1)); },
    handle: (action, input) => {
      switch (action) {
        case "folders": return { state: "available", data: { items: [{ ref: "inbox", name: "Inbox" }, { ref: "sent", name: "Sent items" }, { ref: "projects", name: "Projects" }] } };
        case "threads": {
          if (state.threadsFail) return { state: "temporarily_unavailable" };
          if (input.folderRef === "projects") return { state: "available", data: { items: [], nextCursor: null } };
          if (input.cursor === "page2") return { state: "available", data: { items: [summary(4), summary(5), summary(3)], nextCursor: null } };
          return { state: "available", data: { items: [summary(1), summary(2), summary(3)], nextCursor: "page2", partial: state.partial } };
        }
        case "thread": return state.thread404 ? 404 : { state: "available", data: { ref: input.threadRef, subject: "Synthetic thread", messages: [{ ref: "m1", subject: "Synthetic thread", body: "", from: "Pat <pat@example.test>", to: ["me@example.test"], bodyUnavailable: true }], marker: marker(String(input.threadRef)) } };
        case "marker": return { state: "available", data: marker(String(input.threadRef), input) };
        case "drafts": return { state: "available", data: { items: [{ ref: "d1", subject: "Stub draft", to: [], body: "" }] } };
        case "draft": return { state: "available", data: { ref: "d1", version: "v1", subject: "Stub draft", to: ["pat@example.test"], body: "Hello" } };
        case "updateDraft": return state.draftConflict ? 409 : { state: "available", data: { ref: "d1", version: "v2", subject: "Stub draft", to: ["pat@example.test"], body: "Hello" } };
        default: return 404;
      }
    },
  });
  const rows = page.getByTestId("row");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(mail);

  // Paging: the cursor is followed, rows are not duplicated, and the partial notice is shown.
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId("partial-notice")).toBeVisible();
  await expect(page.getByTestId("account-chip")).toContainText("Outlook");
  await expect(page.locator("[data-provider-logo='outlook']").first()).toBeVisible();
  await expect(page.getByTestId("folder-sent")).toContainText("Sent items");
  await page.getByTestId("load-more").click();
  await expect(rows).toHaveCount(5);
  await expect(page.getByTestId("load-more")).toHaveCount(0);
  await audit(page, "list-partial", async () => { await expect(rows.first()).toBeVisible(); });

  // An HTML-only message says so instead of showing nothing; a missing thread is a neutral state.
  await page.setViewportSize({ width: 1280, height: 900 });
  await rows.first().click();
  await expect(page.getByTestId("body-unavailable")).toContainText("not available");
  state.thread404 = true;
  await rows.nth(1).click();
  await expect(page.getByText("This message is no longer available.")).toBeVisible();
  state.thread404 = false;
  await page.goto(mail); await expect(rows).toHaveCount(3);

  // A failed refresh shows an error with retry, then recovers.
  state.threadsFail = true;
  await page.getByTestId("refresh").click();
  await expect(page.getByTestId("list-error")).toBeVisible();
  await audit(page, "list-error", async () => { await expect(page.getByTestId("list-error")).toBeVisible(); });
  state.threadsFail = false;
  await page.getByTestId("list-error").getByRole("button", { name: "Try again" }).click();
  await expect(rows).toHaveCount(3);

  // Empty folder.
  const pane = await folderPane(page);
  await pane.getByTestId("folder-projects").click(); await closeFolderPane(page);
  await expect(page.getByTestId("list-empty")).toBeVisible();
  await audit(page, "list-empty", async () => { await expect(page.getByTestId("list-empty")).toBeVisible(); });

  // A stale draft version is reported, not overwritten.
  await page.setViewportSize({ width: 1280, height: 900 });
  const drawer = await folderPane(page);
  await drawer.getByTestId("folder-drafts").click(); await closeFolderPane(page);
  await page.getByTestId("draft-row").click();
  await expect(page.locator("#mail-body")).toHaveValue("Hello");
  state.draftConflict = true;
  await page.locator("#mail-body").fill("Hello again");
  await page.getByTestId("save-draft").click();
  await expect(page.getByTestId("save-conflict")).toBeVisible();

  // Reconnect needed: the connect state names the provider and offers one button; no mailbox is shown.
  state.health = "reconnect_needed";
  await page.goto(mail);
  const connect = page.getByTestId("mail-connect");
  await expect(connect).toHaveAttribute("data-state", "reconnect");
  await expect(connect.getByRole("button", { name: "Reconnect Outlook" })).toBeVisible();
  await expect(connect.getByRole("button", { name: /Gmail/ })).toHaveCount(0);
  await expect(page.getByTestId("mail")).toHaveCount(0);
  await audit(page, "reconnect", async () => { await expect(connect).toBeVisible(); });

  // Needs attention: a check-again action and Disconnect.
  state.health = "unavailable";
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(mail);
  await expect(connect).toHaveAttribute("data-state", "attention");
  await expect(page.getByTestId("check-again")).toBeVisible();
  await expect(connect.getByTestId("disconnect")).toBeVisible();
  await audit(page, "attention", async () => { await expect(connect).toBeVisible(); });
});
