import { readFile,mkdir,writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect,test,type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin,signIn } from "./helpers/session";
test.use({actionTimeout:30000});
const evidence=process.env.HC07_QA_DIR??join(tmpdir(),"harvest-hc07-qa");
async function mailbox(){return (await readFile(process.env.HARVEST_E2E_MAILBOX!,"utf8")).trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));}
async function capture(page:Page,name:string){
 const axe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();expect(axe.violations,name).toEqual([]);
 const geometry=await page.locator("main").evaluate(n=>({overflow:document.documentElement.scrollWidth-innerWidth,controls:Array.from(n.querySelectorAll("button,a[data-slot='button'],input:not([type='hidden'])")).filter(e=>e.getClientRects().length).map(e=>{const b=e.getBoundingClientRect();return {label:e.getAttribute("aria-label")??e.getAttribute("id")??e.textContent,width:b.width,height:b.height};})}));
 expect(geometry.overflow).toBeLessThanOrEqual(0);for(const control of geometry.controls){expect(control.height,control.label??name).toBeGreaterThanOrEqual(44);expect(control.width,control.label??name).toBeGreaterThanOrEqual(44);}
 await page.screenshot({path:join(evidence,`${name}.png`),fullPage:true});return {name,geometry,axeViolations:0};
}
for(const scheme of ["light","dark"] as const){
 test(`HC-07 personal account invitation, verified claim and welcome: ${scheme}`,async({page,browser})=>{
  test.setTimeout(240000);await mkdir(evidence,{recursive:true});await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:scheme,reducedMotion:"reduce"});await signIn(page);
  const workspace=await page.request.post("/api/workspaces",{headers:{origin},data:{audience:"church",name:"HC07 synthetic QA"}});expect(workspace.status()).toBe(201);const tenant=(await workspace.json()).tenantId;
  const campaign=await page.request.post(`/api/workspaces/${tenant}/campaigns`,{headers:{origin,"Idempotency-Key":randomUUID()},data:{name:"Personal account test",type:"conference"}});expect(campaign.status()).toBe(201);const campaignId=(await campaign.json()).id;
  const api=`/api/workspaces/${tenant}/campaigns/${campaignId}/connect`;
  await page.goto(`/workspaces/${tenant}/campaigns/${campaignId}/connect/forms`);
  await page.getByLabel("Internal form name",{exact:true}).fill("Personal account preset");await page.getByLabel("Synthetic notice text",{exact:true}).fill("Synthetic notice for independent personal-account invitation request.");await page.getByLabel("Test retention (days)",{exact:true}).fill("1");
  await page.getByRole("checkbox",{name:"Send me an invitation to a personal Harvest account",exact:true}).check();
  const publishing=page.waitForResponse(r=>r.url().endsWith("/forms")&&r.request().method()==="POST");await page.getByRole("button",{name:"Publish test revision",exact:true}).click();const published=await publishing;expect(published.status()).toBe(201);const version=(await published.json()).id;
  const linkRes=await page.request.post(`${api}/links`,{headers:{origin},data:{label:"HC07 personal invitation",publicTitle:"Personal invitation",formVersionId:version}});expect(linkRes.status()).toBe(201);const link=await linkRes.json();expect((await page.request.post(`${api}/links/${link.id}/actions`,{headers:{origin},data:{action:"publish"}})).status()).toBe(200);
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:scheme,reducedMotion:"reduce",extraHTTPHeaders:{"x-forwarded-for":scheme==="light"?"10.71.1.1":"10.71.1.2"}});
  try{
   const visitor=await context.newPage(),email=`hc07-${randomUUID()}@example.test`,metrics=[];
   await visitor.goto("/account/welcome");await expect(visitor).toHaveURL(/\/sign-in\?personal=1$/);
   await visitor.goto(`/s/${link.shortCode}`);await expect(visitor.locator("#response-form")).toBeVisible();
   await expect(visitor.getByRole("link",{name:"Request a free account",exact:true})).toHaveAttribute("href","#response-form");
   const choices=visitor.locator("#response-form").getByRole("checkbox");await expect(choices).toHaveCount(3);for(const choice of await choices.all())await expect(choice).not.toBeChecked();
   await visitor.getByRole("checkbox",{name:"Send me an invitation to a personal Harvest account",exact:true}).focus();await visitor.keyboard.press("Space");await visitor.getByLabel("Email",{exact:true}).fill(email);
   metrics.push(await capture(visitor,`invitation-form-mobile-${scheme}`));
   const submitting=visitor.waitForResponse(r=>r.url().endsWith("/responses")&&r.request().method()==="POST");await visitor.getByRole("button",{name:"Save test request",exact:true}).click();const saved=await submitting;expect(saved.status()).toBe(201);
   await expect(visitor.getByText(/delivery is queued; it has not been confirmed/)).toBeVisible();metrics.push(await capture(visitor,`pending-mobile-${scheme}`));
   // This operator command can only write a local mock mailbox; no live transport is invoked.
   const config=JSON.parse(await readFile(`${process.env.HARVEST_E2E_MAILBOX}.connect-worker`,"utf8"));
   const dispatched=await promisify(execFile)(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/drain-connect-invitations.ts"],{env:{...process.env,...config,NODE_ENV:"test",HARVEST_CONNECT_INTAKE:"synthetic",HARVEST_CONNECT_TEST_MAILBOX:process.env.HARVEST_E2E_MAILBOX,BETTER_AUTH_URL:origin},timeout:20000});
   expect(JSON.parse(dispatched.stdout).sent).toBe(1);
   const mail=(await mailbox()).find(m=>m.to===email&&m.idempotencyKey);expect(mail).toBeTruthy();const url=mail.text.match(/http:\/\/127\.0\.0\.1:3100\/connect\/claim#token=[a-f0-9]{64}/)?.[0];expect(url).toBeTruthy();
   const token=new URL(url).hash.slice(7),claims:string[]=[];visitor.on("request",r=>{if(r.url().includes("/api/connect/invitations/claim"))claims.push(r.method());});
   const opened=await visitor.goto(url);expect(opened?.headers()["cache-control"]).toContain("no-store");expect(opened?.headers()["referrer-policy"]).toBe("no-referrer");
   await expect(visitor.getByRole("button",{name:"Continue securely",exact:true})).toBeVisible();expect(visitor.url()).not.toContain(token);expect(claims).toEqual([]);
   metrics.push(await capture(visitor,`prepare-mobile-${scheme}`));await visitor.getByRole("button",{name:"Continue securely",exact:true}).click();
   await visitor.getByRole("link",{name:"Verify my email or sign in",exact:true}).click();await expect(visitor).toHaveURL(/\/sign-in\?connect=1$/);
   metrics.push(await capture(visitor,`sign-in-mobile-${scheme}`));
   await visitor.getByLabel("Email address",{exact:true}).fill(email);await visitor.getByRole("button",{name:"Send sign-in code",exact:true}).click();
   await expect(visitor.getByLabel("Six-digit code",{exact:true})).toBeVisible();metrics.push(await capture(visitor,`verification-mobile-${scheme}`));let code="";
   await expect.poll(async()=>{code=(await mailbox()).filter(m=>m.to===email&&!m.idempotencyKey).at(-1)?.text.match(/\b\d{6}\b/)?.[0]??"";return code.length;}).toBe(6);
   await visitor.getByLabel("Six-digit code",{exact:true}).fill(code);await visitor.getByRole("button",{name:"Sign in",exact:true}).click();
   await expect(visitor.getByRole("button",{name:"Confirm this request for my account",exact:true})).toBeVisible();await expect(visitor.getByText(`You are signed in as ${email}.`,{exact:false})).toBeVisible();
   metrics.push(await capture(visitor,`confirm-mobile-${scheme}`));await visitor.getByRole("button",{name:"Confirm this request for my account",exact:true}).click();
   await visitor.getByRole("button",{name:"Skip for now",exact:true}).click();
   await expect(visitor.getByRole("heading",{name:"Welcome to Harvest",exact:true})).toBeVisible();expect(visitor.url()).toContain("/account/welcome");
   await expect(visitor.getByRole("link",{name:"Return to the outreach page",exact:true})).toHaveAttribute("href",`/c/${link.publicCode}`);
   expect((await visitor.request.get("/api/workspaces")).ok()).toBe(true);const workspaces=await (await visitor.request.get("/api/workspaces")).json();expect(workspaces).toEqual([]);
   metrics.push(await capture(visitor,`welcome-mobile-${scheme}`));await visitor.setViewportSize({width:768,height:1024});metrics.push(await capture(visitor,`welcome-tablet-${scheme}`));
   await visitor.getByRole("link",{name:"Manage my profile",exact:true}).click();await expect(visitor.getByRole("heading",{name:"Your personal profile",exact:true})).toBeVisible();metrics.push(await capture(visitor,`profile-tablet-${scheme}`));
   await visitor.goto(url);await visitor.getByRole("button",{name:"Continue securely",exact:true}).click();await expect(visitor.getByText("This invitation is unavailable, expired or already used. Free resources are still available.",{exact:true})).toBeVisible();metrics.push(await capture(visitor,`replay-tablet-${scheme}`));
   await writeFile(join(evidence,`metrics-${scheme}.json`),JSON.stringify(metrics,null,2)+"\n");
  }finally{await context.close();}
 });
}

