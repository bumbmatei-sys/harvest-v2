import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createContact, recordConsent } from "../../src/server/contacts";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { drainJobs } from "../../src/server/jobs/service";
import { autoDmActivity, changeAutoDmRule, createAutoDmRule, listAutoDmRules, previewAutoDmRule } from "../../src/server/social/auto-dm";
import { runSocialAutoDm } from "../../src/server/social/auto-dm-worker";
import { linkConnection, setConnectionEnabled } from "../../src/server/social/service";
import { receiveSocialWebhook } from "../../src/server/social/webhook";
import { saveInboxHours } from "../../src/server/social/inbox-metadata";
import { testDatabase } from "../database";
import { CANARY, depsFor, event, newFake, noNetwork, seedPeople, signedRequest, useTestKeys } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
const provider = newFake(), deps = depsFor(provider);
let f: Awaited<ReturnType<typeof testDatabase>>, p: Awaited<ReturnType<typeof seedPeople>>, c: string, ca: string, y: string;
let spy: ReturnType<typeof noNetwork>;
const draft = (keyword: string, change: Record<string, unknown> = {}) => ({
  name: "Fixture rule", trigger: "dm", match: { mode: "word", keywords: [keyword] }, response: { text: "Here is the requested link, {{firstName}}" },
  serviceOnly: true, hours: "ignore", ...change,
});
const create = (rule: ReturnType<typeof draft>, connectionId = c) => createAutoDmRule(f.db,p.owner,p.tenant,{ connectionId,rule },deps);
const change = (id: string, body: unknown) => changeAutoDmRule(f.db,p.owner,p.tenant,id,body,deps);
const report = (id: string) => autoDmActivity(f.db,p.owner,p.tenant,id,null,deps);
const run = () => runSocialAutoDm(f.workerPool,{ fake: provider,recipientKey: Buffer.alloc(32,4),limit:20 });
async function enable(rule: ReturnType<typeof draft>, connectionId = c) {
  const { rule: row } = await create(rule, connectionId);
  const review = await change(row.id,{ action:"review",version:1 });
  return (await change(row.id,{ action:"enable",version:1,reviewToken: review.review!.token })).rule;
}
async function inbound(word: string, recipient = randomUUID(), ref = randomUUID(), extra: { id?: string; at?: Date; account?: string } = {}) {
  const id = extra.id ?? randomUUID(), at = extra.at ?? new Date(), activityRef = randomUUID(), accountRef = extra.account ?? "acc-ig-1";
  provider.autoDmEvidence.set(JSON.stringify([accountRef,ref,activityRef]), { trigger:"dm", recipientRef:recipient, at,lastInboundAt:at,
    text:word,firstName:"Synthetic sensitive name",firstInbound:true,entryKey:null,postRef:null,conversationRef:ref,targetRef:activityRef });
  provider.inboxEntries.push({ accountRef,kind:"dm",ref,title:null,preview:null,activityAt:at });
  const payload = event(id,"message.received",{ accountRef, timestamp:at.toISOString(), subjectRef:ref, activityRef,text:"webhook-private-canary" });
  expect((await receiveSocialWebhook(f.db,signedRequest(payload),"fake",deps)).status).toBe(202);
  await drainJobs(f.db,p.owner,p.tenant,"test-worker");
  return payload;
}
beforeAll(async () => {
  f = await testDatabase({ migrationOwner:true }); p=await seedPeople(f,"automation"); useTestKeys(); spy=noNetwork();
  const link = async (accountRef:string) => (await linkConnection(f.db,p.owner,p.tenant,{ provider:"fake",credential:CANARY,accountRef },deps)).connection.id;
  c=await link("acc-ig-1"); ca=await link("acc-fb-2"); y=await link("acc-yt-3");
});
afterAll(async () => { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); useKeyProvider(null); await f?.close(); });

