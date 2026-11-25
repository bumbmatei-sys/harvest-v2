import { test, type Page } from "@playwright/test";
import { adsSynced, adsWorkspace, audit, expect, releaseAfterEach } from "./helpers/ads";

// Guided create and Boost a post against the real Ads routes and the in-memory test provider. Nothing leaves the process: no network, no spend.
test.use({ actionTimeout: 30_000, timezoneId: "UTC", reducedMotion: "reduce" });
const release = releaseAfterEach();
const next = (page: Page) => page.getByRole("button", { name: "Next", exact: true }).click();
const editor = (page: Page) => page.locator("[data-editor-hosted], main").first();

test("create an ad: validation, steps, live preview, draft kept, check, launch paused, and it shows in the table", async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await adsWorkspace(page, release);
  await adsSynced(page, tenant);
  await page.getByRole("link", { name: "Create ad" }).click();
  await expect(page.getByRole("heading", { name: "Create ad", level: 1 })).toBeVisible();

  // The step will not move on with a field missing; the reasons are shown.
  await page.getByLabel("Ad account").selectOption({ index: 1 });
  await next(page);
  await expect(page.getByText("Enter a name.")).toBeVisible();
  await expect(page.getByText("Choose a goal.")).toBeVisible();
  await audit(page, "create-goal");

  await page.getByLabel("Name", { exact: true }).fill("Spring concert");
  await page.getByRole("radio", { name: "Traffic" }).check();
  await next(page);

  // Ad set: audience, placements, budget, categories (a refused category is flagged).
  await page.getByLabel("Countries", { exact: true }).selectOption({ label: "Canada" });
  await expect(page.getByRole("button", { name: "Remove Canada" })).toBeVisible();
  await page.getByLabel("Interests").fill("music");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "music one" }).click();
  await expect(page.getByRole("button", { name: "Remove music one" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Website visitors" }).check();
  await page.getByRole("radio", { name: "Choose placements" }).click();
  await expect(page.getByText("Choose at least one placement, or use automatic.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Feed" }).check();
  await page.getByLabel("Budget", { exact: true }).fill("20");
  await page.getByRole("checkbox", { name: "Social issues, elections or politics" }).check();
  await expect(page.getByRole("alert").filter({ hasText: "cannot be launched" })).toBeVisible();
  await next(page);
  await expect(page.getByRole("heading", { name: "Ad set" })).toBeVisible(); // a refused category blocks the step
  await page.getByRole("checkbox", { name: "Social issues, elections or politics" }).uncheck();
  await audit(page, "create-adset");
  await next(page);

  // Ad: the preview follows the form.
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
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Spring concert");

  // Review: check with the network, then launch (created paused).
  await page.getByRole("button", { name: "Review and launch" }).first().click();
  await expect(page.locator("[data-ads-review]")).toContainText("Spring concert");
  await expect(page.locator("[data-ads-launch]")).toBeDisabled();
  await page.locator("[data-ads-check]").click();
  await expect(page.getByText("The ad network accepts this ad.")).toBeVisible();
  await audit(page, "create-review");
  await page.locator("[data-ads-launch]").click();
  await expect(page.getByRole("alertdialog")).toContainText("It is created paused");
  await page.getByRole("alertdialog").getByRole("button", { name: "Launch" }).click();
  await expect(page.locator("[data-ads-launched]")).toContainText("was created and is paused");
  await page.getByRole("link", { name: "View in Ads" }).click();
  await expect(page.getByRole("button", { name: "Spring concert", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Deliver Spring concert" })).not.toBeChecked();
});

test("boost a post and a lead-goal ad with a lead form", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await adsWorkspace(page, release);
  await adsSynced(page, tenant);
  await page.getByRole("link", { name: "Boost a post" }).click();
  await expect(page.getByRole("heading", { name: "Boost a post", level: 1 })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Boost Sunday");
  await page.getByRole("radio", { name: "Engagement" }).check();
  await page.getByRole("radio", { name: /^facebook/ }).check();
  await expect(page.getByTestId("ad-preview")).toContainText("Boosted post");
  await next(page);
  await page.getByLabel("Budget", { exact: true }).fill("10");
  await next(page);
  await expect(page.getByRole("heading", { name: "Review and launch" }).first()).toBeVisible();
  await page.locator("[data-ads-check]").click();
  await expect(page.getByText("The ad network accepts this ad.")).toBeVisible();
  await page.locator("[data-ads-launch]").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Launch" }).click();
  await expect(page.locator("[data-ads-launched]")).toContainText("Boost a post");

  // A lead goal asks for a lead form.
  await page.goto(`/workspaces/${tenant}/social/ads/new`);
  await page.getByLabel("Ad account").selectOption({ index: 1 });
  await page.getByLabel("Name", { exact: true }).fill("Camp sign-up");
  await page.getByRole("radio", { name: "Leads" }).check();
  await next(page);
  await page.getByLabel("Budget", { exact: true }).fill("15");
  await next(page);
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
  const small = await page.locator("main button:visible, main select:visible, main input:visible").evaluateAll((els) => els.filter((el) => { const r = (el.closest("label") ?? el).getBoundingClientRect(); return r.height > 0 && r.height < 43.5 && !(el as HTMLInputElement).type?.match(/checkbox|radio|file/); }).map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)));
  expect(small).toEqual([]);
});

test("an image ad: upload through the private media flow, shown in the preview, and checked", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const tenant = await adsWorkspace(page, release);
  await adsSynced(page, tenant);
  // The upload steps are answered here (the storage service is not part of this browser run); the ad then carries the file id the confirm step returns.
  const api = `/api/workspaces/${tenant}/social`, fileId = "6f1c1f0e-2b3a-4c55-9d0e-0a1b2c3d4e5f";
  await page.route(`**${api}/media`, (route) => route.fulfill({ status: 201, json: { file: { id: fileId, name: "banner.jpg", mime: "image/jpeg", size: 1, status: "pending", mediaMetadata: null }, upload: { kind: "single" } } }));
  await page.route(`**${api}/media/*/parts`, (route) => route.fulfill({ json: { upload: { url: "/__put", method: "PUT", headers: {} } } }));
  await page.route("**/__put", (route) => route.fulfill({ status: 200, headers: { etag: '"abc"' }, body: "" }));
  await page.route(`**${api}/media/*/confirm`, (route) => route.fulfill({ json: { file: { id: fileId, name: "banner.jpg", mime: "image/jpeg", size: 1, status: "ready", mediaMetadata: { width: 100, height: 100 } } } }));
  await page.goto(`/workspaces/${tenant}/social/ads/new`);
  await page.getByLabel("Ad account").selectOption({ index: 1 });
  await page.getByLabel("Name", { exact: true }).fill("Photo ad");
  await page.getByRole("radio", { name: "Awareness" }).check();
  await next(page);
  await page.getByLabel("Budget", { exact: true }).fill("12");
  await next(page);
  // A type that is not allowed never uploads.
  await page.getByTestId("ads-media-input").setInputFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }]);
  await expect(page.getByText("This file type cannot be used.")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.alloc(1800, 1), Buffer.from([0xff, 0xd9])]);
  await page.getByTestId("ads-media-input").setInputFiles([{ name: "banner.jpg", mimeType: "image/jpeg", buffer: jpeg }]);
  await expect(page.getByTestId("ads-media-item")).toContainText("banner.jpg");
  await expect(page.getByTestId("ad-preview").locator("img")).toBeVisible();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Come and see");
  await page.getByRole("textbox", { name: "Link", exact: true }).fill("https://example.test/visit");
  await next(page);
  await page.locator("[data-ads-check]").click();
  await expect(page.getByText("The ad network accepts this ad.")).toBeVisible();
});
