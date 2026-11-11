import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { communityLimit, createCommunity, createInvite, getCommunity, listInvites, publishCommunity, revokeInvite, updateCommunity } from "../../src/server/communities";
import { activeMembership, enterCommunity, getPublicCommunity, listDiscover, myCommunities } from "../../src/server/community-joining";

// PR 3 services: Discover projection, public page, open join with rules, personal invitations, my communities.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, study: string, team: string;
const people = ["s-owner", "s-viewer", "s-b-owner", "s-joiner", "s-invited", "s-stranger"];
const token = (path: string) => new URL(path, "http://x").searchParams.get("invite")!;
async function edit(id: string, changes: Record<string, unknown>) {
  const { version } = await getCommunity(f.db, "s-owner", a, id);
  return updateCommunity(f.db, "s-owner", a, id, { version, ...changes });
}
async function publish(id: string, published: boolean) {
  const { version } = await getCommunity(f.db, "s-owner", a, id);
  return publishCommunity(f.db, "s-owner", a, id, { version, published });
}
const slugs = async (query: Record<string, unknown> = {}) => (await listDiscover(f.db, query)).items.map((i) => i.slug);

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "s-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "s-b-owner", "Other Ministry", "creator")).tenantId;
  await putMember(f.db, "s-owner", a, "s-viewer@example.test", "viewer");
  study = (await createCommunity(f.db, "s-owner", a, { name: "Grace study", slug: "grace-study" })).id;
  team = (await createCommunity(f.db, "s-owner", a, { name: "Prayer team", slug: "prayer-team" })).id;
});
afterAll(async () => { await f?.close(); });

it("keeps the Discover listing in step with publishing, visibility and opt-in", async () => {
  await edit(study, { allowOpen: true, visibility: "listed", rulesList: ["Be kind."], description: "Weekly study.", discoverOptIn: true });
  expect(await slugs()).toEqual([]);
  await publish(study, true);
  expect(await slugs()).toEqual(["grace-study"]);
  expect(await slugs({ q: "GRACE church" })).toEqual(["grace-study"]);
  expect(await slugs({ q: "zzz" })).toEqual([]);
  // LIKE wildcards in a search are literal characters, never patterns.
  expect(await slugs({ q: "%" })).toEqual([]);
  expect(await slugs({ q: "_" })).toEqual([]);
  expect(await slugs({ q: "\\" })).toEqual([]);
  expect(await slugs({ open: true })).toEqual(["grace-study"]);
  await publish(study, false);
  expect(await slugs()).toEqual([]);
  await publish(study, true);
  await edit(study, { discoverOptIn: false });
  expect(await slugs()).toEqual([]);
  await edit(study, { discoverOptIn: true, visibility: "unlisted" });
  expect(await slugs()).toEqual([]);
  expect(await getPublicCommunity(f.db, "grace-study")).toMatchObject({ name: "Grace study", description: "Weekly study.", rulesList: ["Be kind."], rulesVersion: 1 });
  await edit(study, { visibility: "listed" });
  expect(await slugs()).toEqual(["grace-study"]);
  expect(await getPublicCommunity(f.db, "../etc")).toBeNull();
});

it("joins with the current rules and asks again when they change", async () => {
  await edit(study, { rulesList: ["Be kind.", "Pray daily."] });
  expect((await getPublicCommunity(f.db, "grace-study"))?.rulesVersion).toBe(2);
  await expect(enterCommunity(f.db, "s-joiner", "grace-study", { rulesVersion: 1, adult: true })).rejects.toMatchObject({ status: 409 });
  await expect(enterCommunity(f.db, "s-joiner", "grace-study", { rulesVersion: 2, adult: false })).rejects.toMatchObject({ status: 409 });
  expect(await enterCommunity(f.db, "s-joiner", "grace-study", { rulesVersion: 2, adult: true })).toEqual({ outcome: "joined" });
  expect(await activeMembership(f.db, "s-joiner", "grace-study")).toMatchObject({ name: "Grace study" });
  expect(await activeMembership(f.db, "s-stranger", "grace-study")).toBeNull();
  // Editing something else keeps the rules version.
  await edit(study, { tagline: "Weekly" });
  expect((await getPublicCommunity(f.db, "grace-study"))?.rulesVersion).toBe(2);
});

