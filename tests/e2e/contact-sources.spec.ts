import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { origin, signIn } from "./helpers/session";
test('contact source history reuses the responsive CRM record', async ({page})=>{
 test.setTimeout(180_000);
 await signIn(page);
 const response=await page.request.post('/api/workspaces',{data:{name:'Synthetic source history'},headers:{origin}});
 expect(response.status()).toBe(201);
 const {tenantId}=await response.json();
 const created=await page.request.post(`/api/workspaces/${tenantId}/contacts`,{data:{name:'Synthetic source volunteer'},headers:{origin}});
 expect(created.status()).toBe(201);
 const person=await created.json();
 await mkdir('docs/screenshots/hc06a',{recursive:true});
 for(const width of [390,768,1440]) for(const colorScheme of ['light','dark'] as const){
  await page.emulateMedia({colorScheme});
  await page.setViewportSize({width,height:1000});
  await page.goto(`/workspaces/${tenantId}/crm/people/${person.id}`);
  await expect(page.getByText('Source history',{exact:true})).toBeVisible();
  await expect(page.getByText('Manual · Created',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`docs/screenshots/hc06a/history-${width}-${colorScheme}.png`,fullPage:true});
 }
 await page.goto(`/workspaces/${tenantId}/crm/people?cols=source`);
 await expect(page.getByRole('columnheader',{name:'Source',exact:true})).toBeVisible();
 await expect(page.getByRole('grid')).toContainText('Manual');
});
