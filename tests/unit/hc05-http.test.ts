import { afterEach,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { intakeBody,handleIntake } from "../../src/server/connect-intake-http";
afterEach(()=>vi.unstubAllEnvs());
const request=(body:BodyInit,contentType="application/json")=>new Request("http://127.0.0.1/api/public/connect/rights",{method:"POST",headers:{"content-type":contentType},body});
it("bounds streamed JSON and rejects malformed UTF-8, syntax and content types",async()=>{
 expect(await intakeBody(request('{"action":"erase"}'))).toEqual({action:"erase"});
 for(const req of [request("x".repeat(32769)),request(new Uint8Array([0xff])),request("{"),request("{}","text/plain")])await expect(intakeBody(req)).rejects.toBeInstanceOf(SyntaxError);
});
it("fails closed before database access with private, non-referring error responses",async()=>{
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");vi.stubEnv("DATABASE_URL","");
 const response=await handleIntake(request("{}"));expect(response.status).toBe(404);
 expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");
 expect(await response.text()).not.toMatch(/DATABASE_URL|postgres|stack/);
});

it("redacts CLI connection setup failures",async()=>{
 const {execFile}=await import("node:child_process"),{promisify}=await import("node:util");
 const result=await promisify(execFile)(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/purge-connect-intake.ts"],{
  env:{...process.env,NODE_ENV:"test",HARVEST_CONNECT_INTAKE:"synthetic",HARVEST_CONNECT_TEST_KEY:"a".repeat(64),DATABASE_URL:"invalid://fixture:do-not-print@"},timeout:10000
 }).then(()=>{throw new Error("Expected refusal");},(e:{code:number;stdout:string;stderr:string})=>e);
 expect(result.code).toBe(1);expect(result.stdout).toBe("");expect(result.stderr.trim()).toBe("connect_purge_failed");
});
