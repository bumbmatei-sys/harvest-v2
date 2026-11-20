import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { users } from "../../src/db/schema";
import { memberDirectory } from "../../src/server/community-forum";
import { ownCommunityProfile, readCommunityProfile } from "../../src/server/community-profile-details";
import { createCommunity } from "../../src/server/communities";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

vi.mock("server-only", () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>, ministry: string, club: string;
const clubSlug = "profile-club";
const synthetic = ["owner", "admin", "moderator", "alice", "peer", "viewer", "plain", "other", "cascade"];
const unavailable = { status: 404 };
const fields = { displayName: "Community name", bio: "Voluntary biography", language: "English",
  links: [{ label: "Site", url: "https://example.test/profile" }] };

async function join(tenant: string, community: string, id: string, role = "member") {
  await f.admin.query("insert into community_memberships(tenant_id,community_id,user_id,role,status) values($1,$2,$3,$4,'active')", [tenant, community, id, role]);
  await f.admin.query("insert into entitlements(tenant_id,user_id,resource_type,resource_id,source) values($1,$2,'community',$3,'admin_grant')", [tenant, id, community]);
}
const own = (actor: string, action: "get" | "save" | "withdraw" | "erase", raw?: unknown) =>
  ownCommunityProfile(f.db, actor, clubSlug, action, raw);
const read = (viewer: string, target = "alice", slug = clubSlug) => readCommunityProfile(f.db, viewer, slug, target);

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(synthetic.map(id => ({ id, name: id, email: id + "@example.test" })));
  ministry = (await createWorkspace(f.db, "owner", "Profile ministry", "church")).tenantId;
  const remote = (await createWorkspace(f.db, "other", "Second ministry", "church")).tenantId;
  club = (await createCommunity(f.db, "owner", ministry, { name: "Profiles", slug: clubSlug })).id;
  const other = (await createCommunity(f.db, "other", remote, { name: "Another club", slug: "profile-remote" })).id;
  await f.admin.query("update communities set status='published'");
  await f.admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'viewer','viewer'),($1,'plain','member')", [ministry]);
  for (const [id, role] of [["admin", "admin"], ["moderator", "moderator"], ["alice", "member"], ["peer", "member"], ["cascade", "member"]]) {
    await join(ministry, club, id, role);
  }
  await join(remote, other, "alice");
});
afterAll(async () => { await f?.close(); });
beforeEach(async () => {
  await f.admin.query("delete from community_member_profiles");
  await f.admin.query("update community_memberships set status='active' where community_id=$1 and user_id='alice'", [club]);
});

