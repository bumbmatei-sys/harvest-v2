import type { Page } from "@playwright/test";

// Axe samples computed colours, so a theme or viewport change must finish before it runs.
// Transitions are disabled (idempotently) so colours jump to their final values, then
// running animations/transitions are drained and two frames are let through.
export async function settleForAxe(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById("e2e-no-motion")) return;
    const style = document.createElement("style");
    style.id = "e2e-no-motion";
    style.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
    document.head.appendChild(style);
  });
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