it("checks rule permissions, platform capabilities and review binding", async () => {
  const created = await create(draft("unmatched"));
  expect(created.rule.enabled).toBe(false);
  await expect(create(draft("x"),y)).rejects.toMatchObject({ details:{ code:"AUTO_DM_TRIGGER_UNAVAILABLE" } });
  await expect(create(draft("x",{trigger:"story_reply"}),ca)).rejects.toMatchObject({ details:{ code:"AUTO_DM_TRIGGER_UNAVAILABLE" } });
  const review = await change(created.rule.id,{ action:"review",version:1 });
  await expect(change(created.rule.id,{ action:"enable",version:1,reviewToken:review.review!.token+"x" })).rejects.toMatchObject({ status:409 });
  await expect(changeAutoDmRule(f.db,p.admin,p.tenant,created.rule.id,{ action:"enable",version:1,reviewToken:review.review!.token },deps)).rejects.toMatchObject({ status:409 });
  await expect(listAutoDmRules(f.db,p.viewer,p.tenant,deps)).rejects.toMatchObject({ status:404 });
  await expect(autoDmActivity(f.db,p.outsider,p.other,created.rule.id,null,deps)).rejects.toMatchObject({ status:404 });
  await expect(f.pool.query("select public.social_auto_dm_claim(1)")).rejects.toMatchObject({ code:"42501" });
  await expect(f.workerPool.query("select * from social_auto_dm_rules")).rejects.toMatchObject({ code:"42501" });
  const client=await f.pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[p.tenant,p.member]);
    expect((await client.query("select id from social_auto_dm_rules")).rows).toEqual([]);
  } finally { await client.query("rollback"); client.release(); }
});

it("deduplicates a signed event, pins an ambiguous attempt and reconciles via the fake", async () => {
  const r=await enable(draft("keyword"));
  const delivery=await inbound("Keyword private live canary");
  await receiveSocialWebhook(f.db,signedRequest(delivery),"fake",deps);
  await drainJobs(f.db,p.owner,p.tenant,"test-worker");
  provider.ambiguousNextReply=true;
  expect(await run()).toMatchObject({ unknown:1 });
  const activity=await report(r.id);
  expect(activity.triggered).toBe(1);
  const id=activity.activity[0].id;
  await f.admin.query("update social_auto_dm_jobs set next_at=now() where id=$1",[id]);
  expect(await run()).toMatchObject({ sent:1 });
  const calls=provider.calls.filter(call=>call.key?.endsWith(id));
  expect(calls.map(call=>call.method)).toEqual(["dispatchInboxReply","reconcileInboxReply"]);
  for (const table of ["social_auto_dm_jobs","social_auto_dm_rules","social_webhook_events","audit_logs"]) {
    const { rows }=await f.admin.query(`select * from ${table}`);
    expect(JSON.stringify(rows)).not.toMatch(/private live canary|webhook-private-canary|Synthetic sensitive name/);
  }
});

it("enforces cooldown and rule daily limits across recipients", async () => {
  const r=await enable(draft("quota",{ruleDaily:1}));
  const person=randomUUID();
  await inbound("quota",person); await run();
  await inbound("quota",person); await run();
  await inbound("quota"); await run();
  const {counts}=await report(r.id);
  expect(counts).toEqual(expect.arrayContaining([expect.objectContaining({ state:"sent", count:1 }),
    expect.objectContaining({ reason:"cooldown",count:1 }),expect.objectContaining({ reason:"limit",count:1 })]));
});

it("hands off matching threads without sending and cancels disabled rules", async () => {
  const r=await enable(draft("human",{handoffUserId:p.admin}));
  const ref=randomUUID();
  await inbound("human",randomUUID(),ref);
  expect(await run()).toMatchObject({ handed_off:1 });
  expect((await f.admin.query("select assignee_id from social_inbox_items where provider_ref=$1",[ref])).rows[0]?.assignee_id).toBe(p.admin);
  await inbound("human");
  await change(r.id,{ action:"disable",version:r.version });
  expect((await report(r.id)).counts).toEqual(expect.arrayContaining([expect.objectContaining({ state:"cancelled",count:1 })]));
});

it("uses working hours and an away template and cancels jobs on disconnect", async () => {
  const r=await enable(draft("away",{hours:"away"}),ca);
  await saveInboxHours(f.db,p.owner,p.tenant,ca,{ version:0,timezone:"UTC",hours:[],awayTemplate:"We will answer later" },deps);
  const calls=vi.spyOn(provider,"dispatchInboxReply");
  try {
    await inbound("away",randomUUID(),randomUUID(),{account:"acc-fb-2"});
    await run();
    expect(calls.mock.calls.at(-1)?.[1].text).toBe("We will answer later");
    await inbound("away",randomUUID(),randomUUID(),{account:"acc-fb-2"});
    await setConnectionEnabled(f.db,p.owner,p.tenant,ca,false,deps);
    expect((await report(r.id)).counts).toEqual(expect.arrayContaining([expect.objectContaining({state:"cancelled",count:1})]));
  } finally { calls.mockRestore(); }
});