test("HC-07 existing personal account, mismatch, switch and decline stay independent of Organizations",async({page,browser})=>{
 test.setTimeout(240000);await mkdir(evidence,{recursive:true});await signIn(page);
 const workspace=await page.request.post("/api/workspaces",{headers:{origin},data:{audience:"church",name:"HC07 existing account source"}});const tenant=(await workspace.json()).tenantId;
 const campaign=await page.request.post(`/api/workspaces/${tenant}/campaigns`,{headers:{origin,"Idempotency-Key":randomUUID()},data:{name:"Existing account campaign",type:"conference"}});const campaignId=(await campaign.json()).id;
 const api=`/api/workspaces/${tenant}/campaigns/${campaignId}/connect`;
 const version=await page.request.post(`${api}/forms`,{headers:{origin},data:{name:"Existing account preset",notice:"Synthetic account invitation",retentionDays:1,purposes:["account_communications"],definition:{kind:"connect-intake-v2",syntheticOnly:true,preferredName:false,followUpChannel:"email"}}});expect(version.status()).toBe(201);
 const linkRes=await page.request.post(`${api}/links`,{headers:{origin},data:{label:"Existing account source",formVersionId:(await version.json()).id}});const link=await linkRes.json();expect((await page.request.post(`${api}/links/${link.id}/actions`,{headers:{origin},data:{action:"publish"}})).status()).toBe(200);
 const recipient=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"}),wrong=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});
 try{
  const recipientPage=await recipient.newPage(),email=await signIn(recipientPage);const own=await recipientPage.request.post("/api/workspaces",{headers:{origin},data:{audience:"church",name:"Existing own Organization"}});const ownTenant=(await own.json()).tenantId;
  await recipientPage.goto(`/c/${link.publicCode}`);await recipientPage.getByRole("checkbox",{name:"Send me an invitation to a personal Harvest account",exact:true}).check();await recipientPage.getByLabel("Email",{exact:true}).fill(email);
  await recipientPage.getByRole("button",{name:"Save test request",exact:true}).click();await expect(recipientPage.getByRole("heading",{name:"Test request saved",exact:true})).toBeVisible();
  const config=JSON.parse(await readFile(`${process.env.HARVEST_E2E_MAILBOX}.connect-worker`,"utf8"));await promisify(execFile)(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/drain-connect-invitations.ts"],{env:{...process.env,...config,NODE_ENV:"test",HARVEST_CONNECT_INTAKE:"synthetic",HARVEST_CONNECT_TEST_MAILBOX:process.env.HARVEST_E2E_MAILBOX,BETTER_AUTH_URL:origin},timeout:20000});
  const mail=(await mailbox()).find(m=>m.to===email&&m.idempotencyKey),url=mail.text.match(/http:\/\/127\.0\.0\.1:3100\/connect\/claim#token=[a-f0-9]{64}/)[0];
  const wrongPage=await wrong.newPage();await signIn(wrongPage);await wrongPage.goto(url);await wrongPage.getByRole("button",{name:"Continue securely",exact:true}).click();await wrongPage.getByRole("button",{name:"Confirm this request for my account",exact:true}).click();
  await expect(wrongPage.getByRole("alert").filter({hasText:"This invitation cannot be confirmed with the current account."})).toBeVisible();await capture(wrongPage,"mismatch-mobile-light");
  const invalid=await wrongPage.request.post("/api/connect/invitations/prepare",{headers:{origin},data:{token:"f".repeat(64)}});expect(invalid.status()).toBe(409);
  expect((await wrong.cookies()).some(c=>c.name==="harvest_connect_flow")).toBe(false);
  await wrongPage.reload();await expect(wrongPage.getByRole("button",{name:"Confirm this request for my account",exact:true})).toHaveCount(0);
  await wrongPage.goto(url);await wrongPage.getByRole("button",{name:"Continue securely",exact:true}).click();
  await wrongPage.getByRole("button",{name:"Use another account",exact:true}).click();await expect(wrongPage).toHaveURL(/\/sign-in\?connect=1$/);
  // Advance only this disposable fixture's cooldown clock; the original existing-account
  // sign-in above used a code moments ago. Production limits and rolling issuance stay intact.
  const {Pool}=await import("pg");const testUrl=new URL(config.DATABASE_URL);
  if(testUrl.hostname!=="127.0.0.1"||!testUrl.pathname.startsWith("/harvest_test_"))throw new Error("LOCAL_FIXTURE_REQUIRED");
  const clock=new Pool({connectionString:config.DATABASE_URL,max:1});
  try{await clock.query("update otp_cooldowns set sent_at=now()-interval '61 seconds' where email=$1",[email]);}finally{await clock.end();}
  await wrongPage.getByLabel("Email address",{exact:true}).fill(email);await wrongPage.getByRole("button",{name:"Send sign-in code",exact:true}).click();await expect(wrongPage.getByLabel("Six-digit code",{exact:true})).toBeVisible();
  let code="";await expect.poll(async()=>{code=(await mailbox()).filter(m=>m.to===email&&!m.idempotencyKey).at(-1)?.text.match(/\b\d{6}\b/)?.[0]??"";return code.length;}).toBe(6);
  await wrongPage.getByLabel("Six-digit code",{exact:true}).fill(code);await wrongPage.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(wrongPage.getByRole("button",{name:"Continue without linking",exact:true})).toBeVisible();await wrongPage.getByRole("button",{name:"Continue without linking",exact:true}).click();await expect(wrongPage.getByRole("heading",{name:"Welcome to Harvest",exact:true})).toBeVisible();
  // Decline does not consume the invitation. A subsequent verified confirmation can still accept it.
  await wrongPage.goto(url);await wrongPage.getByRole("button",{name:"Continue securely",exact:true}).click();await wrongPage.getByRole("button",{name:"Confirm this request for my account",exact:true}).click();await expect(wrongPage.getByRole("heading",{name:"Welcome to Harvest",exact:true})).toBeVisible();
  const organizations=await (await wrongPage.request.get("/api/workspaces")).json();expect(organizations.map((w:{tenantId:string})=>w.tenantId)).toEqual([ownTenant]);
  await wrongPage.getByRole("button",{name:"Sign out",exact:true}).click();await expect(wrongPage).toHaveURL(/\/resources\/start$/);
 }finally{await recipient.close();await wrong.close();}
});
