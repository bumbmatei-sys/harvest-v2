import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });

test("shared filters: staged changes, edit/remove, saved views, exports and responsive access", async ({ page, browser }) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { data, headers: { origin } });
    expect(response.status()).toBe(201);
    return response.json();
  }
  const { tenantId } = await post("/api/workspaces", { audience: "church", name: "Synthetic shared filter QA" });
  const root = `/workspaces/${tenantId}`, api = `/api${root}`;
  await post(`${api}/companies`, { name: "Synthetic North Fellowship", domain: "north.example" });
  await post(`${api}/companies`, { name: "Synthetic South Ministry" });
  await post(`${api}/contacts`, { name: "Synthetic North Volunteer", email: "north@example.test" });
  await post(`${api}/contacts`, { name: "Synthetic South Volunteer" });
  const evidence = "docs/screenshots/crm-filters";
  await mkdir(evidence, { recursive: true });

  for (const [route, title, valueField] of [["people", "People", "Email"], ["companies", "Organizations", "Domain"]]) {
    await page.goto(`${root}/crm/${route}`);
    const trigger = page.getByRole("button", { name: "Filters", exact: true });
    const panel = page.getByRole("dialog", { name: "Filters", exact: true });
    const grid = page.getByRole("grid", { name: title, exact: true });
    await expect(grid.getByRole("row")).toHaveCount(3);
    const initialURL = page.url();
    await trigger.click();
    await panel.getByPlaceholder("Search fields").fill("Name");
    await panel.getByRole("option", { name: /^Name\s*Text$/ }).click();
    await panel.getByLabel("Value", { exact: true }).fill("North");
    await panel.getByRole("button", { name: "Add condition", exact: true }).click();
    await expect(panel.getByRole("list", { name: "Draft filters" })).toContainText("Name contains North");
    expect(page.url()).toBe(initialURL);
    await expect(grid.getByRole("row")).toHaveCount(3);
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(panel.getByRole("list", { name: "Draft filters" })).toHaveCount(0);
    await panel.getByRole("option", { name: new RegExp(`^${valueField}\\s*Text$`) }).click();
    await panel.getByLabel("Condition").selectOption("is_not_empty");
    await panel.getByRole("button", { name: "Apply filter", exact: true }).click();
    await expect(grid.getByRole("row")).toHaveCount(2);
    await expect(page).toHaveURL(/f=/);
    const filteredURL = page.url();
    expect((await new AxeBuilder({ page }).analyze()).violations.map((item) => item.id)).toEqual([]);
    // Edit directly through a chip, validate locally, then cancel via Escape.
    await page.getByRole("button", { name: `Edit filter ${valueField} is not empty`, exact: true }).click();
    await panel.getByLabel("Condition").selectOption("contains");
    await panel.getByRole("button", { name: "Apply filter", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Complete the filter");
    expect(page.url()).toBe(filteredURL);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    expect(page.url()).toBe(filteredURL);
    // Clear is staged and must be applied; outside dismissal also discards.
    await trigger.click();
    await panel.getByRole("button", { name: "Clear all", exact: true }).click();
    await page.getByRole("heading", { name: title, exact: false }).click();
    await expect(panel).toBeHidden();
    expect(page.url()).toBe(filteredURL);
    await page.reload();
    await expect(grid.getByRole("row")).toHaveCount(2);
    const query = new URL(page.url()).searchParams;
    query.set("entity", route === "people" ? "person" : "company");
    const count = await page.request.get(`${api}/crm/export/count?${query}`);
    expect(count.status()).toBe(200);
    expect((await count.json()).total).toBe(1);
    const csv = await page.request.get(`${api}/crm/export?${query}`);
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("Synthetic North");
    expect(await csv.text()).not.toContain("Synthetic South");
    // Persisted view restores the same predicate.
    await page.getByRole("button", { name: "Save as new view", exact: true }).click();
    const viewDialog = page.getByRole("dialog");
    await viewDialog.getByLabel("View name").fill(`Has ${valueField}`);
    await viewDialog.getByRole("button", { name: "Save view", exact: true }).click();
    await expect(page).toHaveURL(/view=/);
    const view = new URL(page.url()).searchParams.get("view");
    await page.goto(`${root}/crm/${route}?view=${view}`);
    await expect(grid.getByRole("row")).toHaveCount(2);
    // Mobile, tablet and desktop in both modes: closed, field search and editor.
    for (const width of [360, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      for (const mode of ["light", "dark"]) {
        await page.evaluate((value) => localStorage.setItem("harvest-color-mode", value), mode);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
        await trigger.click();
        await expect(panel).toBeVisible();
        const box = await panel.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
        if (width < 1024) {
          expect((await trigger.boundingBox())!.width).toBeGreaterThanOrEqual(44);
          expect((await panel.getByRole("button", { name: "Apply filter", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({ path: `${evidence}/${route}-${width}-${mode}-panel.png` });
        const axe = await new AxeBuilder({ page }).analyze();
        expect(axe.violations.map((item) => item.id)).toEqual([]);
        await panel.getByRole("button", { name: `Edit filter ${valueField} is not empty`, exact: true }).click();
        await page.screenshot({ path: `${evidence}/${route}-${width}-${mode}-edit.png` });
        await page.keyboard.press("Escape");
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await trigger.click();
    await panel.getByRole("button", { name: "Clear all", exact: true }).click();
    await panel.getByRole("button", { name: "Apply filter", exact: true }).click();
    await expect(grid.getByRole("row")).toHaveCount(3);
    await page.reload();
    await expect(grid.getByRole("row")).toHaveCount(3);
    const clearedQuery = new URL(page.url()).searchParams;
    clearedQuery.set("entity", route === "people" ? "person" : "company");
    const clearedCount = await page.request.get(`${api}/crm/export/count?${clearedQuery}`);
    expect((await clearedCount.json()).total).toBe(2);
    const clearedCSV = await page.request.get(`${api}/crm/export?${clearedQuery}`);
    expect(await clearedCSV.text()).toContain("Synthetic South");
  }
  // Foreign workspace and unauthorized export remain denied.
  const context = await browser.newContext();
  const other = await context.newPage();
  const email = await signIn(other);
  expect((await other.request.get(`${api}/contacts`)).status()).toBe(403);
  expect((await other.request.get(`${api}/crm/export?entity=person`)).status()).toBe(403);
  expect((await page.request.put(`${api}/members`, { data: { email, role: "viewer" }, headers: { origin } })).status()).toBe(200);
  await other.goto(`${root}/crm/people`);
  await other.getByRole("button", { name: "Filters", exact: true }).click();
  await other.getByRole("option", { name: /^Name\s*Text$/ }).click();
  await other.getByLabel("Value", { exact: true }).fill("No matches");
  await other.getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(other.getByRole("heading", { name: "No matching people" })).toBeVisible();
  await expect(other.getByRole("button", { name: "Save as new view", exact: true })).toHaveCount(0);
  await context.close();
  expect(errors).toEqual([]);
});

test("shared filters: limit, overflow chips, staged removal and successful editing", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const workspace = await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name: "Synthetic filter limits" } });
  const { tenantId } = await workspace.json();
  const root = `/workspaces/${tenantId}/crm/people`;
  const params = new URLSearchParams();
  for (let i = 0; i < 10; i++) params.append("f", `name~not_contains~Excluded ${i}`);
  await page.goto(`${root}?${params}`);
  const active = page.getByRole("list", { name: "Active filters", exact: true });
  await expect(active.getByRole("button", { name: /^Edit filter/ })).toHaveCount(3);
  await active.getByRole("button", { name: "+7 more", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Filters", exact: true });
  await expect(panel.getByText("Use up to 10 conditions.")).toBeVisible();
  await expect(panel.getByRole("option", { name: /^Name\s*Text$/ })).toHaveAttribute("aria-disabled", "true");
  await panel.getByRole("button", { name: "Edit filter Name does not contain Excluded 9", exact: true }).click();
  await panel.getByLabel("Value", { exact: true }).fill("Updated");
  await panel.getByRole("button", { name: "Update condition", exact: true }).click();
  expect(new URL(page.url()).searchParams.getAll("f").join()).not.toContain("Updated");
  await panel.getByRole("button", { name: "Remove filter Name does not contain Excluded 0", exact: true }).click();
  await expect(panel.getByRole("option", { name: /^Name\s*Text$/ })).not.toHaveAttribute("aria-disabled", "true");
  await panel.getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(page).toHaveURL(/Updated/);
  expect(new URL(page.url()).searchParams.getAll("f")).toHaveLength(9);
  await active.getByRole("button", { name: "Remove filter Name does not contain Excluded 1", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.getAll("f").length).toBe(8);
});