it("creates, lists, redeems and revokes personal invitations to a hidden community", async () => {
  await edit(team, { allowInvite: true });
  await publish(team, true);
  expect(await getPublicCommunity(f.db, "prayer-team")).toBeNull();
  const invite = await createInvite(f.db, "s-owner", a, team, { email: "S-Invited@example.test" });
  expect(invite.path).toMatch(/^\/communities\/prayer-team\?invite=[a-f0-9]{64}$/);
  expect(invite.emailHint).toBe("s•••@example.test");
  const stored = (await f.admin.query("select email_hash, token_hash from community_invites where id = $1", [invite.id])).rows[0];
  expect(JSON.stringify(stored)).not.toContain(token(invite.path));
  expect(JSON.stringify(stored)).not.toContain("invited");
  expect(await getPublicCommunity(f.db, "prayer-team", token(invite.path))).toMatchObject({ name: "Prayer team", invited: true });
  expect((await listInvites(f.db, "s-owner", a, team)).map((i) => i.status)).toEqual(["pending"]);
  await expect(enterCommunity(f.db, "s-stranger", "prayer-team", { rulesVersion: 0, adult: true, invite: token(invite.path) })).rejects.toMatchObject({ status: 404 });
  expect((await myCommunities(f.db, "s-invited")).invited.map((i) => i.slug)).toEqual(["prayer-team"]);
  expect(await enterCommunity(f.db, "s-invited", "prayer-team", { rulesVersion: 0, adult: true, invite: token(invite.path) })).toEqual({ outcome: "joined" });
  expect((await listInvites(f.db, "s-owner", a, team)).map((i) => i.status)).toEqual(["redeemed"]);
  await expect(enterCommunity(f.db, "s-invited", "prayer-team", { rulesVersion: 0, adult: true, invite: token(invite.path) })).rejects.toMatchObject({ status: 404 });

  const second = await createInvite(f.db, "s-owner", a, team, { email: "s-stranger@example.test" });
  const replaced = await createInvite(f.db, "s-owner", a, team, { email: "s-stranger@example.test" });
  expect((await listInvites(f.db, "s-owner", a, team)).map((i) => i.status)).toEqual(["pending", "revoked", "redeemed"]);
  await expect(enterCommunity(f.db, "s-stranger", "prayer-team", { rulesVersion: 0, adult: true, invite: token(second.path) })).rejects.toMatchObject({ status: 404 });
  await revokeInvite(f.db, "s-owner", a, team, replaced.id, {});
  await expect(revokeInvite(f.db, "s-owner", a, team, replaced.id, {})).rejects.toMatchObject({ status: 404 });
  await expect(enterCommunity(f.db, "s-stranger", "prayer-team", { rulesVersion: 0, adult: true, inviteId: replaced.id })).rejects.toMatchObject({ status: 404 });
  expect((await myCommunities(f.db, "s-stranger")).invited).toEqual([]);
});

it("gives the same answer to a fake invitation whether or not a hidden community exists", async () => {
  const fake = "a".repeat(64);
  const answer = (slug: string) => enterCommunity(f.db, "s-stranger", slug, { rulesVersion: 0, adult: true, invite: fake }).catch((error) => [error.status, error.message]);
  expect(await answer("prayer-team")).toEqual(await answer("no-such-community"));
  expect(await answer("prayer-team")).toEqual([404, "This invitation isn't valid for your account."]);
});

it("limits invitations to the community's managers", async () => {
  await expect(createInvite(f.db, "s-viewer", a, team, { email: "x@example.test" })).rejects.toMatchObject({ status: 403 });
  await expect(listInvites(f.db, "s-viewer", a, team)).rejects.toMatchObject({ status: 403 });
  await expect(listInvites(f.db, "s-b-owner", a, team)).rejects.toMatchObject({ status: 403 });
  await expect(listInvites(f.db, "s-b-owner", b, team)).rejects.toMatchObject({ status: 404 });
});

it("lists joined, invited and hosted communities for the right people", async () => {
  expect((await myCommunities(f.db, "s-joiner")).joined).toEqual([{ slug: "grace-study", name: "Grace study", role: "member" }]);
  const owner = await myCommunities(f.db, "s-owner");
  expect(owner.hosted.map((h) => h.name).sort()).toEqual(["Grace study", "Prayer team"]);
  expect((await myCommunities(f.db, "s-viewer")).hosted).toEqual([]);
});

it("caps communities per ministry", async () => {
  const { rows: [{ n }] } = await f.admin.query("select count(*)::int as n from communities where tenant_id = $1", [b]);
  for (let i = n; i < communityLimit; i++) await f.admin.query("insert into communities (tenant_id, slug, name) values ($1, $2, 'Filler')", [b, `filler-${i}`]);
  await expect(createCommunity(f.db, "s-b-owner", b, { name: "One too many", slug: "one-too-many" })).rejects.toMatchObject({ status: 409 });
});
