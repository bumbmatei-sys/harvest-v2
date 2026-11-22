import { mkdir } from "node:fs/promises";
import { expect as base, test, type Browser, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn as signInHelper } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// The unified Files screen: Harvest's own uploads (real server, real upload path) plus the person's connected drives. Drive listings come either from the real Office
// routes with the non-production fake provider (connect, private connections, roles) or, for the three-source scenes, from route interception with stub connections.
// Provider downloads, sharing, uploads and deletes are hard-off: the test records every Office request and asserts none of them is ever made.
const expect = base.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30_000, reducedMotion: "reduce" });
const shots = process.env.FILES_SHOTS ?? "docs/screenshots/files";
const GOOGLE = "11111111-1111-4111-8111-111111111111", ONEDRIVE = "22222222-2222-4222-8222-222222222222";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");

/** The shared helper pins a forwarded-for header on the context for the sign-in rate limit; it is dropped afterwards so the browser can upload straight to storage (a cross-origin request). */
async function signIn(page: Page) { const email = await signInHelper(page); await page.context().setExtraHTTPHeaders({}); return email; }
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
/** Records every Office action the page sends. */
function recordActions(page: Page) {
  const actions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/workspaces\/[^/]+\/office$/.test(new URL(request.url()).pathname)) actions.push((request.postDataJSON() as { action: string }).action);
  });
  return actions;
}
const allowed = new Set(["files", "preview", "health", "startConnect", "finishConnect", "disconnect"]);

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByLabel("Choose file").setInputFiles({ name, mimeType, buffer });
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "File uploaded and ready." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

// ---- Stub drives ----------------------------------------------------------------------------------------------------------------------------------------------
type Item = { ref: string; name: string; kind: "file" | "folder"; parentRef: string | null; mimeType: string | null; size: number | null; webUrl: string | null };
const file = (ref: string, name: string, parentRef: string | null, mimeType: string, size: number, webUrl: string | null = null): Item => ({ ref, name, kind: "file", parentRef, mimeType, size, webUrl });
const folder = (ref: string, name: string, parentRef: string | null): Item => ({ ref, name, kind: "folder", parentRef, mimeType: null, size: null, webUrl: null });
const googleTree: Item[] = [folder("g-photos", "Photos", null), folder("g-sermons", "Sermons", null), file("g-agenda", "agenda.txt", null, "text/plain", 27),
  folder("g-2026", "2026", "g-photos"), file("g-team", "team.png", "g-photos", "image/png", 20480), file("g-retreat", "retreat.jpg", "g-2026", "image/jpeg", 51200)];
const oneDriveTree: Item[] = [folder("o-photos", "Photos", null), file("o-budget", "budget.pdf", null, "application/pdf", 90000, "https://preview.example.test/budget"), file("o-logo", "logo-draft.png", "o-photos", "image/png", 4096)];
const caps = { files: "available", file: "available", preview: "available", drives: "available" };
const connection = (id: string, platform: string | null, health = "healthy", grants = 4) => ({ id, kind: "files", platform, health, grants, noticeVersion: 1, capabilities: caps });
const overview = (...connections: unknown[]) => ({ notice: { key: "Office.personalConnectionNotice", version: 1 }, connections });

