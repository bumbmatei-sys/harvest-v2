import { readFile,mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect,test,type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin,signIn } from "./helpers/session";
test.use({actionTimeout:30000});
const evidence=process.env.HC06B_QA_DIR??join(tmpdir(),"harvest-hc06b-qa");
async function capture(page:Page,name:string){
 expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:join(evidence,`${name}.png`),fullPage:true});
}
for(const scheme of ["light","dark"] as const)test(`HC-06B automatic claim, organizer source and subject rights: ${scheme}`,async({page,browser})=>{
 test.setTimeout(240000);await mkdir(evidence,{recursive:true});await page.emulateMedia({colorScheme:scheme,reducedMotion:"reduce"});await signIn(page);
 const tenant=(await (await page.request.post("/api/workspaces",{headers:{origin},data:{audience:"church",name:"Welcome organizer"}})).json()).tenantId;
 const campaign=(await (await page.request.post(`/api/workspaces/${tenant}/campaigns`,{headers:{origin,"Idempotency-Key":randomUUID()},data:{name:"Welcome evening",type:"conference"}})).json()).id;
 const api=`/api/workspaces/${tenant}/campaigns/${campaign}/connect`;
 const published=await page.request.post(`${api}/forms`,{headers:{origin},data:{name:"Welcome request",notice:"Synthetic choices",retentionDays:1,purposes:["account_communications","newsletter"],definition:{kind:"connect-intake-v3",syntheticOnly:true,preferredName:true,followUpChannel:"email"}}});expect(published.status()).toBe(201);
 const link=await (await page.request.post(`${api}/links`,{headers:{origin},data:{label:"Welcome desk",formVersionId:(await published.json()).id}})).json();
 expect((await page.request.post(`${api}/links/${link.id}/actions`,{headers:{origin},data:{action:"publish"}})).status()).toBe(200);
 const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:scheme,reducedMotion:"reduce"});
 try{
  const visitor=await context.newPage(),email=await signIn(visitor);
  await visitor.goto(`/s/${link.shortCode}`);await visitor.getByRole("checkbox",{name:"Send me an invitation to a personal Harvest account",exact:true}).check();await visitor.getByRole("checkbox",{name:"I would like to sign up for the newsletter",exact:true}).check();
  await visitor.getByLabel("Email",{exact:true}).fill(email);await visitor.getByLabel("Preferred name (optional)",{exact:true}).fill("Jordan Visitor");
  await expect(visitor.getByText(/name and verified email are automatically added/)).toBeVisible();
  await visitor.getByRole("button",{name:"Save test request",exact:true}).click();await expect(visitor.getByRole("heading",{name:"Test request saved",exact:true})).toBeVisible();
  const config=JSON.parse(await readFile(`${process.env.HARVEST_E2E_MAILBOX}.connect-worker`,"utf8"));
  await promisify(execFile)(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/drain-connect-invitations.ts"],{env:{...process.env,...config,NODE_ENV:"test",HARVEST_CONNECT_INTAKE:"synthetic",HARVEST_CONNECT_TEST_MAILBOX:process.env.HARVEST_E2E_MAILBOX,BETTER_AUTH_URL:origin},timeout:20000});
  const mail=(await readFile(process.env.HARVEST_E2E_MAILBOX!,"utf8")).trim().split("\n").map(s=>JSON.parse(s)).find(m=>m.to===email&&m.idempotencyKey);
  const url=mail.text.match(/http:\/\/127\.0\.0\.1:3100\/connect\/claim#token=[a-f0-9]{64}/)[0];
  await visitor.goto(url);await visitor.getByRole("button",{name:"Continue securely",exact:true}).click();
  await expect(visitor.getByText(/Confirming this request adds your name and verified email to Welcome organizer/)).toBeVisible();
  await capture(visitor,`claim-mobile-${scheme}`);
  await visitor.getByRole("button",{name:"Confirm this request for my account",exact:true}).click();await expect(visitor.getByRole("heading",{name:"Welcome to Harvest",exact:true})).toBeVisible();
  expect(await (await visitor.request.get("/api/workspaces")).json()).toEqual([]);
  // HC-06D: a finished claim clears the flow cookie, so repeating the action finds no flow and changes nothing.
  expect((await context.cookies()).some(c=>c.name==="harvest_connect_flow")).toBe(false);
  const replay=await visitor.request.post("/api/connect/invitations/claim",{headers:{origin},data:{action:"confirm"}});expect(replay.status()).toBe(409);
  expect(await (await visitor.request.get("/api/connect/invitations/continuation")).json()).toEqual({next:"/account/welcome"});
  await visitor.getByRole("link",{name:"Response preferences",exact:true}).click();
  await expect(visitor.getByRole("heading",{name:"Your responses",exact:true})).toBeVisible();
  for(const [label,width,height] of [["mobile-small",360,800],["mobile",390,844],["tablet",768,1024],["desktop",1280,900],["desktop-wide",1440,1000]] as const){await visitor.setViewportSize({width,height});await capture(visitor,`rights-${label}-${scheme}`);}
  await visitor.getByRole("button",{name:"Withdraw Newsletter",exact:true}).focus();await visitor.keyboard.press("Enter");await expect(visitor.getByRole("button",{name:"Withdraw Newsletter",exact:true})).toHaveCount(0);
  await page.goto(`/workspaces/${tenant}/crm/people`);await page.getByRole("link",{name:"Jordan Visitor",exact:true}).click();await expect(page.getByRole("heading",{name:"Jordan Visitor",exact:true})).toBeVisible({timeout:30000});await expect(page.getByText(/Welcome evening · Welcome desk/)).toBeVisible();await capture(page,`source-desktop-${scheme}`);
  await visitor.getByRole("button",{name:"Delete response",exact:true}).click();await expect(visitor.getByText(/does not delete your account/)).toBeVisible();await visitor.getByRole("button",{name:"Confirm response deletion",exact:true}).click();await expect(visitor.getByText("No retained responses are linked to this account.",{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText(/Welcome evening · Welcome desk/)).toHaveCount(0);await expect(page.getByRole("heading",{name:"Jordan Visitor",exact:true})).toBeVisible();
 }finally{await context.close();}
});
