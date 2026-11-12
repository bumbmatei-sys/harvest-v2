import { afterEach, expect, it, vi } from "vitest";
import { navEntries, resolveNavigation } from "../../src/lib/navigation";

// C04 review on #58 and PR 3: with the production default (no HARVEST_COMMUNITIES) every Communities API returns 404
// before authentication or the database is touched.
vi.mock("server-only", () => ({}));
const touched = vi.fn();
vi.mock("@/db/client", () => ({ getDb: () => { touched("db"); throw new Error("database reached"); } }));
vi.mock("@/server/http", () => ({
  verifiedUser: () => { touched("auth"); throw new Error("auth reached"); },
  verifyOrigin: () => { touched("origin"); },
  errorResponse: () => new Response(null, { status: 500 }),
}));
afterEach(() => { vi.unstubAllEnvs(); touched.mockClear(); });

const ids = { tenantId: "00000000-0000-4000-8000-000000000001", communityId: "00000000-0000-4000-8000-000000000002", inviteId: "00000000-0000-4000-8000-000000000003", applicationId: "00000000-0000-4000-8000-000000000004", postId: "00000000-0000-4000-8000-000000000005", commentId: "00000000-0000-4000-8000-000000000006", fileId: "00000000-0000-4000-8000-000000000007", categoryId: "00000000-0000-4000-8000-000000000008", slug: "grace-study", warningId: "00000000-0000-4000-8000-000000000009" };
const context = { params: Promise.resolve(ids) };
const request = (method: string) => new Request("https://example.test/api", { method, headers: { origin: "https://example.test" }, body: method === "GET" ? undefined : "{}" });

it("returns 404 from every Communities route in production unless activated", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("HARVEST_COMMUNITIES", "");
  const list = await import("../../src/app/api/workspaces/[tenantId]/communities/route");
  const one = await import("../../src/app/api/workspaces/[tenantId]/communities/[communityId]/route");
  const publish = await import("../../src/app/api/workspaces/[tenantId]/communities/[communityId]/publish/route");
  const join = await import("../../src/app/api/communities/[slug]/join/route");
  const discover = await import("../../src/app/api/discover/route");
  const invites = await import("../../src/app/api/workspaces/[tenantId]/communities/[communityId]/invites/route");
  const invite = await import("../../src/app/api/workspaces/[tenantId]/communities/[communityId]/invites/[inviteId]/route");
  const applications = await import("../../src/app/api/workspaces/[tenantId]/communities/[communityId]/applications/route");
  const application = await import("../../src/app/api/workspaces/[tenantId]/communities/[communityId]/applications/[applicationId]/route");
  const mine = await import("../../src/app/api/account/community-applications/[applicationId]/route");
  const forum = "../../src/app/api/communities/[slug]";
  const posts = await import(`${forum}/posts/route`), postOne = await import(`${forum}/posts/[postId]/route`), comments = await import(`${forum}/posts/[postId]/comments/route`);
  const comment = await import(`${forum}/comments/[commentId]/route`), likes = await import(`${forum}/likes/route`), moderation = await import(`${forum}/moderation/route`);
  const files = await import(`${forum}/files/route`), file = await import(`${forum}/files/[fileId]/route`), confirm = await import(`${forum}/files/[fileId]/confirm/route`);
  const categories = await import("../../src/app/api/workspaces/[tenantId]/communities/[communityId]/categories/route");
  const category = await import("../../src/app/api/workspaces/[tenantId]/communities/[communityId]/categories/[categoryId]/route");
  const reports = await import(`${forum}/reports/route`), queue = await import(`${forum}/moderation/reports/route`), decide = await import(`${forum}/moderation/reports/[reportId]/route`);
  const held = await import(`${forum}/moderation/held/route`), members = await import(`${forum}/moderation/members/route`), history = await import(`${forum}/moderation/history/route`);
  const warnings = await import(`${forum}/moderation/warnings/route`), warningAck = await import(`${forum}/warnings/[warningId]/route`);
  const appeals = await import(`${forum}/moderation/appeals/route`), revisions = await import(`${forum}/moderation/revisions/route`), myAppeal = await import("../../src/app/api/account/community-appeals/route");
  const calls = [list.GET(request("GET"), context), list.POST(request("POST"), context), one.GET(request("GET"), context), one.PATCH(request("PATCH"), context), publish.POST(request("POST"), context),
    join.POST(request("POST"), context), discover.GET(request("GET")), invites.GET(request("GET"), context), invites.POST(request("POST"), context), invite.DELETE(request("DELETE"), context),
    applications.GET(request("GET"), context), application.PATCH(request("PATCH"), context), mine.PATCH(request("PATCH"), context),
    posts.POST(request("POST"), context), postOne.PATCH(request("PATCH"), context), postOne.DELETE(request("DELETE"), context), comments.POST(request("POST"), context),
    comment.PATCH(request("PATCH"), context), comment.DELETE(request("DELETE"), context), likes.POST(request("POST"), context), moderation.POST(request("POST"), context),
    files.POST(request("POST"), context), file.GET(request("GET"), context), confirm.POST(request("POST"), context),
    categories.GET(request("GET"), context), categories.POST(request("POST"), context), category.PATCH(request("PATCH"), context), category.DELETE(request("DELETE"), context),
    reports.POST(request("POST"), context), queue.GET(request("GET"), context), decide.POST(request("POST"), context), held.GET(request("GET"), context), held.POST(request("POST"), context),
    members.GET(request("GET"), context), members.POST(request("POST"), context), history.GET(request("GET"), context),
    warnings.POST(request("POST"), context), warningAck.POST(request("POST"), context), appeals.GET(request("GET"), context), appeals.POST(request("POST"), context),
    revisions.GET(request("GET"), context), myAppeal.POST(request("POST"), context)];
  for (const response of await Promise.all(calls)) expect(response.status).toBe(404);
  expect(touched).not.toHaveBeenCalled();
});

it("reaches authentication once activated", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  const list = await import("../../src/app/api/workspaces/[tenantId]/communities/route");
  expect((await list.GET(request("GET"), context)).status).toBe(500);
  expect(touched).toHaveBeenCalledWith("auth");
});

it("shows Communities in the navigation only when the feature is on", () => {
  const ids = (features?: readonly "communities"[]) => resolveNavigation({ tenantId: "00000000-0000-4000-8000-000000000001", role: "owner", pathname: "/", features }).flatMap((group) => group.items.map((item) => item.id));
  expect(navEntries.find((entry) => entry.id === "communities")?.feature).toBe("communities");
  expect(ids()).not.toContain("communities");
  expect(ids(["communities"])).toContain("communities");
});
