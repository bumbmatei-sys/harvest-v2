import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Hosted CRM forms in synthetic mode (the e2e server is a disposable harvest_test database): publish, address, copy, response count,
// unpublish, republish after an edit, the unavailable state, and the named hosted form in the People source filter.
test.use({ actionTimeout: 30000, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
const evidence = "docs/screenshots/crm-forms-publication";
const sizes = [["phone", 360, 800], ["tablet", 768, 1024], ["desktop", 1280, 900]] as const;

async function audit(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settleForAxe(page);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (label === "desktop") await page.screenshot({ path: `${evidence}/${name}-${scheme}.png` });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("publish, copy, count, unpublish and republish a hosted form; named form in the People source filter", async ({ page }) => {
  test.setTimeout(300000);
  // A unique address per attempt: a retry must not collide with the first attempt's published page.
  const slug = `synthetic-visitor-card-${Date.now().toString(36)}`;
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const api = `/api/workspaces/${tenant}/crm/forms`;
  const created = await page.request.post(api, { headers: { origin }, data: { template: null, destination: { type: "people" } } });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };
  const loaded = await (await page.request.get(`${api}/${id}`)).json() as { definition: { revision: number; title: string; blocks: { id: string; type: string }[]; settings: Record<string, unknown> } };
  const definition = loaded.definition;
  definition.title = "Synthetic visitor card";
  definition.settings.spamCheck = false;
  definition.blocks.unshift({ id: "fullname", type: "short", label: "Name", required: true, mapTo: "name" } as never, { id: "email000", type: "email", label: "Email", required: false, mapTo: "email" } as never);
  const consent = definition.blocks.find((block) => block.type === "consent")!;
  const saved = await page.request.put(`${api}/${id}`, { headers: { origin }, data: { definition, revision: definition.revision } });
  expect(saved.status()).toBe(200);

  await page.goto(`/workspaces/${tenant}/crm/forms/${id}`);
  const state = page.locator("[data-publication-state]");
  await expect(state).toHaveText("Draft");
  await expect(page.locator("[data-responses]")).toHaveText("0 responses");
  await expect(page.locator("[data-open-form]")).toHaveCount(0);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Copy link" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  // Publish: the dialog says what is frozen, the address is prefilled from the title, a bad address is refused client-side.
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Publish this form?" });
  await expect(dialog).toContainText("consent text becomes its privacy notice");
  // The default is derived from the title, so it is the same on every attempt; the published address below is unique per attempt.
  await expect(dialog.getByLabel("Public address")).toHaveValue("synthetic-visitor-card");
  await dialog.getByLabel("Public address").fill("Bad Address");
  await expect(dialog.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await dialog.getByLabel("Public address").fill("forms");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Use 3 to 64");
  await dialog.getByLabel("Public address").fill(`${slug}`);
  await audit(page, "publish-dialog");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(state).toHaveText("Published");
  await expect(page.locator("[data-open-form]")).toHaveAttribute("href", `/f/${slug}`);
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);

  // Copy link writes the absolute address.
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page.getByRole("menuitem", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/f/${slug}`);

  // A real response raises the count after reload.
  // The first request to a route compiles it in the dev server; retry a dropped connection and report status and body if it never answers 200.
  let proof = "";
  await expect(async () => {
    const form = await page.request.get(`/f/${slug}`);
    expect(form.status(), `${form.status()} ${(await form.text()).slice(0, 300)}`).toBe(200);
    proof = (await form.json() as { proof: string }).proof;
  }).toPass({ timeout: 30_000 });
  const submitted = await page.request.post(`/f/${slug}/submit`, { headers: { origin }, data: { proof, answers: { fullname: "Synthetic Person", email000: "visitor@example.test", [consent.id]: "yes" } } });
  expect(submitted.status(), await submitted.text()).toBeLessThan(300);
  await page.reload();
  await expect(page.locator("[data-responses]")).toHaveText("1 response");
  await audit(page, "published");

  // Editing a published form keeps the live version and offers Publish changes; republishing keeps the address.
  await page.getByRole("textbox", { name: /title/i }).first().fill("Synthetic visitor card two");
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  await expect(state).toHaveText("Published, unpublished changes");
  await page.getByRole("button", { name: "Publish changes", exact: true }).click();
  await expect(dialog.getByLabel("Public address")).toHaveValue(`${slug}`);
  await expect(dialog.getByLabel("Public address")).toHaveJSProperty("readOnly", true);
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(state).toHaveText("Published");
  await expect((await page.request.get(`/f/${slug}`)).status()).toBe(200);

  // Named hosted form in the People source filter, labelled by its immutable publication title.
  await page.goto(`/workspaces/${tenant}/crm/people`);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Filters", exact: true });
  await panel.getByRole("option", { name: /^Source rule\s*Rule$/ }).click();
  await panel.getByRole("checkbox", { name: "Form", exact: true }).click();
  // Each published version is its own choice, named by the title it was published with; the response was accepted by the first.
  await expect(panel.getByRole("checkbox", { name: "Synthetic visitor card two", exact: true })).toBeVisible();
  await panel.getByRole("checkbox", { name: "Synthetic visitor card", exact: true }).click();
  await panel.getByRole("button", { name: "Add rule", exact: true }).click();
  await panel.getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(page).toHaveURL(/[?&]s=include/);
  await expect(page.getByRole("grid", { name: "People", exact: true })).toContainText("Synthetic Person");
  await page.goto(`/workspaces/${tenant}/crm/forms/${id}`);

  // Unpublish: the address stops serving and the controls go back to their disabled state.
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  const retire = page.getByRole("alertdialog", { name: "Unpublish this form?" });
  await expect(retire).toContainText("Responses already collected are kept");
  await retire.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(state).toHaveText("Unpublished");
  expect((await page.request.get(`/f/${slug}`)).status()).toBe(404);
  await expect(page.locator("[data-open-form]")).toHaveCount(0);
  await expect(page.locator("[data-responses]")).toHaveText("1 response");
});

test("the controls say so when the server does not serve hosted forms", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Grace Community Church", audience: "church" } })).json()).tenantId as string;
  const { id } = await (await page.request.post(`/api/workspaces/${tenant}/crm/forms`, { headers: { origin }, data: { template: "prayer", destination: { type: "people" } } })).json() as { id: string };
  await page.route(`**/crm/forms/${id}/publication`, (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found" }) }));
  await page.goto(`/workspaces/${tenant}/crm/forms/${id}`);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Hosted forms are not available in this environment.")).toBeVisible();
  await expect(page.locator("[data-publication-state]")).toHaveText("Draft");
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveAttribute("aria-disabled", "true");
});
