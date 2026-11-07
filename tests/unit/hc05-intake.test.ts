import { createDecipheriv,hkdfSync } from "node:crypto";
import { afterEach,expect,it,vi } from "vitest";
import { intakeSetup,intakeSubmission,intakeRights } from "../../src/lib/connect-intake";
import { syntheticIntakeEnabled } from "../../src/server/connect-intake-mode";
import { sealIntake,intakeFingerprint,receiptHash,issueIntakeCapability,verifyIntakeCapability } from "../../src/server/connect-intake-crypto";
afterEach(()=>vi.unstubAllEnvs());
it("cannot activate on production, remote databases, missing keys or a flag alone",()=>{
 const env={NODE_ENV:"test",HARVEST_CONNECT_INTAKE:"synthetic",DATABASE_URL:"postgresql://harvest_app:test@127.0.0.1/harvest_test_local",HARVEST_CONNECT_TEST_KEY:"a".repeat(64)};
 expect(syntheticIntakeEnabled(env)).toBe(true);
 for(const change of [{NODE_ENV:"production"},{DATABASE_URL:"postgresql://harvest_app:test@db.example/harvest_test_local"},{DATABASE_URL:"postgresql://harvest_app:test@127.0.0.1/real_data"},{HARVEST_CONNECT_INTAKE:"enabled"},{HARVEST_CONNECT_TEST_KEY:undefined}])expect(syntheticIntakeEnabled({...env,...change})).toBe(false);
});
it("authenticates encrypted payload and its source/submission/receipt binding without plaintext search keys",()=>{
 vi.stubEnv("HARVEST_CONNECT_TEST_KEY","a".repeat(64));const data={email:"synthetic@example.test",preferredName:"Sample"};
 const sealed=sealIntake(data,"source:submission:receipt");
 const key=Buffer.from(hkdfSync("sha256",Buffer.from("a".repeat(64),"hex"),"Harvest Connect","pending-intake:v1",32));
 function open(binding:string){const cipher=createDecipheriv("aes-256-gcm",key,Buffer.from(sealed.iv,"base64"));cipher.setAAD(Buffer.from(binding));cipher.setAuthTag(Buffer.from(sealed.tag,"base64"));return Buffer.concat([cipher.update(Buffer.from(sealed.ciphertext,"base64")),cipher.final()]).toString();}
 expect(JSON.parse(open("source:submission:receipt"))).toEqual(data);expect(()=>open("wrong-source")).toThrow();
 expect(sealIntake(data,"source:submission:receipt").ciphertext).not.toBe(sealed.ciphertext);
 expect(JSON.stringify(sealed)).not.toContain(data.email);expect(intakeFingerprint(data)).toMatch(/^[a-f0-9]{64}$/);expect(receiptHash("b".repeat(64))).toHaveLength(64);
});
it("restricts admin field definitions, purposes and required explicit test retention",()=>{
 const setup={name:"Test",notice:"Test copy",retentionDays:1,definition:{kind:"connect-intake-v1",syntheticOnly:true,preferredName:false,followUpChannel:"email"},purposes:["outreach_follow_up","newsletter"]};
 expect(intakeSetup.safeParse(setup).success).toBe(true);
 for(const change of [{purposes:["account_communications"]},{purposes:[]},{purposes:["newsletter","newsletter"]},{retentionDays:undefined},{retentionDays:0},{definition:{...setup.definition,prayerNotes:true}},{definition:{...setup.definition,syntheticOnly:false}}])expect(intakeSetup.safeParse({...setup,...change}).success).toBe(false);
 expect(intakeSubmission.safeParse({tenantId:"forged"}).success).toBe(false);
 expect(intakeRights.safeParse({receiptToken:"a".repeat(64),action:"withdraw"}).success).toBe(false);
 expect(intakeRights.safeParse({receiptToken:"a".repeat(64),action:"erase"}).success).toBe(true);
});

it("expires source-bound submission capabilities after ten minutes and refuses tampering",()=>{
 vi.stubEnv("HARVEST_CONNECT_TEST_KEY","a".repeat(64));const now=1794090000000;
 const ticket=issueIntakeCapability("qr","source","version",now);
 expect(verifyIntakeCapability(ticket,"qr","source","version",now+1)).toBeTruthy();
 expect(verifyIntakeCapability(ticket,"short","source","version",now+1)).toBeNull();
 expect(verifyIntakeCapability(ticket,"qr","other","version",now+1)).toBeNull();
 expect(verifyIntakeCapability(ticket,"qr","source","other",now+1)).toBeNull();
 expect(verifyIntakeCapability(ticket,"qr","source","version",now+600000)).toBeNull();
 expect(verifyIntakeCapability(ticket,"qr","source","version",now-1)).toBeNull();
});
