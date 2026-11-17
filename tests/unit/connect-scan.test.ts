import { expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { recordSyntheticScan } from "../../src/server/connect-scan";
import type { Database } from "../../src/db/client";
it("production capture remains disabled even when synthetic is requested",async()=>{
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");const transaction=vi.fn();try{await recordSyntheticScan({transaction} as unknown as Database,"qr","synthetic-code");expect(transaction).not.toHaveBeenCalled();}finally{vi.unstubAllEnvs();}
});
