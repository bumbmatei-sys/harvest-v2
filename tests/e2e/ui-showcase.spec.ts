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
  await page.getByRole('searchbox', { name: 'Search components' }).fill('no-such-example');
  await expect(page.getByRole('heading', { name: 'Actions', exact: true })).toHaveCount(0);
  await expect(page.getByText('No matching examples', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search components' }).fill('');
  await page.getByRole('combobox', { name: 'Component category', exact: true }).selectOption('fields');
  await expect(page.getByRole('heading', { name: 'Fields', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Component category', exact: true }).selectOption('all');
  expect(writes).toEqual([]);
  await mkdir('/tmp/ui-showcase', { recursive: true });
  for (const width of [360,390,768,1280,1440]) for (const mode of ['light','dark']) {
    await page.setViewportSize({width,height:1000}); await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(value => localStorage.setItem('harvest-color-mode',value),mode); await page.reload();
    expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
    for (const action of await page.locator('[data-example-actions] button').all()) expect((await action.boundingBox())?.height).toBe(width<1024?44:36);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    if (width === 360) for (const [label, role] of [['Example dialog', 'dialog'], ['Example drawer', 'dialog'], ['Example confirmation', 'alertdialog']] as const) {
      const trigger = page.getByRole('button', { name: label, exact: true });
      await trigger.click(); const overlay = page.getByRole(role);
      await expect(overlay).toBeVisible();
      const box = await overlay.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    }
    await page.locator('main').evaluate(main => { main.scrollTop = 0; });
    await page.screenshot({path:`/tmp/ui-showcase/${width}-${mode}.png`,fullPage:true});
  }
  // Capture each example group deliberately; the shell scrolls main independently.
  await page.setViewportSize({width:390,height:1000});
  for (const id of ['actions','fields','overlays','feedback']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.screenshot({path:`/tmp/ui-showcase/group-${id}.png`});
  }
  // Measure shared toolbar consumers, preserving server-backed search/navigation.
  const workspace = await page.request.post('/api/workspaces',{headers:{origin},data:{name:'UI control check'}});
  expect(workspace.status()).toBe(201); const tenant = (await workspace.json()).tenantId;
  for(const width of [390,1440]) for(const resource of ['people','companies']) {
    await page.setViewportSize({width,height:1000});await page.goto(`/workspaces/${tenant}/crm/${resource}`);
    for(const label of [/^Filter$/, /^Sort:/, /^Columns$/]) {
      const button=page.getByRole('button',{name:label});
      expect((await button.boundingBox())?.height).toBe(width<1024?44:36);
    }
  }
});
