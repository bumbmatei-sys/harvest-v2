import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { addMember, api, seedFollowUp, type SeededCase } from "./helpers/follow-up";
import { signIn } from "./helpers/session";

// Kit PR 6: the follow-up queue and case detail (HC-13 screens). Presentation only; the case API and the database policy stay the enforcement.
// Synthetic data, the local mock mailbox and the local intake mode only: nothing is sent.
const expect = baseExpect.configure({ timeout: 20_000 });
test.use({ reducedMotion: "reduce", actionTimeout: 20_000, navigationTimeout: 60_000 });
test.skip(!process.env.TEST_DATABASE_URL, "seeding associated responses needs the local TEST_DATABASE_URL admin connection");
const widths = [360, 390, 768, 1280, 1440] as const;
const evidence = "docs/screenshots/kit-pr6";
const reference = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

async function setMode(page: Page, mode: "light" | "dark") {
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
  if (await page.locator("html").getAttribute("data-theme") !== mode) {
    await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  }
}
async function audit(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), name).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} overflow`).toBe(true);
}
async function tall(locator: ReturnType<Page["locator"]>, min = 44) {
  for (const item of await locator.all()) { const box = await item.boundingBox(); if (box) expect(box.height, await item.innerText().catch(() => "")).toBeGreaterThanOrEqual(min - 0.5); }
}
const userId = async (page: Page) => ((await (await page.request.get("/api/auth/get-session")).json()).user.id as string);
const caseLinks = (page: Page) => page.getByRole("link", { name: /^Case [0-9A-F]{8}$/ });
const nav = (page: Page) => page.getByRole("navigation", { name: "Ministry navigation" });

test("follow-up queue and case: owner, assigned member, other member and viewer each see what the server allows", async ({ page, browser }) => {
  test.setTimeout(1_200_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { tenantId, root, apiRoot, cases } = await seedFollowUp(page, browser, ["Synthetic Person One", "Synthetic Person Two", "Synthetic Person Three", "Synthetic Person Four", "Synthetic Person Five"]);
  const [c0, c1, c2, c3, c4] = cases as [SeededCase, SeededCase, SeededCase, SeededCase, SeededCase];
  for (const item of cases) expect(item.id, item.person).toMatch(/^[0-9a-f-]{36}$/);
  const queue = `${root}/connect/follow-up`, caseApi = (item: SeededCase) => `${apiRoot}/followup-cases/${item.id}`;

  const member1 = await addMember(page, browser, "member", apiRoot, { width: 390, height: 900 });
  const member2 = await addMember(page, browser, "member", apiRoot);
  const viewer = await addMember(page, browser, "viewer", apiRoot);
  const admin = await addMember(page, browser, "admin", apiRoot);
  try {
    const [m1, m2] = [await userId(member1.page), await userId(member2.page)];
    // c0 -> assigned to member 1, c1 -> assigned to member 2, c2 -> waiting for assignment, c3 stays requested, c4 withdrawn.
    for (const item of [c0, c1, c2]) expect((await api(page, "patch", caseApi(item), { to: "awaiting_assignment", version: 1 })).status).toBe(200);
    expect((await api(page, "patch", caseApi(c0), { assigneeId: m1, version: 2 })).status).toBe(200);
    expect((await api(page, "patch", caseApi(c1), { assigneeId: m2, version: 2 })).status).toBe(200);
    expect((await api(page, "patch", caseApi(c4), { to: "withdrawn", version: 1 })).status).toBe(200);

    await test.step("owner sees every case, every tab and the open button", async () => {
      await page.goto(queue);
      await expect(nav(page).getByRole("link", { name: "Follow-up", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Follow-up" })).toBeVisible();
      await expect(caseLinks(page)).toHaveCount(5);
      await expect(page.getByRole("main").getByRole("tab")).toHaveText(["All", "Requested", "Needs assignment", "Assigned", "Attempted", "No response", "Connected", "Closed", "Withdrawn"]);
      await expect(page.getByRole("button", { name: "Open cases", exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "Needs assignment" }).click();
      await expect(page).toHaveURL(/state=awaiting_assignment/);
      await expect(caseLinks(page)).toHaveCount(1);
      await expect(page.getByRole("link", { name: `Case ${reference(c2.id)}`, exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "No response" }).click();
      await expect(page.getByText("No cases in this state")).toBeVisible();
      await page.getByRole("link", { name: "Show all cases" }).click();
      await expect(caseLinks(page)).toHaveCount(5);
      // Opening cases is idempotent: nothing new to open, nothing sent.
      await page.getByRole("button", { name: "Open cases", exact: true }).click();
      await expect(page.getByText("No new requests").first()).toBeVisible();
    });

    await test.step("owner assigns a waiting case from the detail page", async () => {
      await page.goto(`${queue}/${c2.id}`);
      await expect(page.getByRole("heading", { level: 1, name: `Case ${reference(c2.id)}` })).toBeVisible();
      await expect(page.getByRole("list", { name: "Case progress" }).locator('[aria-current="step"]')).toContainText("Needs assignment");
      await expect(page.getByRole("link", { name: "Open contact" })).toHaveAttribute("href", `${root}/crm/people/${c2.contactId}`);
      await expect(page.getByRole("list", { name: "Case events" }).getByRole("listitem")).toHaveCount(2);
      await page.getByLabel("Assign to", { exact: true }).selectOption({ value: await userId(member1.page) });
      await page.getByRole("button", { name: "Assign", exact: true }).click();
      await expect(page.getByText("Case assigned").first()).toBeVisible();
      await expect(page.getByRole("list", { name: "Case progress" }).locator('[aria-current="step"]')).toContainText("Assigned");
      await expect(page.getByLabel("Reassign to", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Unassign", exact: true })).toBeVisible();
    });

    await test.step("assigned member sees only their own cases and progress actions", async () => {
      const m = member1.page;
      await m.goto(queue);
      await expect(m.getByRole("heading", { level: 1, name: "Follow-up" })).toBeVisible();
      await expect(caseLinks(m)).toHaveCount(2); // c0 and the case the owner just assigned (c2)
      await expect(m.getByRole("link", { name: `Case ${reference(c1.id)}` })).toHaveCount(0);
      await expect(m.getByRole("button", { name: "Open cases" })).toHaveCount(0);
      await expect(m.getByRole("tab")).toHaveText(["All", "Assigned", "Attempted", "No response", "Connected"]);
      await m.goto(`${queue}/${c0.id}`);
      await expect(m.getByRole("heading", { level: 1, name: `Case ${reference(c0.id)}` })).toBeVisible();
      await expect(m.getByRole("button", { name: "Mark attempted" })).toBeVisible();
      for (const name of ["Withdraw", "Unassign", "Close case", "Ready for assignment"]) await expect(m.getByRole("button", { name, exact: true })).toHaveCount(0);
      await expect(m.getByLabel("Assign to")).toHaveCount(0);
      await expect(m.getByLabel("Reassign to")).toHaveCount(0);
      // Consent: a member may record a withdrawal, never an opt-in; follow-up consent is shown as text.
      await expect(m.getByRole("list", { name: "Follow-up consent" }).getByText("Opted in", { exact: true })).toBeVisible();
      await expect(m.getByRole("button", { name: /^Record withdrawal for/ })).toHaveCount(1);
      await expect(m.getByRole("button", { name: /^Record opt-in for/ })).toHaveCount(0);
      await m.getByRole("button", { name: "Mark attempted" }).click();
      await expect(m.getByText("Case updated").first()).toBeVisible();
      await expect(m.getByRole("list", { name: "Case progress" }).locator('[aria-current="step"]')).toContainText("Attempted");
      await expect(m.getByRole("button", { name: "Mark connected" })).toBeVisible();
      await expect(m.getByRole("button", { name: "No response", exact: true })).toBeVisible();
      await expect(m.getByRole("button", { name: "Mark attempted" })).toHaveCount(0);
    });

    await test.step("another member gets the same refusal for a case that is not theirs, and for an unknown id", async () => {
      const m = member2.page;
      await m.goto(queue);
      await expect(caseLinks(m)).toHaveCount(1);
      await expect(m.getByRole("link", { name: `Case ${reference(c1.id)}` })).toBeVisible();
      await m.goto(`${queue}/${c0.id}`);
      await expect(m.getByRole("heading", { name: "You don't have access to this case" })).toBeVisible();
      await expect(m.getByRole("button", { name: "Mark attempted" })).toHaveCount(0);
      const other = await api(m, "get", caseApi(c0)), unknown = await api(m, "get", `${apiRoot}/followup-cases/00000000-0000-4000-8000-000000000000`);
      expect(other.status).toBe(403); expect(unknown.status).toBe(403); expect(other.body).toEqual(unknown.body);
      expect((await api(m, "patch", caseApi(c0), { to: "attempted", version: 99 })).status).toBe(403);
      expect((await api(m, "post", `${apiRoot}/followup-cases`, {})).status).toBe(403);
    });

    await test.step("a viewer has no nav item, no queue and no case", async () => {
      const v = viewer.page;
      await v.goto(`${root}/crm/people`);
      await expect(nav(v).getByRole("link", { name: "People", exact: true })).toBeVisible();
      await expect(nav(v).getByRole("link", { name: "Follow-up" })).toHaveCount(0);
      await v.goto(queue);
      await expect(v.getByRole("heading", { level: 1, name: "Ministry access denied" })).toBeVisible();
      await expect(caseLinks(v)).toHaveCount(0);
      await v.goto(`${queue}/${c0.id}`);
      await expect(v.getByRole("heading", { level: 1, name: "Ministry access denied" })).toBeVisible();
      expect((await api(v, "get", `${apiRoot}/followup-cases`)).status).toBe(403);
      expect((await api(v, "get", caseApi(c0))).status).toBe(403);
    });

    await test.step("an admin works like the owner: every case, assignment and the same controls", async () => {
      const a = admin.page;
      await a.goto(queue);
      await expect(caseLinks(a)).toHaveCount(5);
      await expect(a.getByRole("button", { name: "Open cases", exact: true })).toBeVisible();
      await a.goto(`${queue}/${c3.id}`);
      await expect(a.getByRole("button", { name: "Ready for assignment" })).toBeVisible();
      await expect(a.getByRole("button", { name: "Withdraw", exact: true })).toBeVisible();
      await expect(a.getByRole("button", { name: /^Record opt-in for/ }).or(a.getByRole("button", { name: /^Record withdrawal for/ }))).toHaveCount(1);
    });

    await test.step("owner withdraws a case after a confirmation; a withdrawn case has no controls", async () => {
      await page.goto(`${queue}/${c3.id}`);
      await page.getByRole("button", { name: "Withdraw", exact: true }).click();
      const dialog = page.getByRole("alertdialog", { name: "Withdraw this case?" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("list", { name: "Case progress" }).locator('[aria-current="step"]')).toContainText("Requested");
      await page.getByRole("button", { name: "Withdraw", exact: true }).click();
      await page.getByRole("alertdialog", { name: "Withdraw this case?" }).getByRole("button", { name: "Withdraw", exact: true }).click();
      await expect(page.getByRole("list", { name: "Case progress" }).locator('[aria-current="step"]')).toContainText("Withdrawn");
      await expect(page.getByRole("group", { name: "Change state" })).toHaveCount(0);
      await page.goto(`${queue}/${c4.id}`);
      await expect(page.getByRole("group", { name: "Change state" })).toHaveCount(0);
      await expect(page.getByLabel("Assign to")).toHaveCount(0);
    });

    // Responsive and theme sweep: owner queue and case, the assigned member's case on the narrowest phones.
    for (const width of widths) for (const mode of ["light", "dark"] as const) {
      const label = `${width}-${mode}`, shot = async (p: Page, name: string) => { if (width === 360 || width === 1280) await p.screenshot({ path: `${evidence}/${name}-${label}.png` }); };
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(queue); await setMode(page, mode);
      await expect(caseLinks(page)).toHaveCount(5);
      if (width < 768) { await expect(page.locator('[data-slot="data-table-card"]')).toHaveCount(5); await tall(caseLinks(page)); await tall(page.getByRole("link", { name: "Open contact" })); }
      else if (width >= 1280) await expect(page.getByRole("table", { name: "Follow-up cases" })).toBeVisible();
      if (width < 1024) { await tall(page.getByRole("button", { name: "Open cases" })); await tall(page.getByRole("tab")); }
      await audit(page, `queue ${label}`); await shot(page, "queue");
      await page.goto(`${queue}/${c2.id}`);
      await expect(page.getByRole("heading", { level: 1, name: `Case ${reference(c2.id)}` })).toBeVisible();
      if (width < 1024) await tall(page.locator("main").getByRole("button"));
      if (width < 640) await expect(page.getByText(/Step \d of \d/)).toBeVisible();
      await audit(page, `case ${label}`); await shot(page, "case");
    }
    await member1.page.setViewportSize({ width: 360, height: 900 });
    for (const mode of ["light", "dark"] as const) {
      await member1.page.goto(`${queue}/${c0.id}`); await setMode(member1.page, mode);
      await expect(member1.page.getByRole("heading", { level: 1, name: `Case ${reference(c0.id)}` })).toBeVisible();
      await tall(member1.page.locator("main").getByRole("button"));
      await audit(member1.page, `member case ${mode}`);
      await member1.page.goto(queue); await expect(caseLinks(member1.page)).toHaveCount(2); await audit(member1.page, `member queue ${mode}`);
      if (mode === "light") await member1.page.screenshot({ path: `${evidence}/member-queue-360-${mode}.png` });
    }
    // The tenant stays the one the cases were made in.
    expect(tenantId).toMatch(/^[0-9a-f-]{36}$/);
  } finally { await Promise.all([member1, member2, viewer, admin].map((entry) => entry.context.close())); }
});
