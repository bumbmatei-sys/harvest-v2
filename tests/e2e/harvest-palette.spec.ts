import { mkdir } from "node:fs/promises";
import { expect, test } from "./helpers/test";
import { origin, signIn } from "./helpers/session";
import { settleForAxe } from "./helpers/settle";

// Harvest palette: primary buttons are Desert Sun gold with dark olive text in light and dark; links, selection and focus use dark olive (light) and Desert Sun (dark).
// Captures a few screens with a primary button at desktop in both schemes. HARVEST_PALETTE_SHOTS=before names the files for the pre-change capture.
const evidence = "docs/screenshots/harvest-palette", phase = process.env.HARVEST_PALETTE_SHOTS ?? "after";
test.use({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });

test("Harvest primary buttons are gold with dark text in light and dark", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const tenant = (await (await page.request.post("/api/workspaces", { headers: { origin }, data: { name: "Palette Church", audience: "church" } })).json()).tenantId as string;
  const screens = [["ministries", "/workspaces"], ["crm-people", `/workspaces/${tenant}/crm/people`], ["settings-form", `/workspaces/${tenant}/settings`], ["campaigns", `/workspaces/${tenant}/campaigns`]] as const;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [name, path] of screens) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.mouse.move(0, 0);
      await settleForAxe(page);
      if (phase === "after") {
        const button = page.locator('[data-slot="button"]:not([data-variant]):visible, [data-slot="button"][data-variant="default"]:visible').first();
        if (await button.count()) {
          const colors = await button.evaluate((node) => { const style = getComputedStyle(node); return { background: style.backgroundColor, color: style.color }; });
          expect(colors.background, `${name} ${scheme} primary fill`).toBe("rgb(211, 162, 101)");
          expect(colors.color, `${name} ${scheme} primary text`).toBe("rgb(43, 42, 12)");
        }
      }
      await page.screenshot({ path: `${evidence}/${phase}-${name}-${scheme}.png`, fullPage: true });
    }
  }
});
