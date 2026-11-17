import { describe, it, expect, vi } from "vitest";
import { channelEligible, chatBody, chatRevision, chatTokens, clampRead, chatPurgeAfter, messageInput } from "../../src/lib/chat";
import { communityCan } from "../../src/lib/community-permissions";
import { chatRailEtag, communityChatEnabled, communityChatRoute } from "../../src/server/community-chat";
vi.mock("server-only", () => ({}));
import * as route0 from "../../src/app/api/communities/[slug]/chat/channels/[channelId]/members/route";
import * as route1 from "../../src/app/api/communities/[slug]/chat/channels/[channelId]/messages/route";
import * as route2 from "../../src/app/api/communities/[slug]/chat/channels/[channelId]/mute/route";
import * as route3 from "../../src/app/api/communities/[slug]/chat/channels/[channelId]/read/route";
import * as route4 from "../../src/app/api/communities/[slug]/chat/channels/[channelId]/route";
import * as route5 from "../../src/app/api/communities/[slug]/chat/channels/reorder/route";
import * as route6 from "../../src/app/api/communities/[slug]/chat/channels/route";
import * as route7 from "../../src/app/api/communities/[slug]/chat/messages/[messageId]/moderate/route";
import * as route8 from "../../src/app/api/communities/[slug]/chat/messages/[messageId]/reactions/route";
import * as route9 from "../../src/app/api/communities/[slug]/chat/messages/[messageId]/restore/route";
import * as route10 from "../../src/app/api/communities/[slug]/chat/messages/[messageId]/route";
import * as route11 from "../../src/app/api/communities/[slug]/chat/moderation/held/route";
import * as route12 from "../../src/app/api/communities/[slug]/chat/reports/[reportId]/decide/route";
import * as route13 from "../../src/app/api/communities/[slug]/chat/reports/route";
import * as route14 from "../../src/app/api/communities/[slug]/chat/settings/route";
import * as route16 from "../../src/app/api/communities/[slug]/chat/channels/[channelId]/selection/route";
import * as route15 from "../../src/app/api/communities/[slug]/chat/state/route";

it("validates text, mention bounds and exact bigint cursors", () => {
  for (const body of ["", "   ", "x".repeat(2001), "bad\u0000text"]) expect(chatBody.safeParse(body).success).toBe(false);
  expect(chatBody.parse("Plain <@member>\nhttps://example.test")).toContain("<@member>");
  expect(chatRevision.parse("9007199254740993")).toBe("9007199254740993");
  expect(chatRevision.safeParse("9223372036854775808").success).toBe(false);
  expect(messageInput.safeParse({ client_id: "bad", body: "Hello" }).success).toBe(false);
});
it("resolves only validated mention ids", () => {
  expect(chatTokens("Hi <@yes> <@no>", ["yes"])).toEqual([{ type: "text", text: "Hi " }, { type: "mention", id: "yes", text: "<@yes>" }, { type: "text", text: " " }, { type: "text", text: "<@no>" }]);
});
it("clamps reads and uses 30-day recovery", () => {
  expect(clampRead(999n, 50n, 5n)).toBe(50n); expect(clampRead(3n, 50n, 5n)).toBe(5n);
  expect(chatPurgeAfter(new Date("2026-11-01T12:00:00Z")).toISOString()).toBe("2026-12-01T12:00:00.000Z");
});
it("keeps channel access and capabilities role-aware", () => {
  const input = { active: true, grant: true, role: "member", accessMode: "all", minRole: "contributor", invited: false, archived: false };
  expect(channelEligible(input)).toBe(true); expect(channelEligible({ ...input, accessMode: "invite" })).toBe(false);
  expect(channelEligible({ ...input, accessMode: "role" })).toBe(false); expect(channelEligible({ ...input, active: false, role: "owner" })).toBe(false);
  for (const r of ["owner", "admin", "moderator", "contributor", "member"]) expect(communityCan(r, "chat:read")).toBe(true);
  expect(communityCan("moderator", "chat:moderate")).toBe(true); expect(communityCan("moderator", "chat:restore")).toBe(false);
  expect(communityCan("member", "chat:manage_channels")).toBe(false);
});
it("hashes all readable pairs independently of order and includes the reader's revision", () => {
  const state = { channels: [{ id: "a", latestRev: "5", unread: 0, mentions: 0, mute: "none" }, { id: "b", latestRev: "100", unread: 0, mentions: 0, mute: "none" }], chatStateRev: "0" };
  const tag = chatRailEtag("reader", state);
  expect(chatRailEtag("reader", { ...state, channels: [...state.channels].reverse() })).toBe(tag);
  expect(chatRailEtag("other", state)).not.toBe(tag);
  expect(chatRailEtag("reader", { ...state, chatStateRev: "1" })).not.toBe(tag);
  expect(chatRailEtag("reader", { ...state, channels: [{ ...state.channels[0], latestRev: "6" }, state.channels[1]] })).not.toBe(tag);
});
it("cannot enable chat in production and refuses before route work", async () => {
  expect(communityChatEnabled({ NODE_ENV: "production", HARVEST_COMMUNITIES: "enabled" })).toBe(false);
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  try { const run = vi.fn(); expect((await communityChatRoute(run, { write: true })(new Request("https://harvest.test"), { params: Promise.resolve({}) })).status).toBe(404); expect(run).not.toHaveBeenCalled(); } finally { vi.unstubAllEnvs(); }
});
const routes = [route0, route1, route2, route3, route4, route5, route6, route7, route8, route9, route10, route11, route12, route13, route14, route15, route16];
describe("every new route refuses before authentication in production and with Communities off", () => {
  for (const [index, route] of routes.entries()) for (const [method, handler] of Object.entries(route)) {
    if (typeof handler !== "function") continue;
    it(`${index} ${method}`, async () => {
      try {
        for (const [node, flag] of [["production", "enabled"], ["production", "disabled"]]) {
          vi.stubEnv("NODE_ENV", node); vi.stubEnv("HARVEST_COMMUNITIES", flag);
          const response = await (handler as (r: Request, c: { params: Promise<{ slug: string; channelId: string; messageId: string }> }) => Promise<Response>)(new Request("https://harvest.test/api/communities/club/chat", { method }), { params: Promise.resolve({ slug: "club", channelId: "invalid", messageId: "invalid" }) });
          expect(response.status).toBe(404);
        }
      } finally { vi.unstubAllEnvs(); }
    });
  }
});
