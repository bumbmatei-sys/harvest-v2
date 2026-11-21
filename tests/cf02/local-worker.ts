import { POST as auth } from "../../src/app/api/auth/[...all]/route";
import { GET as workspaces } from "../../src/app/api/workspaces/route";
import { withWorkerRequest } from "../../src/server/auth-instance";
import probe from "./worker";

const worker = {
  async fetch(request: Request, env: Parameters<typeof probe.fetch>[1]) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/workspaces") {
      return withWorkerRequest({
        APP_HYPERDRIVE: env.APP_HYPERDRIVE,
        BETTER_AUTH_URL: "http://localhost",
        BETTER_AUTH_SECRET: env.CF02_AUTH_SECRET,
      }, request, () => url.pathname === "/api/workspaces" ? workspaces(request) : auth(request));
    }
    return probe.fetch(request, env);
  },
};

export default worker;
