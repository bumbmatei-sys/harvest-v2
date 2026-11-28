import { mkdir } from "node:fs/promises";
import { expect, test } from "./helpers/test";
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
  // Header slots: this page passes an example search field and action; other pages pass nothing.
  await expect(page.locator('[data-shell-header] [role="search"]').getByRole('searchbox', { name: 'Header search example', exact: true })).toBeVisible();
  await expect(page.locator('[data-shell-header]').getByRole('group', { name: 'Page actions', exact: true }).getByRole('link', { name: 'Header action example', exact: true })).toHaveAttribute('href', '#shell');
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
  for (const item of ['toast1 (free)', 'spinner1 (free)', 'scroll-area1 (free)', 'drawer1 (free)', 'dashboard-shell8 (premium)', 'dashboard-dropdown7 (premium)', 'tables14 (premium)', 'empty-state15 (premium)', 'badge1 (free)', 'alert-dialog1 (free)', 'stepper1 (free)', 'form-layout20 (premium)', 'form-layout1 (premium)', 'field1 (free)', 'tables19 (premium)', 'tables21 (premium)', 'todo-app6 (premium)', 'chat-ui4 (premium)', 'tables15 (premium)', 'switch-card1 (premium)']) await expect(page.getByText(item, { exact: true })).toBeVisible();
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
  for (const id of ['actions','fields','overlays','feedback','primitives','toast','shell','pageParts','forms','kit']) {
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

test("page pieces: table states, selection, sorting, confirmations and the phone card layout", async ({ page }) => {
  test.setTimeout(240000);
  test.skip(process.env.HARVEST_UI_SHOWCASE !== "1", "the showcase is development-only");
  await signIn(page); await page.setViewportSize({ width: 1280, height: 1000 }); await page.goto('/dev/ui#pageParts');
  const axe = async (label: string) => expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, label).toEqual([]);
  const section = page.locator('#pageParts');
  const table = section.getByRole('table', { name: 'Sample items' });
  // Tabs with counts filter the same table; the active tab owns the panel.
  await expect(section.getByRole('tab', { name: /^All\s*5$/ })).toHaveAttribute('aria-selected', 'true');
  await expect(table.getByRole('row')).toHaveCount(6);
  await section.getByRole('tab', { name: /^Open\s*2$/ }).click();
  await expect(table.getByRole('row')).toHaveCount(3);
  await section.getByRole('tab', { name: /^All/ }).click();
  // Sorting: aria-sort cycles on the name header.
  const nameHeader = table.getByRole('columnheader', { name: 'Name' });
  await expect(nameHeader).toHaveAttribute('aria-sort', 'none');
  await nameHeader.getByRole('button').click(); await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  await nameHeader.getByRole('button').click(); await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(table.getByRole('row').nth(1)).toContainText('Sample item E');
  await nameHeader.getByRole('button').click(); await expect(nameHeader).toHaveAttribute('aria-sort', 'none');
  // Search narrows rows; an empty result shows the empty slot.
  await section.getByRole('searchbox', { name: 'Search sample items' }).fill('item B');
  await expect(table.getByRole('row')).toHaveCount(2);
  await section.getByRole('searchbox', { name: 'Search sample items' }).fill('nothing matches');
  await expect(section.getByText('Nothing here yet', { exact: true }).first()).toBeVisible();
  await section.getByRole('searchbox', { name: 'Search sample items' }).fill('');
  // Selection: header checkbox, per-row checkbox, bulk bar with count, clear.
  await expect(section.getByRole('region', { name: 'Selected items' })).toHaveCount(0);
  await section.getByRole('checkbox', { name: 'Select Sample item A' }).click();
  const bulk = section.getByRole('region', { name: 'Selected items' });
  await expect(bulk.getByRole('status')).toHaveText('1 selected');
  await expect(section.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute('aria-checked', 'mixed');
  await section.getByRole('checkbox', { name: 'Select all' }).click();
  await expect(bulk.getByRole('status')).toHaveText('5 selected');
  await axe('selected rows');
  await bulk.getByRole('button', { name: 'Clear selection' }).click();
  await expect(bulk).toHaveCount(0);
  // Loading, empty and error slots (and Retry).
  for (const [view, expectation] of [['Loading', () => expect(section.getByRole('status', { name: 'Loading' }).first()).toBeVisible()], ['Empty', () => expect(section.getByText('Nothing here yet', { exact: true }).first()).toBeVisible()], ['Error', () => expect(section.getByRole('alert')).toContainText('Sample items could not load.')]] as const) {
    await section.getByRole('radio', { name: view, exact: true }).click(); await expectation(); await axe(`${view} state`);
  }
  await section.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(table).toBeVisible();
  await section.getByRole('radio', { name: 'Ready', exact: true }).click();
  // Confirmations: focus returns to the trigger; busy state keeps focus and blocks dismissal; failure stays open.
  const destructive = page.getByRole('button', { name: 'Example delete', exact: true });
  await destructive.click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this example?' });
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(destructive).toBeFocused();
  await destructive.click();
  const confirmButton = dialog.getByRole('button', { name: 'Delete example' });
  await confirmButton.focus(); await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Working' })).toHaveAttribute('aria-disabled', 'true');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-disabled', 'true');
  await expect(dialog.getByRole('button', { name: 'Working' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole('status').filter({ hasText: 'Example deleted locally.' })).toBeVisible();
  await expect(destructive).toBeFocused();
  await page.getByRole('button', { name: 'Example failure', exact: true }).click();
  const failing = page.getByRole('alertdialog', { name: 'Try this action?' });
  await failing.getByRole('button', { name: 'Try it' }).click();
  await expect(failing.getByRole('alert')).toHaveText('The example action failed.');
  await expect(failing.getByRole('button', { name: 'Try it' })).not.toHaveAttribute('aria-disabled', 'true');
  await axe('failed confirmation'); await failing.getByRole('button', { name: 'Cancel' }).click(); await expect(failing).toHaveCount(0);
  await page.getByRole('button', { name: 'Example continue', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Continue?' }).getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Continued.' })).toBeVisible();
  // Responsive and themed: cards below 768px, 44px targets below 1024px, no overflow, axe in both modes.
  for (const width of [360, 390, 768, 1280, 1440]) for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(value => localStorage.setItem('harvest-color-mode', value), mode); await page.reload();
    const cards = section.locator('[data-slot="data-table-cards"]');
    if (width < 768) { await expect(cards).toBeVisible(); await expect(table).toHaveCount(0); await expect(cards.locator('li')).toHaveCount(5); await expect(cards.locator('dt').first()).toBeVisible(); }
    else { await expect(table).toBeVisible(); await expect(cards).toHaveCount(0); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    const minimum = width < 1024 ? 44 : 32;
    for (const control of await section.locator('[data-slot="data-table"] button:not([role="checkbox"]):visible, [data-slot="data-table"] label:has([role="checkbox"])').all()) {
      const box = await control.boundingBox(); if (!box) continue;
      expect(box.height, `${width} ${mode} control height`).toBeGreaterThanOrEqual(minimum - 0.5);
    }
    await section.getByRole('checkbox', { name: 'Select Sample item B' }).click();
    await axe(`${width} ${mode} with selection`);
    await section.getByRole('button', { name: 'Clear selection' }).click();
    await page.locator('#pageParts').scrollIntoViewIfNeeded();
    if (mode === 'light' || width === 360) await page.screenshot({ path: `/tmp/ui-showcase/page-parts-${width}-${mode}.png` });
  }
});

test("forms and steps: stepper states, wizard validation, sections and the save bar, at five widths in both themes", async ({ page }) => {
  test.setTimeout(300000);
  test.skip(process.env.HARVEST_UI_SHOWCASE !== "1", "the showcase is development-only");
  const evidence = "docs/screenshots/kit-pr4"; await mkdir(evidence, { recursive: true });
  await signIn(page); await page.setViewportSize({ width: 1280, height: 1000 }); await page.goto('/dev/ui#forms');
  const section = page.locator('#forms');
  await expect(section).toBeVisible();
  const settle = async () => { await expect(section.getByRole('heading', { name: 'Forms and steps', exact: true })).toBeVisible(); await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))); };
  const axe = async (label: string) => { await settle(); expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, label).toEqual([]); };

  // Stepper: done, current and upcoming are text as well as colour; exactly one current step.
  const wizardStepper = section.locator('[data-example-stepper="wizard"]');
  const list = wizardStepper.getByRole('list', { name: 'Example steps' });
  await expect(list.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(list.locator('[aria-current="step"]')).toContainText('Audience');
  await expect(list.getByText('Completed', { exact: true })).toHaveCount(1); await expect(list.getByText('Upcoming', { exact: true })).toHaveCount(1);
  const nav = section.getByRole('navigation', { name: 'Example sections' });
  await expect(nav.getByRole('button', { name: /Soon/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(nav.getByRole('button', { name: /Audience/ })).toHaveAttribute('aria-current', 'step');

  // Wizard: Next validates; the error shows beside the field and as an alert; Back and Finish work; focus follows the step heading.
  const wizard = section.locator('[data-example-wizard]');
  await expect(wizard.getByRole('heading', { name: 'Details', level: 2 })).toBeVisible();
  await expect(wizard.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
  await wizard.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(wizard.getByRole('alert').filter({ hasText: 'Fix the highlighted field to continue.' })).toBeVisible();
  await expect(wizard.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await axe('wizard with a validation error');
  await wizard.getByLabel('Name', { exact: true }).fill('Grace');
  await wizard.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(wizard.getByRole('heading', { name: 'Audience', level: 2 })).toBeFocused();
  await wizard.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(wizard.getByRole('heading', { name: 'Details', level: 2 })).toBeFocused();
  await expect(wizard.getByLabel('Name', { exact: true })).toHaveValue('Grace');
  await wizard.getByRole('button', { name: 'Next', exact: true }).click(); await wizard.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(wizard.getByRole('heading', { name: 'Review', level: 2 })).toBeFocused();
  await expect(wizard.getByText('Ready to create Grace.', { exact: true })).toBeVisible();
  await wizard.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(wizard.getByRole('status').filter({ hasText: 'Example finished.' })).toBeVisible();
  await wizard.getByRole('button', { name: 'Start again', exact: true }).click();
  // Keyboard only: Tab reaches Next, Enter moves on.
  await wizard.getByLabel('Name', { exact: true }).fill('Keys');
  await page.keyboard.press('Tab'); await expect(wizard.getByRole('button', { name: 'Next', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(wizard.getByRole('heading', { name: 'Audience', level: 2 })).toBeFocused();
  await wizard.getByRole('button', { name: 'Back', exact: true }).click(); await wizard.getByLabel('Name', { exact: true }).fill('');

  // Sections: a region named by its heading and a labelled group.
  const sections = section.locator('[data-example-sections]');
  await expect(sections.getByRole('region', { name: 'Stacked section' })).toBeVisible();
  await expect(sections.getByRole('group', { name: 'Grouped fields' })).toBeVisible();
  await expect(sections.getByLabel('Title', { exact: true })).toHaveAttribute('aria-invalid', 'true');

  // Save bar: hidden while clean, visible while dirty, busy while saving, then hidden again; Discard restores.
  const live = section.locator('[data-example-savebar="live"]');
  const bar = live.locator('[data-slot="sticky-save-bar"]');
  await expect(bar).toHaveCount(0);
  await live.getByLabel('Title', { exact: true }).fill('Changed');
  await expect(bar).toBeVisible(); await expect(live.getByRole('status')).toHaveText('Unsaved changes');
  await bar.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(live.getByLabel('Title', { exact: true })).toHaveValue(''); await expect(bar).toHaveCount(0);
  await live.getByLabel('Title', { exact: true }).fill('Changed again');
  await bar.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-disabled', 'true');
  await expect(live.getByRole('status')).toHaveText('Saving…');
  await expect(bar).toHaveCount(0, { timeout: 5000 });
  await expect(section.locator('[data-example-savebar="hidden"] [data-slot="sticky-save-bar"]')).toHaveCount(0);
  await expect(section.locator('[data-example-savebar="visible"] [data-slot="sticky-save-bar"]')).toBeVisible();
  await expect(section.locator('[data-example-savebar="busy"]').getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-disabled', 'true');

  // A focused field is never left under the bar: type in a field near the bottom of the viewport.
  await page.setViewportSize({ width: 390, height: 700 });
  await live.getByLabel('Title', { exact: true }).scrollIntoViewIfNeeded(); await live.getByLabel('Title', { exact: true }).fill('x');
  await expect(bar).toBeVisible();
  const barBox = await bar.boundingBox(), fieldBox = await live.getByLabel('Title', { exact: true }).boundingBox();
  expect(barBox && fieldBox && fieldBox.y + fieldBox.height <= barBox.y + 1).toBe(true);
  await bar.getByRole('button', { name: 'Discard', exact: true }).click();

  // Responsive and themed: compact steps below 768px, full row above; 44px targets below 1024px; no overflow; axe in both modes.
  for (const width of [360, 390, 768, 1280, 1440]) for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(value => localStorage.setItem('harvest-color-mode', value), mode); await page.reload(); await settle();
    const compact = wizardStepper.locator('[data-slot="stepper-compact"]');
    if (width < 768) { await expect(compact).toBeVisible(); await expect(compact).toContainText('Step 2 of 3'); await expect(list).toBeHidden(); }
    else { await expect(compact).toBeHidden(); await expect(list).toBeVisible(); }
    await expect(section.locator('[data-example-stepper="full"]').getByRole('list', { name: 'Example steps, full list' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${width} ${mode} overflow`).toBeLessThanOrEqual(0);
    await live.getByLabel('Title', { exact: true }).fill('Dirty');
    if (width < 1024) for (const control of await section.locator('[data-example-wizard] button:visible, [data-example-savebar] button:visible, [data-example-stepper="nav"] button:visible, [data-example-sections] button:visible').all()) {
      const box = await control.boundingBox(); if (box) expect(box.height, `${width} ${mode} control height`).toBeGreaterThanOrEqual(43.5);
    }
    await axe(`${width} ${mode}`);
    if (width === 360 || width === 1280) { await section.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/forms-${width}-${mode}.png`, fullPage: false }); }
    await live.getByRole('button', { name: 'Discard', exact: true }).click();
  }
});

test("CRM pieces: tracker states, copy button and the phone card summary, at five widths in both themes", async ({ page, context }) => {
  test.setTimeout(300000);
  test.skip(process.env.HARVEST_UI_SHOWCASE !== "1", "the showcase is development-only");
  const evidence = "docs/screenshots/kit-pr5"; await mkdir(evidence, { recursive: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await signIn(page); await page.setViewportSize({ width: 1280, height: 1000 }); await page.goto('/dev/ui#crm');
  const section = page.locator('#crm');
  await expect(section).toBeVisible();
  const settle = async () => { await expect(section.getByRole('heading', { name: 'CRM pieces', exact: true })).toBeVisible(); await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))); };

  // Tracker: one current step per list; completed, current and upcoming are text as well as colour.
  const first = section.getByRole('list', { name: 'Example progress', exact: true });
  await expect(first.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(first.locator('[aria-current="step"]')).toContainText('Second');
  await expect(first.getByText('completed')).toHaveCount(1); await expect(first.getByText('upcoming')).toHaveCount(2);
  // Copy: writes the value and confirms. The click is retried until the page has hydrated this section.
  await expect(async () => {
    await section.getByRole('button', { name: 'Copy example address', exact: true }).click();
    await expect(page.getByText('Copied', { exact: true }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('sample@example.com');

  for (const width of [360, 390, 768, 1280, 1440]) for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate((value) => localStorage.setItem('harvest-color-mode', value), mode); await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await settle();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, `${width}-${mode}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}-${mode} overflow`).toBe(true);
    const summary = section.locator('[data-example-summary]');
    for (const link of await summary.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (width < 1024) for (const button of await section.locator('[data-example-copy]').getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Compact: only the current tracker label is visible below 640px.
    const labels = first.locator('li:not([aria-current]) > span:last-child');
    if (width < 640) { const visible = await labels.evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).getBoundingClientRect().width > 2).length); expect(visible).toBe(0); }
    await section.scrollIntoViewIfNeeded();
    if (width === 360 || width === 1280) await section.screenshot({ path: `${evidence}/showcase-crm-${width}-${mode}.png` });
  }
});

test("Permission cards: state as text, actions by caller, five widths in both themes", async ({ page }) => {
  test.setTimeout(300000);
  test.skip(process.env.HARVEST_UI_SHOWCASE !== "1", "the showcase is development-only");
  const evidence = "docs/screenshots/kit-pr6"; await mkdir(evidence, { recursive: true });
  await signIn(page); await page.setViewportSize({ width: 1280, height: 1000 }); await page.goto('/dev/ui#permission');
  const section = page.locator('#permission');
  await expect(section).toBeVisible();
  const list = section.getByRole('list', { name: 'Example permissions', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByText('Opted in', { exact: true })).toBeVisible(); await expect(list.getByText('Withdrawn', { exact: true })).toBeVisible(); await expect(list.getByText('No opt-in', { exact: true })).toBeVisible();
  await expect(list.getByRole('button')).toHaveCount(1);
  for (const width of [360, 390, 768, 1280, 1440]) for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate((value) => localStorage.setItem('harvest-color-mode', value), mode); await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await expect(section.getByRole('heading', { name: 'Permission cards', exact: true })).toBeVisible();
    // The whole page is audited, so wait until the community member list (Kit PR 7) has switched to its phone layout after hydration.
    await expect(page.locator('[data-example-communities] [data-slot="data-table-results"]')).toHaveAttribute('data-layout', width < 768 ? 'cards' : 'table');
    await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, `${width}-${mode}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}-${mode} overflow`).toBe(true);
    if (width < 1024) for (const button of await list.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    if (width === 360 || width === 1280) { await section.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/permission-cards-${width}-${mode}.png` }); }
  }
});
