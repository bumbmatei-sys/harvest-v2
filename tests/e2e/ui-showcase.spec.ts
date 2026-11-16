import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn, origin } from "./helpers/session";

test("showcase exposure and local component interactions", async ({ page }) => {
  test.setTimeout(180000);
  if (process.env.HARVEST_UI_SHOWCASE !== "1") {
    expect((await page.request.get('/dev/ui')).status()).toBe(404);
    await signIn(page);
    expect((await page.request.get('/dev/ui')).status()).toBe(404);
    return;
  }
  const guest = await page.request.get('/dev/ui', { maxRedirects: 0 });
  expect([303,307]).toContain(guest.status());
  expect(guest.headers().location).toContain('/sign-in');
  await signIn(page); await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: 'Component showcase', exact: true })).toBeVisible();
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push(request.url()); });
  await page.getByRole('button', { name: 'Primary', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local actions:' })).toHaveText('Local actions: 1');
  await page.getByRole('button', { name: 'Validate example', exact: true }).click();
  await expect(page.getByLabel('Example email', { exact: true })).toHaveAttribute('aria-invalid','true');
  await page.getByLabel('Example email', { exact: true }).fill('alex@example.test');
  await page.getByRole('button', { name: 'Validate example', exact: true }).click();
  await expect(page.getByLabel('Example email', { exact: true })).toHaveAttribute('aria-invalid','false');
  const dialogTrigger = page.getByRole('button', { name: 'Example dialog', exact: true });
  await dialogTrigger.click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(dialogTrigger).toBeFocused();
  const drawerTrigger = page.getByRole('button', { name: 'Example drawer', exact: true });
  await drawerTrigger.click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(drawerTrigger).toBeFocused();
  await page.getByRole('button', { name: 'Example confirmation', exact: true }).click();
  await page.getByRole('button', { name: 'Remove fixture', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Selected:' })).toContainText('Fixture removed locally.');
  await page.getByRole('button', { name: 'Search example options', exact: true }).click();
  await page.getByPlaceholder('Search example options').fill('Second');
  await page.getByRole('listbox').getByRole('option', { name: 'Second option', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Selected:' })).toContainText('Second option');
  await page.getByRole('button', { name: 'Retry example', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Example success' })).toContainText('Local retry complete.');
  // Bottom sheet: opens from the bottom edge, closes on Escape and returns focus.
  const bottomTrigger = page.getByRole('button', { name: 'Example bottom sheet', exact: true });
  await bottomTrigger.click(); await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-slot="sheet-handle"]')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(bottomTrigger).toBeFocused();
  // Toast: polite live region, action, and a second toast replacing the first by id.
  const notifications = page.getByRole('region', { name: 'Notifications' });
  await expect(notifications).toHaveAttribute('aria-live', 'polite');
  await page.getByRole('button', { name: 'Show toast', exact: true }).click();
  await expect(notifications.getByText('Example created', { exact: true })).toBeVisible();
  await notifications.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(notifications.getByText('Example restored.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show error toast', exact: true }).click();
  await expect(notifications.getByText('Example could not be saved.', { exact: true })).toBeVisible();
  // Primitives: spinner status, toggle groups, focusable scroll area.
  await expect(page.getByRole('status', { name: 'Small', exact: true })).toBeVisible();
  const grid = page.getByRole('radio', { name: 'Grid view', exact: true });
  await grid.click(); await expect(grid).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Grid view, 1 format' })).toBeVisible();
  const italic = page.getByRole('button', { name: 'Italic', exact: true });
  await italic.click(); await expect(italic).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Grid view, 2 formats' })).toBeVisible();
  const scrollList = page.getByRole('region', { name: 'Scrollable example list' });
  await scrollList.focus(); await page.keyboard.press('PageDown');
  await expect(scrollList).toBeFocused();
  await expect.poll(() => scrollList.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('kbd')).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'Search components' }).fill('no-such-example');
  await expect(page.getByRole('heading', { name: 'Actions', exact: true })).toHaveCount(0);
  await expect(page.getByText('No matching examples', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search components' }).fill('');
  await page.getByRole('combobox', { name: 'Component category', exact: true }).selectOption('fields');
  await expect(page.getByRole('heading', { name: 'Fields', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Component category', exact: true }).selectOption('kit');
  await expect(page.getByRole('heading', { name: 'Kit-derived items', exact: true })).toBeVisible();
  for (const item of ['toast1 (free)', 'spinner1 (free)', 'scroll-area1 (free)', 'drawer1 (free)']) await expect(page.getByText(item, { exact: true })).toBeVisible();
  const swatchColors = await page.locator('[data-chart-swatches] span[aria-hidden]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  expect(swatchColors).toHaveLength(5); expect(new Set(swatchColors).size).toBe(5);
  await page.getByRole('combobox', { name: 'Component category', exact: true }).selectOption('all');
  expect(writes).toEqual([]);
  await mkdir('/tmp/ui-showcase', { recursive: true });
  for (const width of [360,390,768,1280,1440]) for (const mode of ['light','dark']) {
    await page.setViewportSize({width,height:1000}); await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(value => localStorage.setItem('harvest-color-mode',value),mode); await page.reload();
    expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
    for (const action of await page.locator('[data-example-actions] button').all()) expect((await action.boundingBox())?.height).toBe(width<1024?44:36);
    for (const item of await page.locator('[data-slot="toggle-group-item"]').all()) { const box = await item.boundingBox(); expect(box?.height).toBe(width<1024?44:36); expect(box!.width).toBeGreaterThanOrEqual(width<1024?44:36); }
    // A visible toast (with its action and close button) must pass axe in this theme and width, with 44px targets on phones.
    await page.getByRole('button', { name: 'Show toast', exact: true }).click();
    const toastAction = page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Undo', exact: true });
    await expect(toastAction).toBeVisible();
    expect((await toastAction.boundingBox())?.height).toBe(width<1024?44:36);
    const toastClose = page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Dismiss', exact: true });
    const closeBox = await toastClose.boundingBox(); expect(Math.round(closeBox!.width)).toBeGreaterThanOrEqual(width<1024?44:24);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    if (width === 360) for (const [label, role] of [['Example dialog', 'dialog'], ['Example drawer', 'dialog'], ['Example bottom sheet', 'dialog'], ['Example confirmation', 'alertdialog']] as const) {
      const trigger = page.getByRole('button', { name: label, exact: true });
      await trigger.click(); const overlay = page.getByRole(role);
      await expect(overlay).toBeVisible();
      // Measure after the slide-in has settled (it can still be on its first frame right after becoming visible).
      let box = await overlay.boundingBox();
      for (let attempt = 0; attempt < 20; attempt++) { await page.waitForTimeout(50); const next = await overlay.boundingBox(); const settled = JSON.stringify(next) === JSON.stringify(box); box = next; if (settled) break; }
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width, `${label} ${JSON.stringify(box)}`).toBeLessThanOrEqual(width);
      if (label === 'Example bottom sheet') { expect(Math.round(box!.y + box!.height)).toBe(1000); const close = await overlay.getByRole('button', { name: 'Close', exact: true }).boundingBox(); expect(close!.width).toBe(44); expect(close!.height).toBe(44); }
      expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    }
    await page.locator('main').evaluate(main => { main.scrollTop = 0; });
    await page.screenshot({path:`/tmp/ui-showcase/${width}-${mode}.png`,fullPage:true});
  }
  // Capture each example group deliberately; the shell scrolls main independently.
  await page.setViewportSize({width:390,height:1000});
  for (const id of ['actions','fields','overlays','feedback','primitives','toast','kit']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.screenshot({path:`/tmp/ui-showcase/group-${id}.png`});
  }
  // Measure shared toolbar consumers, preserving server-backed search/navigation.
  const workspace = await page.request.post('/api/workspaces',{headers:{origin},data:{audience:'church',name:'UI control check'}});
  expect(workspace.status()).toBe(201); const tenant = (await workspace.json()).tenantId;
  for(const width of [390,1440]) for(const resource of ['people','companies']) {
    await page.setViewportSize({width,height:1000});await page.goto(`/workspaces/${tenant}/crm/${resource}`);
    for(const label of [/^Filters$/, /^Sort:/, /^Columns$/]) {
      const button=page.getByRole('button',{name:label});
      expect((await button.boundingBox())?.height).toBe(width<1024?44:36);
    }
  }
});
