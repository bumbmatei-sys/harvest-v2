import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

const expect = baseExpect.configure({ timeout: 30000 });
// Newsletter Review step: summary, blocking checklist, test result, schedule in the ministry's time zone, change time, cancel, duplicate.
// Sending is off throughout: scheduling queues the email and nothing reaches a provider.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/newsletter-review";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;
const zone = "America/Chicago";

async function shoot(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}
/** Tomorrow at a wall-clock time in the ministry's zone, as a datetime-local value. */
function tomorrowAt(time: string) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86_400_000));
  return `${day}T${time}`;
}

test("newsletter review: checklist, schedule, change time and cancel with sending off", async ({ page }) => {
  test.setTimeout(600000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const headers = { origin };
  const tenant = (await (await page.request.post("/api/workspaces", { headers, timeout: 120_000, data: { name: "Grace Community Church", audience: "church", timeZone: zone } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/newsletter`;
  const ok = async (response: Awaited<ReturnType<Page["request"]["post"]>>) => { expect(response.status(), await response.text()).toBeLessThan(300); return response.json(); };

  // Synthetic sender: a test domain, a from and a reply-to address confirmed with the test code, and a mailing address.
  const domain = await ok(await page.request.post(`${api}/sender-domains`, { headers, timeout: 120_000, data: { domain: "review.example.test" } }));
  await ok(await page.request.post(`${api}/sender-domains/${domain.id}/verify`, { headers, timeout: 120_000, data: {} }));
  for (const [address, purpose] of [["hello@review.example.test", "sender"], ["replies@review.example.test", "reply-to"]] as const) {
    const created = await ok(await page.request.post(`${api}/sender-identities`, { headers, timeout: 120_000, data: { address, purpose } }));
    const id = created.identity.id as string;
    const { code } = await (await page.request.get(`${api}/sender-identities/${id}/test-code`, { timeout: 120_000 })).json();
    await ok(await page.request.patch(`${api}/sender-identities/${id}`, { headers, timeout: 120_000, data: { version: created.identity.version, action: "confirm", code } }));
  }
  await ok(await page.request.put(`${api}/mailing-address`, { headers, timeout: 120_000, data: { address: "100 Main Street, Springfield" } }));
  // One consented subscriber on one list.
  const audience = (await ok(await page.request.post(`${api}/audiences`, { headers, timeout: 120_000, data: { name: "Everyone" } }))).id as string;
  const list = (await ok(await page.request.post(`${api}/lists`, { headers, timeout: 120_000, data: { audienceId: audience, name: "Weekly list" } }))).id as string;
  const person = (await ok(await page.request.post(`/api/workspaces/${tenant}/contacts`, { headers, timeout: 120_000, data: { name: "Synthetic Ana Costa", email: "ana@example.test" } }))).id as string;
  await ok(await page.request.post(`/api/workspaces/${tenant}/contacts/${person}/consents`, { headers, timeout: 120_000, data: { purpose: "newsletter", channel: "email", status: "granted", noticeVersion: "notice-v1", source: "Synthetic newsletter granted", evidence: "Synthetic evidence" } }));
  const subscriber = (await ok(await page.request.post(`${api}/subscribers`, { headers, timeout: 120_000, data: { contactId: person } }))).id as string;
  await ok(await page.request.put(`${api}/lists/${list}/subscribers/${subscriber}`, { headers, timeout: 120_000, data: { state: "subscribed", version: 0 } }));

  // A campaign from a template; its buttons get links so only the scheduling choices are left.
  await page.goto(`/workspaces/${tenant}/newsletter/campaigns`);
  await page.locator('section [data-template="weekly-update"]').getByRole("button", { name: "Use Weekly update" }).click();
  await expect(page).toHaveURL(/\/newsletter\/campaigns\/[0-9a-f-]{36}$/);
  const campaignId = page.url().split("/").at(-1)!;
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  const current = await (await page.request.get(`${api}/campaigns/${campaignId}`, { timeout: 120_000 })).json();
  const doc = current.content as { brand: Record<string, unknown>; blocks: Record<string, unknown>[] };
  doc.brand.address = "100 Main Street, Springfield";
  for (const block of doc.blocks) {
    if ("buttonUrl" in block) block.buttonUrl = "https://example.test/more";
    if (Array.isArray(block.links)) block.links = (block.links as { label: string }[]).map((link) => ({ ...link, url: "https://example.test/social" }));
  }
  await ok(await page.request.patch(`${api}/campaigns/${campaignId}`, { headers, timeout: 120_000, data: { name: current.name, subject: current.subject, preheader: "This week at Grace",
    senderId: null, replyToId: null, selection: { listIds: [], segmentIds: [] }, content: doc, version: current.version } }));
  await page.reload();

  // Send step: audience, addresses and a time in the ministry's zone.
  const steps = page.getByRole("navigation", { name: "Campaign steps" });
  await steps.getByRole("button", { name: /^Send/ }).click();
  await page.getByRole("checkbox", { name: "Weekly list" }).check();
  await expect(page.locator("[data-recipient-count]")).toContainText("1 of 1 people will receive it.");
  await page.locator("#nl-senderId").selectOption({ label: "hello@review.example.test" });
  await page.locator("#nl-replyToId").selectOption({ label: "replies@review.example.test" });
  await page.getByRole("radio", { name: "Pick a time" }).check();
  await expect(page.locator("[data-time-zone]")).toContainText(zone);
  await page.getByLabel("Date and time").fill(tomorrowAt("09:00"));
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  await page.locator("[data-review-button]").click();

  // Review: nothing blocks, the summary matches, a test goes to the test inbox.
  await expect(page.locator("[data-sending-off]")).toContainText("Sending is off");
  await expect(page.locator("[data-blocking]")).toHaveAttribute("data-blocking", "0");
  await expect(page.locator('[data-summary="audience"]')).toHaveText("Weekly list");
  await expect(page.locator('[data-summary="recipients"]')).toHaveText("1 of 1 people will receive it.");
  await expect(page.locator('[data-summary="preheader"]')).toHaveText("This week at Grace");
  await expect(page.locator('[data-summary="from"]')).toContainText("hello@review.example.test");
  await expect(page.locator('[data-summary="when"]')).toContainText(`9:00 AM (${zone})`);
  await page.locator("[data-review-step]").getByRole("button", { name: "Send me a test" }).click();
  await expect(page.locator('[data-test-result="sent"]')).toContainText("Test sent to the test inbox");
  await shoot(page, "ready");

  // Schedule: the server review is confirmed in a dialog, then the email is queued, not sent.
  await page.locator("[data-schedule-button]").click();
  const confirm = page.getByRole("alertdialog", { name: "Schedule this email?" });
  await expect(confirm).toContainText("1 of 1 people");
  await expect(confirm).toContainText("Sending is off");
  await confirm.getByRole("button", { name: "Schedule" }).click();
  await expect(page.locator('[data-dispatch-state="scheduled"]')).toBeVisible();
  await expect(page.locator("[data-scheduled-at]")).toContainText(`9:00 AM (${zone})`);
  const scheduled = await (await page.request.get(`${api}/campaigns/${campaignId}`, { timeout: 120_000 })).json();
  expect(scheduled).toMatchObject({ state: "scheduled", timezone: zone });
  // A scheduled email is frozen: reloading opens Review, and Write shows why it cannot change.
  await page.reload();
  await expect(page.locator('[data-dispatch-state="scheduled"]')).toBeVisible();
  await shoot(page, "scheduled");
  await steps.getByRole("button", { name: /^Write/ }).click();
  await expect(page.locator("[data-locked]")).toContainText("Cancel the schedule to make changes.");
  await steps.getByRole("button", { name: /^Review/ }).click();

  // Change the time, then cancel.
  await page.getByRole("button", { name: "Change time" }).click();
  await page.getByLabel("New date and time").fill(tomorrowAt("18:30"));
  await page.getByRole("button", { name: "Save new time" }).click();
  await expect(page.locator("[data-scheduled-at]")).toContainText(`6:30 PM (${zone})`);
  expect((await (await page.request.get(`${api}/campaigns/${campaignId}`, { timeout: 120_000 })).json()).version).toBe(scheduled.version + 1);
  await page.getByRole("button", { name: "Cancel schedule" }).click();
  await page.getByRole("alertdialog", { name: "Cancel this schedule?" }).getByRole("button", { name: "Cancel schedule" }).click();
  await expect(page.locator('[data-dispatch-state="cancelled"]')).toBeVisible();
  await shoot(page, "cancelled");
  await page.getByRole("button", { name: "Duplicate as a new draft" }).click();
  await expect(page).not.toHaveURL(new RegExp(campaignId));
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  expect(errors).toEqual([]);
});
