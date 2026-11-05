import { expect, type Page } from "@playwright/test";

/**
 * Shell layout contract: content spans the full inset width with compact gutters
 * (24px from lg, 16px below), aligns with the breadcrumb and never scrolls sideways.
 */
export async function expectFullWidthShell(page: Page) {
  const metrics = await page.evaluate(() => {
    const main = document.querySelector("main#main-content")!, content = document.querySelector("[data-shell-content]")!;
    const crumb = document.querySelector("[data-shell-header] nav[aria-label='breadcrumb']");
    const style = getComputedStyle(content);
    return {
      main: main.getBoundingClientRect().width, content: content.getBoundingClientRect().width,
      maxWidth: style.maxWidth, padLeft: parseFloat(style.paddingLeft), padRight: parseFloat(style.paddingRight),
      contentLeft: content.getBoundingClientRect().left + parseFloat(style.paddingLeft),
      crumbLeft: crumb?.getBoundingClientRect().left ?? null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      // A table that scrolls sideways inside its card hides columns (for example row actions).
      scrollingTables: [...content.querySelectorAll('[data-slot="table-container"]')].filter((element) => element.scrollWidth > element.clientWidth + 1).length,
      clipped: [...content.querySelectorAll("*")].filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.right > content.getBoundingClientRect().right + 1 && getComputedStyle(element).position !== "fixed";
      }).length,
    };
  });
  const gutter = page.viewportSize()!.width >= 1024 ? 24 : 16;
  expect(metrics.maxWidth).toBe("none");
  expect(Math.abs(metrics.content - metrics.main)).toBeLessThanOrEqual(1);
  expect([metrics.padLeft, metrics.padRight]).toEqual([gutter, gutter]);
  expect(metrics.overflow).toBeLessThanOrEqual(0);
  expect(metrics.clipped).toBe(0);
  expect(metrics.scrollingTables).toBe(0);
  if (metrics.crumbLeft !== null && page.viewportSize()!.width >= 1024) expect(Math.abs(metrics.crumbLeft - metrics.contentLeft)).toBeLessThanOrEqual(1);
  return metrics;
}
/** The record back link's icon starts at the content edge, right under the breadcrumb. */
export async function expectBackLinkAligned(page: Page, label: string) {
  const box = await page.evaluate((name) => {
    const link = [...document.querySelectorAll("main a")].find((element) => element.textContent?.trim() === name)!;
    const icon = link.querySelector("svg")!.getBoundingClientRect(), content = document.querySelector("[data-shell-content]")!;
    const header = document.querySelector("[data-shell-header]")!.getBoundingClientRect();
    return { icon: icon.left, edge: content.getBoundingClientRect().left + parseFloat(getComputedStyle(content).paddingLeft), gap: link.getBoundingClientRect().top - header.bottom };
  }, label);
  expect(Math.abs(box.icon - box.edge)).toBeLessThanOrEqual(1);
  expect(box.gap).toBeLessThanOrEqual(8);
}
