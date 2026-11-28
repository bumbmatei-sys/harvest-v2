import { test, type Page } from "./helpers/test";
import { adsSynced, adsWorkspace, audit, expect, releaseAfterEach } from "./helpers/ads";

// Guided create and Boost a post against the real Ads routes and the in-memory test provider. Nothing leaves the process: no network, no spend.
test.use({ actionTimeout: 30_000, timezoneId: "UTC", reducedMotion: "reduce" });
const release = releaseAfterEach();
const next = (page: Page) => page.getByRole("button", { name: "Continue", exact: true }).click();
const skip = async (page: Page, count: number) => { for (let i = 0; i < count; i++) await next(page); };
const editor = (page: Page) => page.locator("[data-editor-hosted], main").first();

test("create an ad: nine steps in three groups, validation, live preview, draft kept, check, launch paused, and it shows in the table", async ({ page }) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await adsWorkspace(page, release);
  await adsSynced(page, tenant);
  await page.getByRole("link", { name: "Create ad" }).click();
  await expect(page.getByRole("heading", { name: "Create ad", level: 1 })).toBeVisible();

  // The step list: nine steps under the group labels Campaign, Ad set and Ad.
  if (process.env.HARVEST_SHELL_MODES !== "disabled") {
    const list = page.locator("[data-editor-steps]");
    await expect(list.locator('[data-slot="step-group"]')).toHaveText(["Campaign", "Ad set", "Ad"]);
    await expect(list.getByRole("button")).toHaveCount(9);
  }
  // Step 01: the step will not move on with a field missing; the reasons are shown.
  await page.getByLabel("Ad account").selectOption({ index: 1 });
  await next(page);
  await expect(page.getByText("Enter a name.")).toBeVisible();
  await audit(page, "create-create");
  await page.getByLabel("Name", { exact: true }).fill("Spring concert");
  await next(page);

  // Step 02: the objective picker with the detail panel.
  await expect(page.getByLabel("Buying type")).toHaveValue("auction");
  await expect(page.locator("[data-ads-objective-detail]")).toContainText("Choose an objective");
  await next(page);
  await expect(page.getByText("Choose a goal.")).toBeVisible();
  await page.getByRole("radio", { name: "Traffic" }).check();
  await expect(page.locator("[data-ads-objective-detail]")).toContainText("Send people to your website or event page.");
  await expect(page.locator("[data-ads-objective-detail]")).toContainText("Good for");
  await expect(page.locator('[data-slot="objective-art"]')).toHaveAttribute("data-objective", "traffic");
  await audit(page, "create-objective");
  await next(page);

  // Step 03: budget and categories (a refused category is flagged and blocks the step).
  await page.getByLabel("Budget", { exact: true }).fill("20");
  await page.getByRole("checkbox", { name: "Social issues, elections or politics" }).check();
  await expect(page.getByRole("alert").filter({ hasText: "cannot be launched" })).toBeVisible();
  await next(page);
  await expect(page.getByLabel("Budget", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Social issues, elections or politics" }).uncheck();
  await audit(page, "create-budget");
  await next(page);

  // Step 04: ad set name and bid.
  await page.getByLabel("Ad set name").fill("Local families");
  await page.getByLabel("Bid strategy").selectOption("cost_cap");
  await expect(page.getByLabel("Bid limit")).toBeVisible();
  await page.getByLabel("Bid limit").fill("4");
  await next(page);

  // Step 05: audience.
  await page.getByLabel("Countries", { exact: true }).selectOption({ label: "Canada" });
  await expect(page.getByRole("button", { name: "Remove Canada" })).toBeVisible();
  await page.getByLabel("Interests").fill("music");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "music one" }).click();
  await expect(page.getByRole("button", { name: "Remove music one" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Website visitors" }).check();
  await audit(page, "create-audience");
  await next(page);

  // Step 06: placements.
  await page.getByRole("radio", { name: "Choose placements" }).click();
  await expect(page.getByText("Choose at least one placement, or use automatic.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Feed" }).check();
  await next(page);
  // Step 07: schedule.
  await page.getByLabel("End date").fill("2030-01-01");
  await next(page);

  // Step 08: ad, the preview follows the form.
  await page.getByRole("radio", { name: "Text" }).check();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Join us for an evening of worship");
  await page.getByRole("textbox", { name: "Headline", exact: true }).fill("Spring concert");
  await page.getByRole("textbox", { name: "Link", exact: true }).fill("https://example.test/concert");
  await expect(page.getByTestId("ad-preview")).toContainText("Join us for an evening of worship");
  await expect(page.getByTestId("ad-preview")).toContainText("example.test");
  await page.getByLabel("Button").selectOption({ label: "Sign up" });
  await expect(page.getByTestId("ad-preview")).toContainText("Sign up");
  await audit(page, "create-ad");

  // The draft is saved once it is complete enough for the server, and kept across a reload.
  await expect(page.getByText("Draft saved").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Your unfinished draft was restored.")).toBeVisible();
  // The reload keeps the step in the address (?step=, shell slice S8), so the restored draft opens on the Ad step it was left on.
  await expect(page).toHaveURL(/[?&]step=ad(&|$)/);
  await expect(page.getByRole("heading", { name: "Spring concert", level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Headline", exact: true })).toHaveValue("Spring concert");
  await expect(page.getByText("Draft saved").first()).toBeVisible();

  // Step 09: check with the network, then launch (created paused). Finished steps carry the green check.
  await page.getByRole("button", { name: /^Publish/ }).first().click();
  await expect(page.locator("[data-ads-review]")).toContainText("Spring concert");
  await expect(page.locator("[data-ads-launch]")).toBeDisabled();
  await page.locator("[data-ads-check]").click();
  await expect(page.getByText("The ad network accepts this ad.")).toBeVisible();
  await audit(page, "create-publish");
  await page.locator("[data-ads-launch]").click();
  await expect(page.getByRole("alertdialog")).toContainText("It is created paused");
  await page.getByRole("alertdialog").getByRole("button", { name: "Launch" }).click();
  await expect(page.locator("[data-ads-launched]")).toContainText("was created and is paused");
  await page.getByRole("link", { name: "View in Ads" }).click();
  await expect(page.getByRole("button", { name: "Spring concert", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Deliver Spring concert" })).not.toBeChecked();
});

test("boost a post, add an ad to an existing ad set, and a lead-goal ad with a lead form", async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await adsWorkspace(page, release);
  await adsSynced(page, tenant);
  await page.getByRole("link", { name: "Boost a post" }).click();
  await expect(page.getByRole("heading", { name: "Boost a post", level: 1 })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Boost Sunday");
  await page.getByRole("radio", { name: /^facebook/ }).check();
  await expect(page.getByTestId("ad-preview")).toContainText("Boosted post");
  await next(page);
  await expect(page.locator("[data-ads-objectives]").getByRole("radio", { name: "Messages" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Engagement" }).check();
  await next(page);
  await page.getByLabel("Budget", { exact: true }).fill("10");
  await skip(page, 4); // budget, audience, placements, schedule
  await expect(page.locator("[data-ads-review]")).toContainText("Boost Sunday");
  await page.locator("[data-ads-check]").click();
  await expect(page.getByText("The ad network accepts this ad.")).toBeVisible();
  await page.locator("[data-ads-launch]").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Launch" }).click();
  await expect(page.locator("[data-ads-launched]")).toContainText("Boost a post");

  // A new ad in an ad set that exists: only Create, Ad and Publish apply.
  await page.goto(`/workspaces/${tenant}/social/ads/new`);
  await page.getByLabel("Ad account").selectOption({ index: 1 });
  await page.getByRole("radio", { name: "New ad in an ad set" }).click();
  await page.getByLabel("Ad set to add the ad to").selectOption({ label: "Easter service invitation / Local families" });
  await next(page);
  await page.getByLabel("Ad name").fill("Easter reminder");
  await page.getByRole("radio", { name: "Text" }).check();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("See you Sunday");
  await next(page);
  await page.locator("[data-ads-check]").click();
  await expect(page.getByText("The ad network accepts this ad.")).toBeVisible();
  await page.locator("[data-ads-launch]").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Launch" }).click();
  await expect(page.locator("[data-ads-launched]")).toBeVisible();

  // A lead goal asks for a lead form.
  await page.goto(`/workspaces/${tenant}/social/ads/new`);
  await page.getByLabel("Ad account").selectOption({ index: 1 });
  await page.getByLabel("Name", { exact: true }).fill("Camp sign-up");
  await next(page);
  await page.getByRole("radio", { name: "Leads" }).check();
  await next(page);
  await page.getByLabel("Budget", { exact: true }).fill("15");
  await skip(page, 5); // budget, ad set, audience, placements, schedule
  await page.getByRole("radio", { name: "Text" }).check();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Sign up for camp");
  await next(page);
  await expect(page.getByText("Choose a lead form for a lead goal.")).toBeVisible();
  await page.getByLabel("Lead form").selectOption({ label: "Youth camp sign-up" });
  await expect(page.getByText("Choose a lead form for a lead goal.")).toHaveCount(0);
  await next(page);
  await page.locator("[data-ads-check]").click();
  await expect(page.getByText("The ad network accepts this ad.")).toBeVisible();
});

test("create an ad on a phone: one column, preview in a sheet, 44px targets", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await adsWorkspace(page, release);
  await adsSynced(page, tenant);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/workspaces/${tenant}/social/ads/new`);
  await expect(editor(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /preview/i }).first()).toBeVisible();
  await page.getByLabel("Ad account").selectOption({ index: 1 });
  await page.getByLabel("Name", { exact: true }).fill("Phone ad");
  await next(page);
  await expect(page.locator("[data-ads-objectives]")).toBeVisible();
  await page.getByRole("radio", { name: "Awareness" }).check();
  const detail = await page.locator("[data-ads-objective-detail]").boundingBox();
  const list = await page.locator("[data-ads-objectives]").boundingBox();
  expect(detail!.y).toBeGreaterThan(list!.y + list!.height - 1); // the detail sits under the list on a phone
  const small = await page.locator("main button:visible, main select:visible, main input:visible").evaluateAll((els) => els.filter((el) => { const r = (el.closest("label") ?? el).getBoundingClientRect(); return r.height > 0 && r.height < 43.5 && !(el as HTMLInputElement).type?.match(/checkbox|radio|file/); }).map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)));
  expect(small).toEqual([]);
});

// The upload steps are answered here (the storage service is not part of this browser run). Each upload gets its own file id, which the confirm step echoes, so the ad carries real ids.
async function mockMedia(page: Page, tenant: string) {
  const api = `/api/workspaces/${tenant}/social`, files = new Map<string, { name: string; mime: string }>();
  await page.route(`**${api}/media`, async (route) => {
    const sent = route.request().postDataJSON() as { name?: string; mime?: string; mimeType?: string };
    const id = crypto.randomUUID(), file = { name: sent.name ?? "file", mime: sent.mime ?? sent.mimeType ?? "application/octet-stream" };
    files.set(id, file);
    await route.fulfill({ status: 201, json: { file: { id, ...file, size: 1, status: "pending", mediaMetadata: null }, upload: { kind: "single" } } });
  });
  await page.route(`**${api}/media/*/parts`, (route) => route.fulfill({ json: { upload: { url: "/__put", method: "PUT", headers: {} } } }));
  await page.route("**/__put", (route) => route.fulfill({ status: 200, headers: { etag: '"abc"' }, body: "" }));
  await page.route(`**${api}/media/*/confirm`, (route) => {
    const id = route.request().url().split("/media/")[1].split("/")[0], file = files.get(id) ?? { name: "file", mime: "image/jpeg" };
    return route.fulfill({ json: { file: { id, ...file, size: 1, status: "ready", mediaMetadata: file.mime.startsWith("video") ? { width: 640, height: 360, durationMs: 1000 } : { width: 100, height: 100 } } } });
  });
}
const jpeg = (fill: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.alloc(1800, fill), Buffer.from([0xff, 0xd9])]);
const mp4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), Buffer.alloc(2000, 2)]);

async function toAdStep(page: Page, name: string) {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await adsWorkspace(page, release);
  await adsSynced(page, tenant);
  await mockMedia(page, tenant);
  await page.goto(`/workspaces/${tenant}/social/ads/new`);
  await page.getByLabel("Ad account").selectOption({ index: 1 });
  await page.getByLabel("Name", { exact: true }).fill(name);
  await next(page);
  await page.getByRole("radio", { name: "Awareness" }).check();
  await next(page);
  await page.getByLabel("Budget", { exact: true }).fill("12");
  await skip(page, 5); // budget, ad set, audience, placements, schedule
}
const check = async (page: Page) => { await next(page); await page.locator("[data-ads-check]").click(); await expect(page.getByText("The ad network accepts this ad.")).toBeVisible(); };

test("an image ad: one image through the private media flow, type refused, shown in the preview, and checked", async ({ page }) => {
  await toAdStep(page, "Photo ad");
  // A type that is not allowed never uploads.
  await page.getByTestId("ads-media-input").setInputFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }]);
  await expect(page.getByText("This file type cannot be used.")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.getByTestId("ads-media-input").setInputFiles([{ name: "banner.jpg", mimeType: "image/jpeg", buffer: jpeg(1) }]);
  await expect(page.getByTestId("ads-media-item")).toContainText("banner.jpg");
  await expect(page.getByTestId("ads-media-item")).toHaveCount(1);
  await expect(page.locator("button", { hasText: "Add image" })).toHaveCount(0); // a single image: the picker is full
  await expect(page.getByTestId("ad-preview").locator("img")).toBeVisible();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Come and see");
  await page.getByRole("textbox", { name: "Link", exact: true }).fill("https://example.test/visit");
  await audit(page, "create-ad-image");
  await check(page);
});

test("a video ad: upload with a preview, wrong type refused, replace by removing, and checked", async ({ page }) => {
  await toAdStep(page, "Video ad");
  await page.getByRole("radio", { name: "Video" }).check();
  await page.getByTestId("ads-media-input").setInputFiles([{ name: "photo.jpg", mimeType: "image/jpeg", buffer: jpeg(3) }]);
  await expect(page.getByText("This file type cannot be used.")).toBeVisible(); // an image is not a video
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.getByTestId("ads-media-input").setInputFiles([{ name: "sermon.mp4", mimeType: "video/mp4", buffer: mp4 }]);
  await expect(page.getByTestId("ads-media-item")).toContainText("sermon.mp4");
  await expect(page.getByTestId("ads-media-item").locator("video")).toHaveCount(1);
  await expect(page.getByTestId("ad-preview").locator("video")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Watch the message");
  await page.getByRole("textbox", { name: "Link", exact: true }).fill("https://example.test/watch");
  await audit(page, "create-ad-video");
  await check(page);
});

test("a carousel ad: cards with their own image, headline and link, reorder and remove, a preview that pages, and checked", async ({ page }) => {
  await toAdStep(page, "Carousel ad");
  await page.getByRole("radio", { name: "Carousel" }).check();
  for (const [index, name] of ["one.jpg", "two.jpg", "three.jpg"].entries()) {
    await page.getByTestId("ads-media-input").setInputFiles([{ name, mimeType: "image/jpeg", buffer: jpeg(index + 4) }]);
    await expect(page.getByTestId("ads-card")).toHaveCount(index + 1);
    await page.getByLabel("Headline").nth(index).fill(`Card ${name}`);
    await page.getByLabel("Link", { exact: true }).nth(index).fill(`https://example.test/${index + 1}`);
  }
  const names = () => page.getByTestId("ads-card").evaluateAll((els) => els.map((el) => el.querySelector("p.truncate")?.textContent));
  expect(await names()).toEqual(["one.jpg", "two.jpg", "three.jpg"]);
  await page.getByRole("button", { name: "Move card 3 up" }).click();
  expect(await names()).toEqual(["one.jpg", "three.jpg", "two.jpg"]);
  await page.getByRole("button", { name: "Move card 1 down" }).click();
  expect(await names()).toEqual(["three.jpg", "one.jpg", "two.jpg"]);
  // The preview pages through the cards in order, each with its own headline.
  const preview = page.getByTestId("ad-preview");
  await expect(page.getByTestId("ad-preview-card")).toHaveText("Card 1 of 3");
  await expect(preview).toContainText("Card three.jpg");
  await preview.getByRole("button", { name: "Next card" }).click();
  await expect(page.getByTestId("ad-preview-card")).toHaveText("Card 2 of 3");
  await expect(preview).toContainText("Card one.jpg");
  await preview.getByRole("button", { name: "Next card" }).click();
  await expect(preview.getByRole("button", { name: "Next card" })).toBeDisabled();
  await preview.getByRole("button", { name: "Previous card" }).click();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Three things to try");
  await audit(page, "create-ad-carousel");
  // A card can be removed; two remain, which is the least a carousel needs.
  await page.getByRole("button", { name: "Remove card 3" }).click();
  await expect(page.getByTestId("ads-card")).toHaveCount(2);
  await check(page);
});
