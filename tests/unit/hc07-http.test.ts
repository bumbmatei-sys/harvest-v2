import { afterEach,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { invitationHttp } from "../../src/server/connect-invitation-http";
afterEach(()=>vi.unstubAllEnvs());
it("production rejects every invitation action before reading cookies, database or provider credentials",async()=>{
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");vi.stubEnv("DATABASE_URL","");
 for(const action of ["request","prepare","claim","continuation"] as const){
  const r=await invitationHttp(new Request("https://example.test/api/connect/invitations"),action);
  expect(r.status).toBe(404);expect(r.headers.get("cache-control")).toContain("no-store");expect(r.headers.get("referrer-policy")).toBe("no-referrer");
 }
});
it("same-origin checks precede all invitation mutations",async()=>{
 vi.stubEnv("NODE_ENV","test");vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");vi.stubEnv("HARVEST_CONNECT_TEST_KEY","a".repeat(64));vi.stubEnv("DATABASE_URL","postgres://harvest_app:test@127.0.0.1/harvest_test_unit");vi.stubEnv("BETTER_AUTH_URL","http://127.0.0.1:3100");
 for(const action of ["request","prepare","claim"] as const){
  const r=await invitationHttp(new Request("http://127.0.0.1:3100/api/connect/invitations",{method:"POST",headers:{origin:"https://other.example.test"}}),action);expect(r.status).toBe(403);
 }
});
