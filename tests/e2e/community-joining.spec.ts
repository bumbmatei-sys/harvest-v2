import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// PR 3: Discover, public page, open join with rules and 18+, personal invitations, my communities.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/communities-pr3";
const sizes = [["phone", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;

async function shoot(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await page.waitForFunction(s => { const t = document.documentElement.dataset.theme; return !t || t === s; }, scheme);
    await page.reload(); await page.waitForTimeout(500);
    await prepare?.();
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function person(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage(), email = await signIn(page);
  return { context, page, email };
}

test("discover, join with rules, invitations and my communities", async ({ page, browser }) => {
  test.setTimeout(300000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/communities`, suffix = Date.now().toString(36);
  const create = async (name: string, slug: string) => (await (await page.request.post(api, { headers: { origin }, data: { name, slug } })).json()) as { id: string; version: number };
  const patch = async (id: string, data: Record<string, unknown>) => {
    const { version } = await (await page.request.get(`${api}/${id}`)).json();
    const response = await page.request.patch(`${api}/${id}`, { headers: { origin }, data: { version, ...data } });
    expect(response.status()).toBe(200);
    return (await response.json()) as { version: number };
  };
  const study = await create("Grace Bible Study", `grace-study-${suffix}`), studySlug = `grace-study-${suffix}`;
  const saved = await patch(study.id, { tagline: "Weekly study and prayer", description: "We read through one book a term.", allowOpen: true, visibility: "listed", discoverOptIn: true, rulesList: ["Be kind.", "Keep prayer requests private."] });
  expect((await page.request.post(`${api}/${study.id}/publish`, { headers: { origin }, data: { version: saved.version, published: true } })).status()).toBe(200);

  // A member finds the community in Discover and joins after accepting the rules and confirming their age.
  const member = await person(browser);
  try {
    member.page.on("pageerror", (error) => errors.push(error.message));
    await member.page.goto(`/discover?q=${encodeURIComponent("grace bible")}`);
    await expect(member.page.getByRole("heading", { name: "Grace Bible Study", level: 2 })).toBeVisible();
    await shoot(member.page, "discover");
    await member.page.getByRole("link", { name: "View Grace Bible Study" }).click();
    await expect(member.page).toHaveURL(new RegExp(`/communities/${studySlug}$`));
    await expect(member.page.getByRole("heading", { name: "Grace Bible Study", level: 1 })).toBeVisible();
    await shoot(member.page, "landing");
    await member.page.getByRole("button", { name: "Join", exact: true }).click();
    const dialog = member.page.getByRole("dialog", { name: "Join Grace Bible Study" });
    const join = dialog.getByRole("button", { name: "Join", exact: true });
    await expect(join).toBeDisabled();
    await dialog.getByLabel("I accept the community rules").click();
    await expect(join).toBeDisabled();
    await dialog.getByLabel("I confirm I am 18 or older").click();
    await join.click();
    await expect(member.page).toHaveURL(new RegExp(`/communities/${studySlug}/forum$`));
    await expect(member.page.getByRole("heading", { name: "All posts", level: 2 })).toBeVisible();
    await shoot(member.page, "home");
  } finally { await member.context.close(); }

  // The rules change while a second person has the dialog open: they are asked again with the new rules.
  const late = await person(browser);
  try {
    await late.page.goto(`/communities/${studySlug}`);
    await late.page.getByRole("button", { name: "Join", exact: true }).click();
    const dialog = late.page.getByRole("dialog", { name: "Join Grace Bible Study" });
    await dialog.getByLabel("I accept the community rules").click();
    await dialog.getByLabel("I confirm I am 18 or older").click();
    await patch(study.id, { rulesList: ["Be kind.", "Keep prayer requests private.", "No selling."] });
    await dialog.getByRole("button", { name: "Join", exact: true }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "The community rules changed" })).toBeVisible();
    await expect(dialog.getByText("No selling.")).toBeVisible();
    await dialog.getByLabel("I accept the community rules").click();
    await dialog.getByRole("button", { name: "Join", exact: true }).click();
    await expect(late.page).toHaveURL(new RegExp(`/communities/${studySlug}/forum$`));
  } finally { await late.context.close(); }

  // A hidden community: the owner invites one address from the editor; only that account can use the link, once.
  const team = await create("Prayer Team", `prayer-team-${suffix}`), teamSlug = `prayer-team-${suffix}`;
  const teamSaved = await patch(team.id, { allowInvite: true });
  expect((await page.request.post(`${api}/${team.id}/publish`, { headers: { origin }, data: { version: teamSaved.version, published: true } })).status()).toBe(200);
  const invited = await person(browser), stranger = await person(browser);
  try {
    invited.page.on("pageerror", (error) => errors.push(error.message));
    expect((await stranger.page.goto(`/communities/${teamSlug}`))?.status()).toBe(404);
    await page.goto(`/workspaces/${tenant}/communities/${team.id}/edit`);
    const steps = page.getByRole("navigation", { name: "Community setup" });
    await steps.getByRole("button", { name: /People/ }).click();
    await page.getByRole("button", { name: "Invite people", exact: true }).click();
    const inviteDialog = page.getByRole("dialog", { name: "Invite someone" });
    await inviteDialog.getByLabel("Email", { exact: true }).fill(invited.email);
    await inviteDialog.getByRole("button", { name: "Create link", exact: true }).click();
    const link = await inviteDialog.getByLabel("Invitation link").inputValue();
    expect(link).toMatch(new RegExp(`/communities/${teamSlug}\\?invite=[a-f0-9]{64}$`));
    await inviteDialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("table", { name: "Invitations" }).getByText("Pending")).toBeVisible();
    await shoot(page, "invites", async () => { await steps.getByRole("button", { name: /People/ }).click(); await expect(page.getByRole("table", { name: "Invitations" })).toBeVisible(); });

    // Someone else holding the link is refused with the neutral message.
    await stranger.page.goto(link);
    await stranger.page.getByRole("button", { name: "Accept invitation", exact: true }).click();
    const strangerDialog = stranger.page.getByRole("dialog");
    await strangerDialog.getByLabel("I confirm I am 18 or older").click();
    await strangerDialog.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(strangerDialog.getByRole("alert").filter({ hasText: "This invitation isn't valid for your account." })).toBeVisible();

    // The invited account sees it in My communities and accepts it there.
    await invited.page.goto("/account/communities");
    await expect(invited.page.getByText("Prayer Team")).toBeVisible();
    await shoot(invited.page, "my-communities");
    await invited.page.getByRole("button", { name: "Accept invitation", exact: true }).click();
    const accept = invited.page.getByRole("dialog");
    await accept.getByLabel("I confirm I am 18 or older").click();
    await accept.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(invited.page).toHaveURL(new RegExp(`/communities/${teamSlug}/forum$`));
    await invited.page.goto(link);
    expect((await invited.page.goto(link))?.status()).toBe(404);
    await invited.page.goto("/account/communities");
    await expect(invited.page.getByRole("link", { name: "Open", exact: true })).toHaveCount(1);

    // A revoked invitation stops working.
    await page.reload();
    await steps.getByRole("button", { name: /People/ }).click();
    await page.getByRole("button", { name: "Invite people", exact: true }).click();
    await inviteDialog.getByLabel("Email", { exact: true }).fill(stranger.email);
    await inviteDialog.getByRole("button", { name: "Create link", exact: true }).click();
    const revoked = await inviteDialog.getByLabel("Invitation link").inputValue();
    await inviteDialog.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: /^Revoke invitation for / }).click();
    await expect(page.getByRole("table", { name: "Invitations" }).getByText("Revoked")).toBeVisible();
    expect((await stranger.page.goto(revoked))?.status()).toBe(404);
  } finally { await invited.context.close(); await stranger.context.close(); }
  expect(errors).toEqual([]);
});