it("checks at dispatch and refuses promotional replies without explicit consent", async () => {
  const r=await enable(draft("promo",{ purpose:"marketing" }));
  const ref=randomUUID();
  await inbound("promo",randomUUID(),ref);
  await run();
  expect((await report(r.id)).counts).toEqual(expect.arrayContaining([expect.objectContaining({reason:"suppressed",count:1})]));
});

it("cancels a leased promotional send when an existing consent purpose is withdrawn during provider eligibility", async () => {
  const r=await enable(draft("withdraw-race",{purpose:"marketing"}));
  const person=await createContact(f.db,p.owner,p.tenant,{name:"Fixture consent subject"});
  const consent={purpose:"marketing" as const,noticeVersion:"notice-v1" as const,source:"Fixture",evidence:"Fixture explicit decision"};
  await recordConsent(f.db,p.owner,p.tenant,person.id,{...consent,channel:"social",status:"granted"});
  const ref=randomUUID();
  await f.admin.query("insert into social_inbox_items(tenant_id,connection_id,kind,provider_ref,contact_id) values ($1,$2,'dm',$3,$4)",[p.tenant,c,ref,person.id]);
  await inbound("withdraw-race",randomUUID(),ref);
  const original=provider.inboxReplyEligibility.bind(provider), before=provider.sent.length;
  const eligibility=vi.spyOn(provider,"inboxReplyEligibility").mockImplementationOnce(async (...params) => {
    await recordConsent(f.db,p.member,p.tenant,person.id,{...consent,channel:"email",status:"withdrawn"});
    return original(...params);
  });
  try { await run(); } finally { eligibility.mockRestore(); }
  expect(provider.sent).toHaveLength(before);
  expect((await report(r.id)).counts).toEqual(expect.arrayContaining([expect.objectContaining({state:"cancelled",reason:"suppressed",count:1})]));
});

it("refuses the extended human-agent window even when the provider marks a reply eligible", async () => {
  const r=await enable(draft("extended"));
  const ref=randomUUID();
  await inbound("extended",randomUUID(),ref);
  provider.replyEligibility.set(JSON.stringify(["acc-ig-1","dm",ref]),{allowed:true,expiresAt:null,media:true,quote:true,humanAgent:true});
  const before=provider.sent.length;
  await run();
  expect(provider.sent).toHaveLength(before);
  expect((await report(r.id)).counts).toEqual(expect.arrayContaining([expect.objectContaining({state:"skipped",reason:"ineligible",count:1})]));
});

it("sends only to an ephemeral synthetic fixture in test mode", async () => {
  const before = (await f.admin.query("select count(*)::int as n from social_auto_dm_jobs")).rows[0].n;
  const realCalls = provider.sent.length;
  const input = {platform:"instagram",rule:draft("test-send"),sample:"Test-send",testSend:true};
  expect(await previewAutoDmRule(f.db,p.owner,p.tenant,input,deps)).toMatchObject({
    result:"matched",response:"Here is the requested link, Example",testDelivery:{state:"sent_to_fake",id:expect.any(String)},
  });
  expect(await previewAutoDmRule(f.db,p.owner,p.tenant,{...input,sample:"does not match"},deps)).toMatchObject({testDelivery:null});
  await expect(previewAutoDmRule(f.db,p.viewer,p.tenant,input,deps)).rejects.toMatchObject({status:404});
  expect(provider.sent).toHaveLength(realCalls);
  expect((await f.admin.query("select count(*)::int as n from social_auto_dm_jobs")).rows[0].n).toBe(before);
});

it("enforces the per-recipient daily limit after the cooldown has elapsed", async () => {
  const r=await enable(draft("daily-cap",{cooldownMinutes:1,recipientDaily:1,ruleDaily:10}));
  const recipient=randomUUID();
  await inbound("daily-cap",recipient);
  await run();
  const previous=(await report(r.id)).activity[0].id;
  await f.admin.query("update social_auto_dm_jobs set first_attempt_at=now()-interval '2 minutes' where id=$1",[previous]);
  await inbound("daily-cap",recipient);
  await run();
  expect((await report(r.id)).counts).toEqual(expect.arrayContaining([expect.objectContaining({state:"sent",count:1}),
    expect.objectContaining({reason:"limit",count:1})]));
});
