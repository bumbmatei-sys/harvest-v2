import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

async function expectActionSizes(page: Page, width: number) {
  const expected = width < 1024 ? 44 : 36;
  const actions = page.locator('[data-size="icon-responsive"]:visible');
  expect(await actions.count()).toBeGreaterThan(0);
  for (const action of await actions.all()) {
    const box = await action.boundingBox();
    expect(box?.width).toBe(expected);
    expect(box?.height).toBe(expected);
  }
}

test("Studio foundation: shared CRM and Connect shell across responsive modes", async ({ page }) => {
  test.setTimeout(240000);
  await mkdir('/tmp/studio-foundation', { recursive: true });
  await signIn(page);
  const response = await page.request.post('/api/workspaces', { headers: { origin }, data: { name: 'Hope Community' } });
  expect(response.status()).toBe(201);
  const base = `/workspaces/${(await response.json()).tenantId}`;
  const campaign = await page.request.post(`/api${base}/campaigns`, { headers: { origin, 'Idempotency-Key': randomUUID() }, data: { name: 'Welcome Evening', type: 'conference' } });
  expect(campaign.status()).toBe(201);
  const connect = `${base}/campaigns/${(await campaign.json()).id}/connect`;
  for (const mode of ['light', 'dark']) for (const width of [360, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base + '/crm/people');
    await page.evaluate(value => localStorage.setItem('harvest-color-mode', value), mode);
    await page.reload();
    for (const [name, path] of [['crm', base + '/crm/people'], ['connect', connect]]) {
      await page.goto(path);
      await expect(page.locator('[data-hydrated=true]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      await expectActionSizes(page, width);
      await page.screenshot({ path: `/tmp/studio-foundation/${name}-${width}-${mode}.png` });
    }
    const trigger = page.locator('[data-shell-header] [data-sidebar=trigger]');
    await trigger.click();
    if (width < 1024) {
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await expectActionSizes(page, width);
      await page.keyboard.press('Escape');
      await expect(drawer).not.toBeVisible();
      await expect(trigger).toBeFocused();
    } else {
      await expect(page.locator('[data-variant=floating][data-state=collapsed]')).toBeVisible();
      await expectActionSizes(page, width);
      await trigger.click();
      await expect(page.locator('[data-variant=floating][data-state=expanded]')).toBeVisible();
    }
  }
});
