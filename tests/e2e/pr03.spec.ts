import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { BRAND_THEMES, COLOR_MODES, themeRegistry } from "../../src/lib/theme-registry";
import { signIn, origin } from "./helpers/session";
const evidence = "docs/screenshots/pr03";
test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });

async function setTheme(page: Page, brand: string, mode: string) {
  const name = brand[0].toUpperCase() + brand.slice(1);
  const account = page.getByRole("button", { name: "Account menu", exact: true });
  if (await account.count()) {
    await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute("data-hydrated", "true");
    await account.click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    await expect(account).toHaveAttribute("aria-expanded", "false");
  } else {
    await page.getByRole("combobox", { name: "Brand theme", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
  }
  if (await page.locator("html").getAttribute("data-theme") !== mode) await page.getByRole("button", { name: new RegExp(`^Switch to ${mode}`) }).click();
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", brand);
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}

test("PR03: each theme, semantic colors, profile locale persistence, screenshots and axe", async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors: string[] = [], results: { screen: string; violations: number }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mkdir(evidence, { recursive: true });
  async function capture(screen: string) {
    await page.evaluate(() => document.fonts.ready);
    const hardcoded = await page.evaluate(() => [...document.querySelectorAll("body *")].flatMap((element) => {
      const classes = element.getAttribute("class") ?? "", style = element.getAttribute("style") ?? "";
      return /(?:bg|text|border|ring|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|blue|purple|pink)(?:-\d+)?(?:[\s/:]|$)/.test(classes) || /#[\da-f]{3,8}\b|\brgba?\(/i.test(style) ? [element.tagName] : [];
    }));
    expect(hardcoded).toEqual([]);
    expect((await page.locator("body").innerText())).not.toContain("MISSING_MESSAGE");
    const axe = await new AxeBuilder({ page }).analyze();
    results.push({ screen, violations: axe.violations.length });
    expect(axe.violations, screen).toEqual([]);
    await page.screenshot({ path: `${evidence}/${screen}.png`, fullPage: true, animations: "disabled" });
  }
  await page.goto("/sign-in");
  for (const brand of BRAND_THEMES) for (const mode of COLOR_MODES) {
    await setTheme(page, brand, mode); await capture(`sign-in-${brand}-${mode}`);
  }
  expect((await request.patch("/api/profile", { headers: { origin }, data: { locale: "en" } })).status()).toBe(401);
  await signIn(page);
  const workspace = await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Harvest PR03 workspace" } });
  expect(workspace.status()).toBe(201);
  const tenantId = (await workspace.json()).tenantId, base = `/workspaces/${tenantId}`;
  const contact = await page.request.post(`${base.replace("/workspaces", "/api/workspaces")}/contacts`, { headers: { origin }, data: { name: "Synthetic Alex Rivers", email: "alex@example.test", notes: "Synthetic contact for theme verification." } });
  expect(contact.status()).toBe(201);
  const contactId = (await contact.json()).id;
  await page.goto("/profile");
  expect((await page.request.patch("/api/profile", { headers: { origin: "https://untrusted.example.test" }, data: { locale: "en" } })).status()).toBe(403);
  for (const data of [{ locale: "fr" }, { locale: "en", userId: "injected" }]) expect((await page.request.patch("/api/profile", { headers: { origin }, data })).status()).toBe(400);
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("Profile saved.");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Language" })).toContainText("English");
  expect((await (await page.request.get("/api/profile")).json()).locale).toBe("en");
  const screens = { workspaces: "/workspaces", contacts: `${base}/contacts`, "contact-detail": `${base}/contacts/${contactId}`, files: `${base}/files`, appearance: `${base}/appearance`, profile: "/profile" };
  for (const [screen, path] of Object.entries(screens)) {
    await page.goto(path);
    for (const brand of BRAND_THEMES) for (const mode of COLOR_MODES) {
      await setTheme(page, brand, mode);
      const primary = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        return { background: css.getPropertyValue("--primary").trim(), foreground: css.getPropertyValue("--primary-foreground").trim() };
      });
      expect(primary).toEqual({ background: themeRegistry[brand][mode]["--brand-color"], foreground: themeRegistry[brand][mode]["--earth"] });
      await capture(`${screen}-${brand}-${mode}`);
    }
  }
  await writeFile(`${evidence}/axe-results.json`, JSON.stringify(results, null, 2) + "\n");
  expect(errors).toEqual([]);
});
