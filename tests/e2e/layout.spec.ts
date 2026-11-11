import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";

// Shared shell layout applies to every workspace screen, not only the CRM.
const evidence = "docs/screenshots/layout";
test.use({ reducedMotion: "reduce" });

async function mode(page: Page, value: "light" | "dark") {
  await page.evaluate((next) => localStorage.setItem("harvest-color-mode", next), value);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", value);
}

test("non-CRM workspace screens use the full-width shell; short forms stay narrow and left-aligned", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(evidence, { recursive: true });
  await signIn(page);
  const workspace = await page.request.post("/api/workspaces", { headers: { origin }, data: { audience: "church", name: "Layout check workspace" } });
  const base = `/workspaces/${(await workspace.json()).tenantId}`;
  const screens = { workspaces: "/workspaces", files: `${base}/files`, appearance: `${base}/appearance`, profile: "/profile" };
  for (const [viewport, size] of [["wide", { width: 1920, height: 1080 }], ["mobile", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(size);
    for (const [name, path] of Object.entries(screens)) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectFullWidthShell(page);
      if (name === "appearance" || name === "profile") {
        // Focused short forms keep a readable width but start at the content edge.
        const form = await page.evaluate(() => {
          const content = document.querySelector("[data-shell-content]")!, column = content.lastElementChild!.getBoundingClientRect();
          return { left: column.left - content.getBoundingClientRect().left - parseFloat(getComputedStyle(content).paddingLeft), width: column.width };
        });
        expect(Math.abs(form.left)).toBeLessThanOrEqual(1);
        expect(form.width).toBeLessThanOrEqual(576);
      }
      for (const value of ["light", "dark"] as const) {
        await mode(page, value);
        await expectFullWidthShell(page);
        // Theme changes animate button colours; scan only after transitions settle (avoids mid-fade contrast readings).
        await page.waitForFunction(() => document.getAnimations().every((animation) => !(animation instanceof CSSTransition) || animation.playState !== "running"));
        expect((await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id), `${name}-${viewport}-${value}`).toEqual([]);
        await page.screenshot({ path: `${evidence}/${name}-${viewport}-${value}.png`, fullPage: true, animations: "disabled" });
      }
    }
  }
});
