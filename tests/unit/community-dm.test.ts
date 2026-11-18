import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import * as route0 from "../../src/app/api/communities/[slug]/chat/dms/[conversationId]/block/route";
import * as route1 from "../../src/app/api/communities/[slug]/chat/dms/[conversationId]/hide/route";
import * as route2 from "../../src/app/api/communities/[slug]/chat/dms/[conversationId]/messages/route";
import * as route3 from "../../src/app/api/communities/[slug]/chat/dms/[conversationId]/mute/route";
import * as route4 from "../../src/app/api/communities/[slug]/chat/dms/[conversationId]/read/route";
import * as route5 from "../../src/app/api/communities/[slug]/chat/dms/[conversationId]/report/route";
import * as route6 from "../../src/app/api/communities/[slug]/chat/dms/[conversationId]/unblock/route";
import * as route7 from "../../src/app/api/communities/[slug]/chat/dms/blocks/route";
import * as route8 from "../../src/app/api/communities/[slug]/chat/dms/messages/[messageId]/restore/route";
import * as route9 from "../../src/app/api/communities/[slug]/chat/dms/messages/[messageId]/route";
import * as route10 from "../../src/app/api/communities/[slug]/chat/dms/people/route";
import * as route11 from "../../src/app/api/communities/[slug]/chat/dms/preferences/route";
import * as route12 from "../../src/app/api/communities/[slug]/chat/dms/reports/[reportId]/decide/route";
import * as route13 from "../../src/app/api/communities/[slug]/chat/dms/reports/[reportId]/evidence/route";
import * as route14 from "../../src/app/api/communities/[slug]/chat/dms/reports/route";
import * as route15 from "../../src/app/api/communities/[slug]/chat/dms/route";

const routes = [route0, route1, route2, route3, route4, route5, route6, route7, route8, route9, route10, route11, route12, route13, route14, route15];
describe("private message HTTP gate", () => {
  for (const [index, route] of routes.entries()) {
    for (const [method, handler] of Object.entries(route)) {
      it(`returns 404 before every ${method} handler on route ${index} in production`, async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
        try {
          const run = handler as (request: Request, context: { params: Promise<never> }) => Promise<Response>;
          const response = await run(new Request("https://harvest.test/api/communities/chat/dms", {
            method, headers: { "x-vercel-env": "preview" },
          }), { params: new Promise<never>(() => {}) });
          expect(response.status).toBe(404);
        } finally { vi.unstubAllEnvs(); }
      });
    }
  }
});