it("defaults to members, projects only volunteered details and rejects forged or stale settings", async () => {
  expect(await own("alice", "get")).toEqual({ displayName: null, bio: null, language: null, links: [], visibility: "members", version: 0 });
  expect(await read("peer")).toEqual({ member: { userId: "alice", name: "alice", role: "member", joinedAt: null },
    profile: { displayName: null, bio: null, language: null, links: [], visibility: "members" } });
  await expect(own("peer", "save", { version: 0, ...fields, role: "admin" })).rejects.toMatchObject({ name: "ZodError" });
  await expect(own("alice", "save", { version: 0, links: [{ label: "Invalid", url: "https://username@example.test" }] }))
    .rejects.toMatchObject({ name: "ZodError" });
  await expect(own("alice", "save", { version: 0, links: Array(4).fill(fields.links[0]) }))
    .rejects.toMatchObject({ name: "ZodError" });
  await expect(own("viewer", "save", { version: 0, ...fields })).rejects.toMatchObject(unavailable);

  const writes = await Promise.allSettled([own("alice", "save", { version: 0, ...fields }), own("alice", "save", { version: 0, ...fields })]);
  for (const result of writes) {
    if (result.status === "rejected" && !result.reason.status) throw result.reason;
  }
  expect(writes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(writes.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  expect(await read("peer")).toEqual({ member: { userId: "alice", name: fields.displayName, role: "member", joinedAt: null },
    profile: { ...fields, visibility: "members" } });
  const directory = (await memberDirectory(f.db, "peer", clubSlug)).members;
  expect(directory.find(m => m.userId === "alice")).toMatchObject({ name: fields.displayName });
});

it("treats hidden, nonmember and other-tenant targets identically for peers and moderators", async () => {
  await own("alice", "save", { version: 0, ...fields, visibility: "unlisted" });
  expect((await read("peer")).profile).toEqual({ ...fields, visibility: "unlisted" });
  expect((await memberDirectory(f.db, "peer", clubSlug)).members.map(m => m.userId)).not.toContain("alice");
  await own("alice", "withdraw", { version: 1 });
  for (const viewer of ["alice", "owner", "admin"]) expect((await read(viewer)).profile).toEqual({ ...fields, visibility: "private" });
  for (const viewer of ["peer", "moderator", "viewer", "plain"]) {
    const errors = await Promise.allSettled([read(viewer), read(viewer, "missing"), read(viewer, "alice", "profile-remote")]);
    expect(errors).toEqual(Array(3).fill({ status: "rejected", reason: expect.objectContaining({ status: 404, message: "Community not found." }) }));
  }
  for (const viewer of ["viewer", "plain"]) {
    await expect(withTenant(f.db, viewer, ministry, "workspace:read", tx =>
      tx.execute(sql`select * from community_member_profiles`))).rejects.toMatchObject({ cause: { code: "42501" } });
    const scoped = await withTenant(f.db, viewer, ministry, "workspace:read", tx =>
      tx.execute(sql`select public.community_member_profile_read(${clubSlug}, 'alice') as profile`));
    expect(scoped.rows).toEqual([{ profile: null }]);
  }
  expect((await memberDirectory(f.db, "admin", clubSlug)).members.map(m => m.userId)).not.toContain("alice");
});

it("inherits the account deletion cascade and erases voluntarily stored fields after leaving", async () => {
  await own("alice", "save", { version: 0, ...fields, visibility: "private" });
  await f.admin.query("update community_memberships set status='left' where community_id=$1 and user_id='alice'", [club]);
  await expect(read("owner")).rejects.toMatchObject(unavailable);
  expect(await own("alice", "get")).toMatchObject({ ...fields, visibility: "private", version: 1 });
  await expect(own("alice", "save", { version: 1, ...fields })).rejects.toMatchObject(unavailable);
  expect(await own("alice", "erase", { version: 1 })).toEqual({ displayName: null, bio: null, language: null, links: [], visibility: "members", version: 2 });
  expect((await memberDirectory(f.db, "peer", clubSlug)).members.some(m => m.userId === "alice")).toBe(false);
  await f.admin.query("update community_memberships set status='active' where community_id=$1 and user_id='alice'", [club]);
  await expect(read("peer")).resolves.toMatchObject({ member: { name: "alice" }, profile: { bio: null, links: [], visibility: "members" } });
  expect((await memberDirectory(f.db, "peer", clubSlug)).members.find(m => m.userId === "alice")).toMatchObject({ name: "alice" });

  await own("cascade", "save", { version: 0, ...fields });
  await f.admin.query("delete from users where id='cascade'");
  expect((await f.admin.query("select count(*)::int n from community_member_profiles where user_id='cascade'")).rows).toEqual([{ n: 0 }]);
  const audit = await f.admin.query("select actor_id,metadata from audit_logs where action='community.profile_erase'");
  expect(audit.rows).toEqual([{ actor_id: null, metadata: { version: "2" } }]);
});

it("denies direct profile access even to the forced-RLS migration owner without scope", async () => {
  await own("alice", "save", { version: 0, ...fields });
  await f.admin.query(`set role ${f.migrationOwner}`);
  try {
    expect((await f.admin.query("select * from community_member_profiles")).rows).toEqual([]);
  } finally { await f.admin.query("reset role"); }
  await expect(withUser(f.db, "alice", tx => tx.execute(sql`select * from community_member_profiles`)))
    .rejects.toMatchObject({ cause: { code: "42501" } });
});
