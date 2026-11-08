import { afterEach,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { intakeSetup } from "../../src/lib/connect-intake";
import { openIntake,sealIntake,invitationRecipientHash } from "../../src/server/connect-intake-crypto";
import { safeSourcePath,invitationClaim,invitationPrepare } from "../../src/server/connect-invitations";
import { sendRealInvitation } from "../../src/server/connect-invitation-email";
afterEach(()=>vi.unstubAllEnvs());
it("keeps legacy forms unchanged and requires v2 for independent account invitations",()=>{
 const input={name:"Test",notice:"Test notice",retentionDays:1,purposes:["account_communications"],definition:{kind:"connect-intake-v1",syntheticOnly:true,preferredName:false,followUpChannel:"email"}};
 expect(intakeSetup.safeParse(input).success).toBe(false);
 expect(intakeSetup.safeParse({...input,definition:{...input.definition,kind:"connect-intake-v2"}}).success).toBe(true);
 for(const purposes of [["newsletter"],["outreach_follow_up"],["outreach_follow_up","newsletter"]])expect(intakeSetup.safeParse({...input,purposes}).success).toBe(true);
 expect(invitationClaim.safeParse({action:"confirm",userId:"forged"}).success).toBe(false);
 expect(invitationPrepare.safeParse({token:"abc"}).success).toBe(false);
});
it("opens only authenticated correctly bound ciphertext and uses a separate keyed recipient digest",()=>{
 vi.stubEnv("HARVEST_CONNECT_TEST_KEY","c".repeat(64));const value={email:"test@example.test",token:"a".repeat(64)},sealed=sealIntake(value,"expected");
 expect(openIntake(sealed,"expected")).toEqual(value);expect(()=>openIntake(sealed,"other")).toThrow();
 expect(()=>openIntake({...sealed,ciphertext:Buffer.from("corrupt").toString("base64")},"expected")).toThrow();
 expect(invitationRecipientHash("TEST@example.test","binding")).toBe(invitationRecipientHash("test@example.test","binding"));
 expect(invitationRecipientHash(value.email,"binding")).not.toBe(invitationRecipientHash(value.email,"different"));
 expect(invitationRecipientHash(value.email,"binding")).toMatch(/^[a-f0-9]{64}$/);
});
it("allows only an exact internal QR return path",()=>{
 const valid=`/c/${"a".repeat(32)}`;expect(safeSourcePath(valid)).toBe(valid);
 for(const input of [undefined,[valid],"https://example.test","//example.test","/workspaces","/c/../../sign-in",`${valid}?token=secret`])expect(safeSourcePath(input)).toBe("/resources/start");
});
it("keeps the real email adapter unconditionally disabled before reading provider credentials",async()=>{
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");vi.stubEnv("RESEND_API_KEY","");
 await expect(sendRealInvitation({to:"test@example.test",token:"a".repeat(64),idempotencyKey:"test"})).rejects.toThrow("CONNECT_DELIVERY_DISABLED");
});
