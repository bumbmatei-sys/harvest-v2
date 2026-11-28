import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { settleForAxe } from "./settle";

/** Evidence for a kit-derived screen: full-page shots at 390 and 1440 wide, light and dark, into `KIT_SHOTS` (skipped when it is not set). */
export async function kitShots(page: Page, name: string) {
  const dir = process.env.KIT_SHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const size = page.viewportSize() ?? { width: 1280, height: 900 };
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    // The theme is resolved once on load; apply it the way the load script does, so client state on the page is kept.
    await page.evaluate((mode) => { const root = document.documentElement; root.dataset.theme = mode; root.classList.toggle("dark", mode === "dark"); }, scheme);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await settleForAxe(page);
      await page.screenshot({ path: `${dir}/${name}-${width}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.evaluate(() => { const root = document.documentElement; root.dataset.theme = "light"; root.classList.remove("dark"); });
  await page.setViewportSize(size);
}

/** Device scale for runs that collect kit evidence (2), otherwise the default (1). */
export const kitScale = process.env.KIT_SHOTS ? 2 : 1;
