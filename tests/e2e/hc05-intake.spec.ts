import { mkdir,writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect,test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin,signIn } from "./helpers/session";
import { expectFullWidthShell } from "./helpers/layout";
const evidence=process.env.HC05_QA_DIR??join(tmpdir(),"harvest-hc05-qa");
test.use({reducedMotion:"reduce"});
for(const scheme of ["light","dark"] as const) {
 test(`HC-05 admin setup, both opt-ins and guest rights: ${scheme}`,async({page,browser})=>{
  test.setTimeout(240000);await mkdir(evidence,{recursive:true});await page.emulateMedia({colorScheme:scheme});
  await page.setViewportSize({width:390,height:844});await signIn(page);
  const workspace=await page.request.post("/api/workspaces",{headers:{origin},data:{audience:"church",name:"Synthetic intake QA"}});expect(workspace.status()).toBe(201);
  const tenant=(await workspace.json()).tenantId as string;
  const campaign=await page.request.post(`/api/workspaces/${tenant}/campaigns`,{headers:{origin,"Idempotency-Key":randomUUID()},data:{name:"Synthetic request campaign",type:"conference"}});
  expect(campaign.status()).toBe(201);const campaignId=(await campaign.json()).id as string;
  const root=`/workspaces/${tenant}/campaigns/${campaignId}/connect`,api=`/api/workspaces/${tenant}/campaigns/${campaignId}/connect`;
  await page.goto(root);await page.getByRole("link",{name:"Configure test form"}).click();
  await expect(page.getByRole("heading",{name:"Response form settings"})).toBeVisible();await expectFullWidthShell(page);
  await page.getByLabel("Internal form name",{exact:true}).fill("Synthetic field preset");
  await page.getByLabel("Synthetic notice text",{exact:true}).fill("Synthetic notice only. Select each purpose separately. Use the private receipt to withdraw or erase.");
  await page.getByLabel("Test retention (days)",{exact:true}).fill("2");
  const checkboxes=page.getByRole("checkbox");expect(await checkboxes.count()).toBe(4);await expect(checkboxes.nth(0)).toBeChecked();
  const published=page.waitForResponse(r=>r.url().endsWith(`${api}/forms`)&&r.request().method()==="POST");
  await page.getByRole("button",{name:"Publish test revision",exact:true}).click();
  const publishedResponse=await published;expect(publishedResponse.status()).toBe(201);const version=(await publishedResponse.json()).id as string;
  await expect(page.getByRole("status")).toContainText("Test revision published");
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
  await page.getByLabel("Test retention (days)",{exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Internal form name",{exact:true})).toHaveValue("Synthetic field preset");
  await page.screenshot({path:join(evidence,`settings-details-mobile-${scheme}.png`),fullPage:true});
  await page.getByRole("heading",{name:"Response form settings"}).scrollIntoViewIfNeeded();
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({path:join(evidence,`settings-mobile-${scheme}.png`),fullPage:true});
  const linkRes=await page.request.post(`${api}/links`,{headers:{origin},data:{label:"Synthetic guest source",publicTitle:"Synthetic resource event",formVersionId:version}});
  expect(linkRes.status()).toBe(201);const link=await linkRes.json();
  expect((await page.request.post(`${api}/links/${link.id}/actions`,{headers:{origin},data:{action:"publish"}})).status()).toBe(200);
  const guest=await browser.newContext({viewport:{width:390,height:844},colorScheme:scheme,reducedMotion:"reduce"});
  try {
   const visitor=await guest.newPage();const sideEffects:string[]=[];visitor.on("request",r=>{if(r.method()!=="GET")sideEffects.push(r.url());});
   const response=await visitor.goto(`/s/${link.shortCode}`);expect(response?.status()).toBe(200);expect(response?.headers()["cache-control"]).toContain("no-store");expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
   await expect(visitor.getByRole("heading",{name:"Your next step",exact:true})).toBeVisible();
   expect(sideEffects).toEqual([]);expect(await guest.cookies()).toEqual([]);
   const followUp=visitor.getByRole("checkbox",{name:"I would like pastoral follow-up",exact:true}),newsletter=visitor.getByRole("checkbox",{name:"I would like to sign up for the newsletter",exact:true});
   await expect(followUp).not.toBeChecked();await expect(newsletter).not.toBeChecked();await expect(visitor.getByRole("button",{name:"Save test request"})).toBeDisabled();
   await followUp.focus();await visitor.keyboard.press("Space");await expect(followUp).toBeChecked();await newsletter.check();await expect(visitor.getByLabel("Email",{exact:true})).toHaveCount(1);
   await visitor.getByLabel("Preferred name (optional)",{exact:true}).fill("Synthetic Guest");
   await visitor.getByLabel("Email",{exact:true}).fill("real@example.com");
   const invalid=visitor.waitForResponse(r=>r.url().endsWith("/responses")&&r.request().method()==="POST");
   await visitor.getByRole("button",{name:"Save test request",exact:true}).click();expect((await invalid).status()).toBe(400);
   await expect(visitor.getByLabel("Email",{exact:true})).toBeEnabled();await expect(followUp).toBeEnabled();
   await expect(visitor.getByRole("alert").filter({hasText:"Check your choices and use synthetic contact details only."})).toBeVisible();
   await visitor.getByLabel("Email",{exact:true}).fill("browser@example.test");
   await visitor.getByRole("button",{name:"Save test request",exact:true}).scrollIntoViewIfNeeded();
   expect((await new AxeBuilder({page:visitor}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
   await visitor.screenshot({path:join(evidence,`form-mobile-${scheme}.png`),fullPage:true});
   const submitResponse=visitor.waitForResponse(r=>r.url().endsWith("/responses")&&r.request().method()==="POST");
   let release!:()=>void;const requestGate=new Promise<void>(resolve=>{release=resolve;});
   await visitor.route("**/api/public/connect/*/*/responses",async route=>{await requestGate;await route.continue();},{times:1});
   await visitor.getByRole("button",{name:"Save test request",exact:true}).click();
   try {await expect(followUp).toBeDisabled();await expect(newsletter).toBeDisabled();}finally{release();}
   const saved=await submitResponse;
   expect(saved.status()).toBe(201);const savedBody=saved.request().postDataJSON();
   await expect(visitor.getByRole("heading",{name:"Test request saved",exact:true})).toBeVisible();
   await expect(visitor.getByText(/No message was sent, no newsletter subscription was activated/)).toBeVisible();
   expect(visitor.url()).not.toContain(savedBody.receiptToken);expect(await guest.cookies()).toEqual([]);
   expect((await visitor.request.post(saved.url(),{headers:{origin},data:savedBody})).status()).toBe(200);
   await visitor.getByRole("button",{name:"Withdraw newsletter request",exact:true}).click();await expect(visitor.getByRole("status")).toContainText("Request acknowledged");
   await visitor.getByRole("button",{name:"Erase test request",exact:true}).click();await expect(visitor.getByRole("status")).toContainText("Request acknowledged");
   expect((await visitor.request.post(saved.url(),{headers:{origin},data:savedBody})).status()).toBe(404);
   expect((await new AxeBuilder({page:visitor}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
   await visitor.screenshot({path:join(evidence,`receipt-mobile-${scheme}.png`),fullPage:true});
   await visitor.goto("/connect/rights");await expect(visitor.getByRole("heading",{name:"Manage a test response"})).toBeVisible();
   await visitor.getByLabel("Private recovery code",{exact:true}).fill(savedBody.receiptToken);await visitor.getByRole("button",{name:"Apply action"}).click();await expect(visitor.getByRole("status")).toContainText("Request acknowledged");
   expect((await new AxeBuilder({page:visitor}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
   await visitor.screenshot({path:join(evidence,`rights-mobile-${scheme}.png`),fullPage:true});
   // Runtime failure/abuse behavior is safe through the real HTTP routes.
   expect((await visitor.request.post(saved.url(),{headers:{origin:"https://other.example.test"},data:savedBody})).status()).toBe(403);
   expect((await visitor.request.post(saved.url(),{headers:{origin,"content-type":"application/json"},data:"x".repeat(33000)})).status()).toBe(400);
   expect((await visitor.request.post(saved.url(),{headers:{origin},data:{...savedBody,email:"real@example.com"}})).status()).toBe(400);
   // Tablets: labels, actual viewport, all visible control targets, no horizontal overflow.
   await visitor.setViewportSize({width:768,height:1024});await visitor.goto(`/c/${link.publicCode}`);
   await visitor.getByRole("checkbox",{name:"I would like to sign up for the newsletter",exact:true}).check();
   const geometry=await visitor.locator("#response-form").evaluate(n=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,controls:Array.from(n.querySelectorAll("button,input:not([tabindex='-1'])")).map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height};})}));
   expect(geometry.overflow).toBeLessThanOrEqual(0);for(const control of geometry.controls.filter(v=>v.width>0)){expect(control.height).toBeGreaterThanOrEqual(44);expect(control.width).toBeGreaterThanOrEqual(44);}
   await visitor.screenshot({path:join(evidence,`form-tablet-${scheme}.png`),fullPage:true});
   expect((await new AxeBuilder({page:visitor}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
   await writeFile(join(evidence,`metrics-${scheme}.json`),JSON.stringify({scheme,geometry,axeViolations:0,scans:6},null,2)+"\n");
  }finally{await guest.close();}
 });
}
