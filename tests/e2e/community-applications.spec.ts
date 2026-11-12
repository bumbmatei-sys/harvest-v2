import { mkdir } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// PR 4a: the owner builds rules and join questions; people join with answers or apply; the owner reviews.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/communities-pr4a";
const sizes = [["phone", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;

async function shoot(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
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
  const page = await context.newPage();
  await signIn(page);
  return { context, page };
}

test("rules and questions, open join with answers, applications reviewed by the owner", async ({ page, browser }) => {
  test.setTimeout(300000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const slug = `prayer-${Date.now().toString(36)}`;
  const community = (await (await page.request.post(`/api/workspaces/${tenant}/communities`, { headers: { origin }, data: { name: "Prayer Circle", slug } })).json()) as { id: string };
  const editUrl = `/workspaces/${tenant}/communities/${community.id}/edit`;

  // The owner builds rules and questions in the Joining step.
  await page.goto(editUrl);
  const steps = page.getByRole("navigation", { name: "Community setup" });
  await steps.getByRole("button", { name: /Joining/ }).click();
  await page.getByLabel("Listed: appears in Discover", { exact: true }).click();
  await page.getByLabel("Anyone can join", { exact: true }).click();
  await page.getByLabel("Ask new members to agree", { exact: true }).click();
  await page.getByLabel("Rule 1", { exact: true }).fill("Be kind.");
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByLabel("Rule 2", { exact: true }).fill("Keep prayer requests private.");
  await page.getByLabel("Ask new members a few questions", { exact: true }).click();
  const addQuestion = async (type: string, label: string, options: string[] = [], required = false) => {
    await page.getByRole("button", { name: "Add question", exact: true }).click();
    await page.getByRole("menuitem", { name: type, exact: true }).click();
    const editor = page.getByRole("list", { name: "Questions" }).getByRole("listitem").last();
    await editor.getByLabel("Question", { exact: true }).fill(label);
    for (const [i, option] of options.entries()) await editor.getByLabel(`Option ${i + 1}`, { exact: true }).fill(option);
    if (required) await editor.getByLabel("Required", { exact: true }).click();
    await editor.getByRole("button", { name: `Edit "${label}"` }).click();
  };
  await addQuestion("Short answer", "Your city", [], true);
  await addQuestion("Single choice", "Are you part of a church?", ["Yes", "No"], true);
  await addQuestion("Checkboxes", "What would you like?", ["Prayer", "Study"]);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await header.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  await shoot(page, "editor-joining", async () => { await steps.getByRole("button", { name: /Joining/ }).click(); await expect(page.getByLabel("Rule 1", { exact: true })).toHaveValue("Be kind."); });

  // Open join: questions, then rules, then 18+.
  const member = await person(browser);
  try {
    member.page.on("pageerror", (error) => errors.push(error.message));
    await member.page.goto(`/communities/${slug}`);
    const openJoin = async () => {
      await member.page.getByRole("button", { name: "Join", exact: true }).click();
      const dialog = member.page.getByRole("dialog", { name: "Join Prayer Circle" });
      await dialog.getByLabel(/Your city/).fill("Cluj");
      await dialog.getByLabel("Yes", { exact: true }).click();
      await dialog.getByLabel("Study", { exact: true }).click();
      return dialog;
    };
    await shoot(member.page, "join-questions", async () => { await openJoin(); });
    const dialog = member.page.getByRole("dialog", { name: "Join Prayer Circle" });
    const join = dialog.getByRole("button", { name: "Join", exact: true });
    await expect(join).toBeDisabled();
    await dialog.getByLabel("I accept the community rules").click();
    await dialog.getByLabel("I confirm I am 18 or older").click();
    await join.click();
    await expect(member.page).toHaveURL(new RegExp(`/communities/${slug}/forum$`));
  } finally { await member.context.close(); }

  // Approval on: requests become applications.
  await page.goto(editUrl);
  await steps.getByRole("button", { name: /Joining/ }).click();
  await page.getByLabel("People apply first", { exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  const apply = async (city: string) => {
    const someone = await person(browser);
    someone.page.on("pageerror", (error) => errors.push(error.message));
    await someone.page.goto(`/communities/${slug}`);
    await someone.page.getByRole("button", { name: "Apply", exact: true }).click();
    const dialog = someone.page.getByRole("dialog", { name: "Join Prayer Circle" });
    await dialog.getByLabel(/Your city/).fill(city);
    await dialog.getByLabel("No", { exact: true }).click();
    await dialog.getByLabel("I accept the community rules").click();
    await dialog.getByLabel("I confirm I am 18 or older").click();
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Application sent" })).toBeVisible();
    return someone;
  };
  const applicant = await apply("Iasi"), declined = await apply("Brasov"), withdrawing = await apply("Timisoara");
  try {
    await applicant.page.goto("/account/communities");
    await expect(applicant.page.getByText("Pending", { exact: true })).toBeVisible();

    // The owner asks the first applicant for more information.
    const review = async (city: string) => {
      await page.goto(editUrl);
      await steps.getByRole("button", { name: /People/ }).click();
      const table = page.getByRole("table", { name: "Applications" });
      await table.getByRole("row").filter({ hasText: /Pending|More info requested/ }).first().waitFor();
      for (const row of await table.getByRole("row").all()) {
        if (!(await row.getByRole("button").count())) continue;
        await row.getByRole("button").click();
        const sheet = page.getByRole("dialog");
        if (await sheet.getByText(city, { exact: true }).count()) return sheet;
        await page.keyboard.press("Escape");
      }
      throw new Error(`no application from ${city}`);
    };
    let sheet = await review("Iasi");
    await sheet.getByLabel("Private note", { exact: true }).fill("Knows the pastor");
    await sheet.getByLabel("Ask for more information", { exact: true }).fill("Which group do you attend?");
    await sheet.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(sheet).toBeHidden();

    // The applicant sees the request (never the note), edits the answers and sends them again.
    await applicant.page.reload();
    await expect(applicant.page.getByText("Which group do you attend?")).toBeVisible();
    await expect(applicant.page.getByText("Knows the pastor")).toHaveCount(0);
    await shoot(applicant.page, "my-communities-pending");
    await applicant.page.getByRole("button", { name: "Edit answers", exact: true }).click();
    const edit = applicant.page.getByRole("dialog");
    await edit.getByLabel(/Your city/).fill("Iasi, Sunday group");
    await edit.getByRole("button", { name: "Send", exact: true }).click();
    await expect(edit).toBeHidden();
    await expect(applicant.page.getByText("Pending", { exact: true })).toBeVisible();

    sheet = await review("Iasi, Sunday group");
    await expect(sheet.getByLabel("Private note", { exact: true })).toHaveValue("Knows the pastor");
    await shoot(page, "applications-review", async () => { await review("Iasi, Sunday group"); });
    sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(sheet).toBeHidden();
    await applicant.page.goto(`/communities/${slug}/forum`);
    await expect(applicant.page.getByRole("heading", { name: "All posts", level: 2 })).toBeVisible();

    sheet = await review("Brasov");
    await sheet.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(sheet).toBeHidden();
    await declined.page.goto("/account/communities");
    await expect(declined.page.getByText("Declined", { exact: true })).toBeVisible();

    await withdrawing.page.goto("/account/communities");
    await withdrawing.page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(withdrawing.page.getByText("No applications.", { exact: true })).toBeVisible();
    await page.goto(editUrl);
    await steps.getByRole("button", { name: /People/ }).click();
    await expect(page.getByText("No applications waiting.", { exact: true })).toBeVisible();
  } finally { for (const p of [applicant, declined, withdrawing]) await p.context.close(); }
  expect(errors).toEqual([]);
});
