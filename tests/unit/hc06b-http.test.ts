import { afterEach,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("../../src/server/auth-instance",()=>({getAuth:()=>({api:{getSession:async()=>null}})}));
import { subjectRightsHttp as POST } from "../../src/server/connect-subject-http";
afterEach(()=>vi.unstubAllEnvs());
it("keeps authenticated response rights hard-disabled in production before database/auth access",async()=>{
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");vi.stubEnv("DATABASE_URL","");
 const response=await POST(new Request("https://example.test/api/connect/rights",{method:"POST"}));
 expect(response.status).toBe(404);expect(response.headers.get("cache-control")).toContain("no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});
it("checks same-origin before session lookup and requires a session without touching the database",async()=>{
 vi.stubEnv("NODE_ENV","test");vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");vi.stubEnv("HARVEST_CONNECT_TEST_KEY","a".repeat(64));vi.stubEnv("DATABASE_URL","postgres://harvest_app:test@127.0.0.1/harvest_test_hc06b_unit");vi.stubEnv("BETTER_AUTH_URL","http://127.0.0.1:3100");
 const request=(origin:string)=>new Request("http://127.0.0.1:3100/api/connect/rights",{method:"POST",headers:{origin}});
 expect((await POST(request("https://foreign.example.test"))).status).toBe(403);
 expect((await POST(request("http://127.0.0.1:3100"))).status).toBe(401);
});
