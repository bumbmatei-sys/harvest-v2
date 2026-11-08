import { mkdir } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn, origin } from "./helpers/session";
import { themeRegistry } from "../../src/lib/theme-registry";

const rgb = (hex: string) => `rgb(${[1,3,5].map(offset => parseInt(hex.slice(offset,offset+2),16)).join(', ')})`;

test('static previews preserve preferences and color modes work', async ({page}) => {
  test.setTimeout(180000); await signIn(page);
  const w=await page.request.post('/api/workspaces',{headers:{origin},data:{name:'Appearance check'}});expect(w.status()).toBe(201);
  const tenant=(await w.json()).tenantId;
  await page.goto(`/workspaces/${tenant}/appearance`);
  await page.evaluate(()=>{localStorage.setItem('harvest-brand-theme','studio');localStorage.setItem('harvest-color-mode','dark');});
  await page.reload();const writes:string[]=[];
  page.on('request',r=>{if(r.method()!=='GET' && r.url().includes('/api/workspaces/'))writes.push(r.url());});
  const before=await page.evaluate(()=>({brand:localStorage.getItem('harvest-brand-theme'),mode:localStorage.getItem('harvest-color-mode')}));
  for(const mode of ['light','dark'] as const){
    const preview=page.locator(`[data-preview-mode=${mode}]`);
    await expect(preview).toHaveAttribute('inert','');
    await expect(preview).toHaveAttribute('aria-hidden','true');
    const colors=await preview.evaluate(e=>{const css=getComputedStyle(e);return {background:css.getPropertyValue('--background').trim(),primary:css.getPropertyValue('--primary').trim()};});
    expect(colors).toEqual({background:themeRegistry.studio[mode]['--surface'],primary:themeRegistry.studio[mode]['--brand-color']});
    await preview.hover({force:true});
  }
  expect(await page.evaluate(()=>({brand:localStorage.getItem('harvest-brand-theme'),mode:localStorage.getItem('harvest-color-mode')}))).toEqual(before);
  expect(writes).toEqual([]);await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await expect(page.getByRole('menuitemradio',{name:'Harvest',exact:true})).toHaveCount(0);
  await expect(page.getByRole('menuitemradio',{name:'Studio',exact:true})).toHaveCount(0);
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  await page.getByRole('menuitemradio',{name:'System',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  expect(await page.evaluate(()=>localStorage.getItem('harvest-color-mode'))).toBeNull();
  await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('[data-hydrated=true]')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('harvest-brand-theme'))).toBe('studio');
  await mkdir('/tmp/appearance-preview',{recursive:true});
  for(const width of [360,390,768,1280,1440])for(const mode of ['light','dark'] as const){
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:mode});
    await expect(page.locator('html')).toHaveAttribute('data-theme',mode);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
    if (width === 360) for (const previewMode of ['light','dark'] as const) {
      const rendered = await page.locator(`[data-preview-mode=${previewMode}]`).evaluate(root => {
        const color = (slot: string) => getComputedStyle(root.querySelector(`[data-slot=${slot}]`)!);
        return {card:color('card').backgroundColor,badge:color('badge').backgroundColor,button:color('button').backgroundColor,input:color('input').backgroundColor,buttonText:color('button').color};
      });
      const palette=themeRegistry.studio[previewMode];
      expect(rendered).toEqual({card:rgb(palette['--surface-card']),badge:rgb(palette['--surface-tint']),button:rgb(palette['--brand-color']),input:rgb(palette['--surface']),buttonText:rgb(palette['--action-foreground'])});
    }
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:`/tmp/appearance-preview/${width}-${mode}.png`});
  }
  expect(writes).toEqual([]);
});

test('color modes remain usable with storage blocked',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('blocked')};Storage.prototype.setItem=()=>{throw new Error('blocked')};Storage.prototype.removeItem=()=>{throw new Error('blocked')};});
  await page.emulateMedia({colorScheme:'dark'});await page.goto('/sign-in');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('combobox',{name:'Color mode',exact:true}).click();
  await page.getByRole('option',{name:'Light',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('combobox',{name:'Color mode',exact:true}).click();
  await page.getByRole('option',{name:'System',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});