type Stub = { overview: unknown; trees: Record<string, Item[]>; pageSize: Record<string, number>; override: (connectionId: string, action: string, input: Record<string, unknown>) => unknown | undefined };
function stubState(...connections: unknown[]): Stub { return { overview: overview(...connections), trees: { [GOOGLE]: googleTree, [ONEDRIVE]: oneDriveTree }, pageSize: {}, override: () => undefined }; }
function descendants(tree: Item[], ref: string): Set<string> {
  const found = new Set<string>([ref]);
  for (let changed = true; changed;) { changed = false; for (const item of tree) if (item.parentRef && found.has(item.parentRef) && !found.has(item.ref)) { found.add(item.ref); changed = true; } }
  return found;
}
function answer(stub: Stub, connectionId: string, action: string, input: Record<string, unknown>) {
  const overridden = stub.override(connectionId, action, input);
  if (overridden !== undefined) return overridden;
  const tree = stub.trees[connectionId] ?? [];
  if (action === "preview") { const item = tree.find((row) => row.ref === input.fileRef); return item?.webUrl ? { state: "available", data: { url: item.webUrl } } : { state: "unavailable" }; }
  if (action !== "files") return 404;
  const folderRef = (input.folderRef as string | undefined) ?? null, search = (input.search as string | undefined)?.toLowerCase();
  if (folderRef && !tree.some((row) => row.ref === folderRef && row.kind === "folder")) return 404;
  const scope = folderRef ? descendants(tree, folderRef) : null;
  const rows = search ? tree.filter((row) => row.name.toLowerCase().includes(search) && (!scope || (row.parentRef !== null && scope.has(row.parentRef)))) : tree.filter((row) => row.parentRef === folderRef);
  const size = stub.pageSize[connectionId] ?? 100, offset = Number(input.cursor ?? 0), page = rows.slice(offset, offset + size);
  return { state: "available", data: { items: page, nextCursor: offset + size < rows.length ? String(offset + size) : null } };
}
async function stubOffice(page: Page, stub: Stub) {
  await page.route(/\/api\/workspaces\/[^/]+\/office$/, async (route: Route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stub.overview) });
    const body = request.postDataJSON() as { action: string; connectionId: string; input: Record<string, unknown> };
    const result = answer(stub, body.connectionId, body.action, body.input);
    if (typeof result === "number") return route.fulfill({ status: result, contentType: "application/json", body: JSON.stringify({ error: "stub" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
}

const chip = (page: Page, name: string) => page.getByTestId("source-filter").getByRole("button", { name, exact: true });
const marks = (page: Page) => page.locator("[data-source-mark]");
async function pressed(page: Page, names: string[]) {
  for (const name of ["All", "Harvest", "Google Drive", "OneDrive"]) if (await page.getByTestId("source-filter").getByRole("button", { name, exact: true }).count()) await expect(chip(page, name)).toHaveAttribute("aria-pressed", names.includes(name) ? "true" : "false");
}

// ---- Real Office routes (fake provider): Harvest only, connect, one private connection, roles --------------------------------------------------------------
test("files: Harvest alone, connect a drive, filter and marks, private connection, roles, nothing leaves the ministry", async ({ page, browser }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const actions = recordActions(page);
  await signIn(page);
  const tenant = await ministry(page, "Grace Community Church"), api = `/api/workspaces/${tenant}`, files = `/workspaces/${tenant}/files`;
  const admin = await guest(browser), member = await guest(browser);
  expect((await page.request.put(`${api}/members`, { headers: { origin }, data: { email: admin.email, role: "admin" } })).status()).toBe(200);
  expect((await page.request.put(`${api}/members`, { headers: { origin }, data: { email: member.email, role: "member" } })).status()).toBe(200);

  await page.goto(files);
  await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible();
  await expect(page.getByText("No files yet.")).toBeVisible();
  // Harvest alone: no source chips, no marks, no folder cards for an empty library.
  await expect(page.getByTestId("source-filter")).toHaveCount(0);
  await expect(marks(page)).toHaveCount(0);
  await expect(page.getByTestId("folder-card")).toHaveCount(0);
  await upload(page, "welcome.txt", "text/plain", Buffer.from("Welcome to the ministry files\n"));
  await upload(page, "logo.png", "image/png", png);
  await page.reload();
  await expect(page.getByTestId("storage-total")).toContainText("2 files");
  await expect(page.getByTestId("folder-card")).toHaveCount(2);
  await expect(page.getByTestId("folder-card").filter({ hasText: "Images" })).toContainText("1 item");
  await expect(page.getByTestId("folder-card").filter({ hasText: "Text" })).toContainText("1 item");
  await expect(marks(page)).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "welcome.txt" }).getByRole("button", { name: "Download welcome.txt" })).toBeVisible();

  // Connect a drive from the Sources dialog: the privacy notice is on screen, one drive connection per person.
  await page.getByTestId("sources-open").click();
  await expect(page.getByTestId("connect-notice")).toContainText("Only you can access this connection");
  await expect(page.getByTestId("connect-google")).toBeVisible();
  await expect(page.getByTestId("connect-microsoft")).toBeVisible();
  await page.getByTestId("connect-google").click();
  await expect(page.getByTestId("source-connection")).toHaveCount(1);
  await expect(page.getByTestId("source-connection")).toContainText("Google Drive");
  await expect(page.getByTestId("connect-microsoft")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Only connected sources are offered; with two sources shown every icon carries a mark and a source-aware name.
  await expect(page.getByTestId("source-filter")).toBeVisible();
  await expect(chip(page, "Google Drive")).toBeVisible();
  await expect(chip(page, "OneDrive")).toHaveCount(0);
  await pressed(page, ["All"]);
  const mine = ((await (await page.request.get(`${api}/office`)).json()) as { connections: { id: string; kind: string }[] }).connections.find((item) => item.kind === "files")!.id;
  await expect(page.getByTestId("files-screen")).toHaveAttribute("data-marked", "true");
  await expect(page.getByRole("img", { name: "File Meeting agenda.txt, Google Drive" })).toBeVisible();
  await expect(page.getByRole("img", { name: "File welcome.txt, Harvest" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Folder Images, Harvest" })).toBeVisible();
  await expect(page.locator("[data-entry-icon]")).toHaveCount(await marks(page).count());
  // The corner mark is a small element at the bottom right of the icon.
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  const tile = await box("[data-entry-icon]"), mark = await box("[data-source-mark]");
  expect(mark.width).toBeLessThanOrEqual(20);
  expect(mark.x + mark.width / 2).toBeGreaterThan(tile.x + tile.width / 2);
  expect(mark.y + mark.height / 2).toBeGreaterThan(tile.y + tile.height / 2);

  // One source at a time shows no marks.
  await chip(page, "Google Drive").click();
  await pressed(page, ["Google Drive"]);
  await expect(page.getByTestId("files-screen")).toHaveAttribute("data-marked", "false");
  await expect(marks(page)).toHaveCount(0);
  await expect(page.getByText("Meeting agenda.txt")).toBeVisible();
  await expect(page.getByText("welcome.txt")).toHaveCount(0);
  await expect(page.getByTestId("storage-overview")).toHaveCount(0);
  // Preview is attempted only for a file; this synthetic file has no provider page, so it says so. Nothing downloadable or shareable exists for drive files.
  const agenda = page.getByRole("row").filter({ hasText: "Meeting agenda.txt" });
  await expect(agenda.getByRole("button", { name: /Download|Share|Delete|Upload/ })).toHaveCount(0);
  await agenda.getByRole("button", { name: "Preview Meeting agenda.txt" }).click();
  await expect(page.getByText("Preview is not available for this file.")).toBeVisible();
  // Both chips selected is the same as All; Harvest alone shows no marks and no drive files.
  await chip(page, "Harvest").click();
  await pressed(page, ["All"]);
  await chip(page, "Harvest").click();
  await pressed(page, ["Harvest"]);
  await expect(marks(page)).toHaveCount(0);
  await expect(page.getByText("Meeting agenda.txt")).toHaveCount(0);
  await chip(page, "All").click();
  await pressed(page, ["All"]);

  // Disconnect removes the source and its chips.
  await page.getByTestId("sources-open").click();
  await page.getByTestId("source-disconnect").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByTestId("source-connection")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("source-filter")).toHaveCount(0);
  await expect(marks(page)).toHaveCount(0);
  await page.getByTestId("sources-open").click();
  await page.getByTestId("connect-google").click();
  await expect(page.getByTestId("source-connection")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // The second admin has no connection of their own and cannot reach this admin's: an empty overview, no chips, and one neutral 404 for the connection id.
  await admin.page.goto(files);
  await expect(admin.page.getByRole("heading", { name: "Files", exact: true })).toBeVisible();
  await expect(admin.page.getByTestId("sources-open")).toBeVisible();
  await expect(admin.page.getByTestId("source-filter")).toHaveCount(0);
  await expect(admin.page.getByText("Meeting agenda.txt")).toHaveCount(0);
  await expect(admin.page.getByText("welcome.txt").first()).toBeVisible();
  expect(((await (await admin.page.request.get(`${api}/office`)).json()) as { connections: unknown[] }).connections).toHaveLength(0);
  for (const action of ["files", "preview"]) expect((await admin.page.request.post(`${api}/office`, { headers: { origin }, data: { action, connectionId: mine, input: action === "files" ? {} : { fileRef: "sample-file" } } })).status()).toBe(404);
  // A member sees the Harvest files only: no Sources control, no Office data.
  await member.page.goto(files);
  await expect(member.page.getByText("welcome.txt").first()).toBeVisible();
  await expect(member.page.getByTestId("sources-open")).toHaveCount(0);
  await expect(member.page.getByTestId("source-filter")).toHaveCount(0);
  expect((await member.page.request.get(`${api}/office`)).status()).toBe(404);
  await Promise.all([admin.context.close(), member.context.close()]);

  expect(actions.filter((action) => !allowed.has(action))).toEqual([]);
  expect(errors).toEqual([]);
});

// ---- Three sources (stub drives): filters, marks, same names, navigation, breadcrumbs, search, preview, keyboard -------------------------------------------------
test("files: three sources, filter combinations, separate same-named folders, navigation, breadcrumbs, search, preview and keyboard", async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const actions = recordActions(page);
  await signIn(page);
  const tenant = await ministry(page, "Grace Community Church");
  await page.goto(`/workspaces/${tenant}/files`);
  await upload(page, "welcome.txt", "text/plain", Buffer.from("Welcome to the ministry files\n"));
  await upload(page, "logo.png", "image/png", png);
  await stubOffice(page, stubState(connection(GOOGLE, "google"), connection(ONEDRIVE, "microsoft")));
  await page.reload();

  // All three sources: chips, one card per folder, same-named folders kept apart, marks and source-aware names.
  await expect(page.getByTestId("source-filter")).toBeVisible();
  for (const name of ["All", "Harvest", "Google Drive", "OneDrive"]) await expect(chip(page, name)).toBeVisible();
  await pressed(page, ["All"]);
  await expect(page.getByTestId("folder-card")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Folder Photos, Google Drive" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Folder Photos, OneDrive" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Folder Images, Harvest" })).toBeVisible();
  await expect(page.getByTestId("folder-card").filter({ hasText: "Photos" })).toHaveCount(2);
  for (const kind of ["harvest", "google", "microsoft"]) await expect(page.locator(`[data-source-mark="${kind}"]`).first()).toBeVisible();
  await expect(page.locator("[data-entry-icon]")).toHaveCount(await marks(page).count());
  await expect(page.getByRole("img", { name: "File budget.pdf, OneDrive" })).toBeVisible();
  await expect(page.getByRole("img", { name: "File agenda.txt, Google Drive" })).toBeVisible();
  await expect(page.getByTestId("storage-total")).toContainText("2 files");

  // Filter combinations.
  await chip(page, "Google Drive").click();
  await pressed(page, ["Google Drive"]);
  await expect(marks(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Photos", exact: true })).toHaveCount(1);
  await expect(page.getByTestId("folder-card")).toHaveCount(2);
  await chip(page, "OneDrive").click();
  await pressed(page, ["Google Drive", "OneDrive"]);
  await expect(page.getByTestId("files-screen")).toHaveAttribute("data-marked", "true");
  await expect(page.getByRole("button", { name: "Folder Photos, Google Drive" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Folder Photos, OneDrive" })).toBeVisible();
  await expect(page.locator('[data-testid="folder-card"][data-source="harvest"]')).toHaveCount(0);
  await chip(page, "Google Drive").click();
  await pressed(page, ["OneDrive"]);
  await expect(marks(page)).toHaveCount(0);
  await expect(page.getByTestId("folder-card")).toHaveCount(1);
  await chip(page, "Harvest").click();
  await pressed(page, ["Harvest", "OneDrive"]);
  await expect(page.getByTestId("folder-card")).toHaveCount(3);
  await chip(page, "Google Drive").click();
  await pressed(page, ["All"]);
  await expect(page.getByTestId("folder-card")).toHaveCount(5);

  // Open a folder by keyboard, then walk the breadcrumbs.
  const crumbs = page.getByTestId("files-explorer").getByRole("navigation", { name: "File location" });
  await page.getByRole("button", { name: "Folder Photos, Google Drive" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("files-explorer")).toBeVisible();
  await expect(crumbs).toContainText("Files");
  await expect(crumbs).toContainText("Google Drive");
  await expect(crumbs.getByText("Photos")).toBeVisible();
  const table = page.getByTestId("files-explorer").getByRole("table");
  await expect(table.getByRole("button", { name: "Folder 2026, Google Drive" })).toBeVisible();
  await expect(table.getByRole("img", { name: "File team.png, Google Drive" })).toBeVisible();
  await expect(table.getByText("budget.pdf")).toHaveCount(0);
  await table.getByRole("button", { name: "Folder 2026, Google Drive" }).click();
  await expect(table.getByRole("img", { name: "File retreat.jpg, Google Drive" })).toBeVisible();
  await expect(crumbs.getByText("2026")).toBeVisible();
  await crumbs.getByRole("button", { name: "Photos" }).click();
  await expect(table.getByRole("img", { name: "File team.png, Google Drive" })).toBeVisible();
  await crumbs.getByRole("button", { name: "Google Drive" }).click();
  await expect(table.getByRole("button", { name: "Folder Photos, Google Drive" })).toBeVisible();
  await expect(table.getByRole("button", { name: "Folder Sermons, Google Drive" })).toBeVisible();
  await page.getByTestId("crumb-root").click();
  await expect(page.getByTestId("files-explorer")).toHaveCount(0);
  await expect(page.getByTestId("folder-card")).toHaveCount(5);
  // The other Photos folder is a different listing.
  await page.getByRole("button", { name: "Folder Photos, OneDrive" }).click();
  await expect(table.getByRole("img", { name: "File logo-draft.png, OneDrive" })).toBeVisible();
  await expect(table.getByText("team.png")).toHaveCount(0);
  await page.getByTestId("crumb-root").click();

  // Search across the shown sources; the query never reaches the URL.
  await page.getByTestId("files-search").fill("photos");
  await expect(page.getByTestId("files-explorer")).toBeVisible();
  await expect(table.getByRole("button", { name: "Folder Photos, Google Drive" })).toBeVisible();
  await expect(table.getByRole("button", { name: "Folder Photos, OneDrive" })).toBeVisible();
  await expect(crumbs).toContainText("Search results");
  expect(page.url()).not.toContain("photos");
  await page.getByTestId("files-search").fill("team");
  await expect(table.getByRole("img", { name: "File team.png, Google Drive" })).toBeVisible();
  await expect(table.getByRole("button", { name: /Photos/ })).toHaveCount(0);
  await page.getByTestId("files-search").fill("welcome");
  await expect(table.getByRole("img", { name: "File welcome.txt, Harvest" })).toBeVisible();
  await page.getByTestId("files-search").fill("zzz-none");
  await expect(page.getByText("Nothing matches your search.")).toBeVisible();
  await page.getByTestId("files-search").fill("");
  await expect(page.getByTestId("files-explorer")).toHaveCount(0);

  // All files, preview where the provider gives a page, and nothing that leaves the ministry.
  await page.getByTestId("view-all").click();
  const budget = page.getByRole("row").filter({ hasText: "budget.pdf" });
  await expect(budget.getByRole("button", { name: /Download|Share|Delete|Upload/ })).toHaveCount(0);
  await page.context().route("https://preview.example.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Synthetic preview</title>" }));
  const popup = page.waitForEvent("popup");
  await budget.getByRole("button", { name: "Preview budget.pdf" }).click();
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toContain("preview.example.test/budget");
  await opened.close();
  await page.getByRole("row").filter({ hasText: "agenda.txt" }).getByRole("button", { name: "Preview agenda.txt" }).click();
  await expect(page.getByText("Preview is not available for this file.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "welcome.txt" }).getByRole("button", { name: "Download welcome.txt" })).toBeVisible();

  expect(actions.filter((action) => !allowed.has(action))).toEqual([]);
  expect(errors).toEqual([]);
});

// ---- Source states: paging, partial, failures, reconnect, attention -------------------------------------------------------------------------------------------
test("files: load more, partial pages, a failing or reconnecting drive and a drive that needs attention", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);
  const tenant = await ministry(page, "Grace Community Church");
  const stub = stubState(connection(GOOGLE, "google"), connection(ONEDRIVE, "microsoft"));
  stub.pageSize[GOOGLE] = 2;
  await stubOffice(page, stub);
  await page.goto(`/workspaces/${tenant}/files`);
  await upload(page, "welcome.txt", "text/plain", Buffer.from("hello\n"));
  await page.getByTestId("view-all").click();
  const table = page.getByTestId("files-explorer").getByRole("table");
  // The first Google page holds two of the three root rows; a non-null cursor is followed and rows are not duplicated.
  await expect(table.getByRole("button", { name: "Folder Photos, Google Drive" })).toBeVisible();
  await expect(table.getByRole("button", { name: "Folder Sermons, Google Drive" })).toBeVisible();
  await expect(table.getByText("agenda.txt")).toHaveCount(0);
  await page.getByTestId("load-more").click();
  await expect(table.getByRole("img", { name: "File agenda.txt, Google Drive" })).toBeVisible();
  await expect(table.getByRole("button", { name: "Folder Photos, Google Drive" })).toHaveCount(1);
  await expect(page.getByTestId("load-more")).toHaveCount(0);

  // A failing drive keeps the other sources and offers a retry.
  let fail = true;
  stub.override = (connectionId, action) => connectionId === ONEDRIVE && action === "files" && fail ? { state: "temporarily_unavailable" } : undefined;
  await page.reload();
  await expect(page.getByTestId("source-alert")).toContainText("OneDrive is busy");
  await expect(page.getByRole("button", { name: "Folder Photos, Google Drive" })).toBeVisible();
  fail = false;
  await page.getByTestId("source-alert").getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("source-alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Folder Photos, OneDrive" })).toBeVisible();

  // Reconnect needed, a provider error and a partial page.
  stub.override = (connectionId, action) => action !== "files" ? undefined
    : connectionId === ONEDRIVE ? { state: "reconnect_needed" } : connectionId === GOOGLE ? { state: "available", data: { items: [folder("g-photos", "Photos", null)], nextCursor: null, partial: true } } : undefined;
  await page.reload();
  await expect(page.getByTestId("source-alert")).toContainText("Reconnect OneDrive");
  await expect(page.getByTestId("partial-notice")).toBeVisible();
  stub.override = (connectionId, action) => connectionId === GOOGLE && action === "files" ? 500 : undefined;
  await page.reload();
  await expect(page.getByTestId("source-alert")).toContainText("Could not load Google Drive.");
  await expect(page.getByTestId("source-alert").getByRole("button", { name: "Try again" })).toBeVisible();
  // A missing folder is a neutral state, not a crash.
  stub.override = (_connectionId, action, input) => action === "files" && input.folderRef === "g-sermons" ? 404 : undefined;
  await page.reload();
  await page.getByRole("button", { name: "Folder Sermons, Google Drive" }).click();
  await expect(page.getByTestId("source-alert")).toContainText("Google Drive is not available for you.");
  stub.override = () => undefined;
  // A connection that needs attention is not a source; the screen says so and Harvest keeps working.
  stub.overview = overview(connection(GOOGLE, "google"), connection(ONEDRIVE, "microsoft", "reconnect_needed", 0));
  await page.reload();
  await expect(page.getByTestId("source-attention")).toBeVisible();
  await expect(chip(page, "OneDrive")).toHaveCount(0);
  await expect(chip(page, "Google Drive")).toBeVisible();
  await expect(page.getByText("welcome.txt").first()).toBeVisible();

  // Sources: Reconnect starts a connect for that same connection id and the drive comes back; Check again calls the read-only health action.
  const started: unknown[] = [];
  stub.override = (connectionId, action, input) => {
    if (action === "startConnect") { started.push(connectionId); return { state: "pending", attemptId: "attempt-1", url: null, expiresAt: new Date(Date.now() + 60_000).toISOString() }; }
    if (action === "finishConnect") { stub.overview = overview(connection(GOOGLE, "google"), connection(ONEDRIVE, "microsoft")); return { state: "connected", connection: connection(ONEDRIVE, "microsoft") }; }
    if (action === "health") { stub.overview = overview(connection(GOOGLE, "google"), connection(ONEDRIVE, "microsoft")); return { state: "available", data: {} }; }
    void input; return undefined;
  };
  await page.getByTestId("sources-open").click();
  await expect(page.getByTestId("source-reconnect")).toBeVisible();
  await expect(page.getByTestId("connect-google")).toHaveCount(0);
  await page.getByTestId("source-reconnect").click();
  await expect(page.getByTestId("source-reconnect")).toHaveCount(0);
  expect(started).toEqual([ONEDRIVE]);
  await page.keyboard.press("Escape");
  await expect(chip(page, "OneDrive")).toBeVisible();
  stub.overview = overview(connection(GOOGLE, "google"), connection(ONEDRIVE, "microsoft", "unavailable", 4));
  await page.reload();
  await expect(chip(page, "OneDrive")).toHaveCount(0);
  await page.getByTestId("sources-open").click();
  await page.getByRole("dialog", { name: "Sources" }).getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("dialog", { name: "Sources" }).getByRole("button", { name: "Check again" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(chip(page, "OneDrive")).toBeVisible();
});

// ---- Audit: axe (WCAG 2.2 AA), overflow and screenshots at 1280, 768 and 360 in both schemes ----------------------------------------------------------------------
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
    // Every rule axe ships (a superset of WCAG 2.2 A and AA, including best practices such as label-content-name-mismatch).
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${name} ${scheme} ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} ${scheme} ${width} overflow`).toBe(true);
    await page.screenshot({ path: `${shots}/${name}-${width}-${scheme}.png`, fullPage: true, animations: "disabled" });
  }
  await session.send("Emulation.clearDeviceMetricsOverride");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("files: accessibility, no horizontal overflow and screenshots at 1280, 768 and 360, light and dark", async ({ page }) => {
  test.setTimeout(1_200_000);
  await mkdir(shots, { recursive: true });
  await signIn(page);
  const tenant = await ministry(page, "Grace Community Church"), files = `/workspaces/${tenant}/files`;
  await page.goto(files);
  await audit(page, "empty", async () => { await expect(page.getByText("No files yet.")).toBeVisible(); });
  await upload(page, "welcome.txt", "text/plain", Buffer.from("Welcome to the ministry files\n"));
  await upload(page, "logo.png", "image/png", png);
  await audit(page, "harvest-only", async () => { await expect(page.getByTestId("storage-total")).toContainText("2 files"); });
  const stub = stubState(connection(GOOGLE, "google"), connection(ONEDRIVE, "microsoft"));
  await stubOffice(page, stub);
  await page.reload();
  await audit(page, "home-three-sources", async () => { await expect(page.getByTestId("folder-card")).toHaveCount(5); await expect(page.getByRole("img", { name: "File budget.pdf, OneDrive" })).toBeVisible(); });
  await audit(page, "home-one-source", async () => { await expect(page.getByTestId("folder-card")).toHaveCount(2); },
    async () => { await chip(page, "Google Drive").click(); await expect(marks(page)).toHaveCount(0); });
  const open = async () => { await page.getByRole("button", { name: "Folder Photos, Google Drive" }).click(); await expect(page.getByTestId("files-explorer").getByRole("img", { name: "File team.png, Google Drive" })).toBeVisible(); };
  await audit(page, "list-folder", async () => { await expect(page.getByTestId("files-explorer")).toBeVisible(); }, open);
  await audit(page, "search", async () => { await expect(page.getByTestId("files-explorer").getByRole("button", { name: "Folder Photos, OneDrive" })).toBeVisible(); },
    async () => { await page.getByTestId("files-search").fill("photos"); await expect(page.getByTestId("files-explorer").getByRole("button", { name: "Folder Photos, OneDrive" })).toBeVisible(); });
  await audit(page, "sources-dialog", async () => { await expect(page.getByRole("dialog", { name: "Sources" })).toBeVisible(); },
    async () => { await page.getByTestId("sources-open").click(); await expect(page.getByRole("dialog", { name: "Sources" })).toBeVisible(); });
  await audit(page, "upload-dialog", async () => { await expect(page.getByRole("dialog", { name: "Upload a file" })).toBeVisible(); },
    async () => { await page.getByRole("button", { name: "Upload", exact: true }).click(); await expect(page.getByRole("dialog", { name: "Upload a file" })).toBeVisible(); });
  stub.override = (connectionId, action) => action === "files" ? (connectionId === ONEDRIVE ? { state: "reconnect_needed" } : connectionId === GOOGLE ? { state: "available", data: { items: [folder("g-photos", "Photos", null)], nextCursor: "2", partial: true } } : undefined) : undefined;
  await audit(page, "states", async () => { await expect(page.getByTestId("source-alert")).toBeVisible(); await expect(page.getByTestId("partial-notice")).toBeVisible(); });
});
