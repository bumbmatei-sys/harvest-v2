import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity, joinedCommunities } from "../../src/server/community-joining";
import { shellSettings } from "../../src/server/shell-settings";

// Settings pop-up data: only the person's own active memberships in published communities (member path, RLS), and the social test credential only for staff.
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string;
const people = ["ss-owner", "ss-member", "ss-other"];
async function community(name: string, slug: string, published: boolean) {
  const { id } = await createCommunity(f.db, "ss-owner", tenant, { name, slug });
  const { version } = await getCommunity(f.db, "ss-owner", tenant, id);
  const edited = await updateCommunity(f.db, "ss-owner", tenant, id, { version, allowOpen: true, visibility: "listed", rulesList: ["Be kind."] });
  await publishCommunity(f.db, "ss-owner", tenant, id, { version: edited.version, published: true });
  if (!published) { const again = await getCommunity(f.db, "ss-owner", tenant, id); await publishCommunity(f.db, "ss-owner", tenant, id, { version: again.version, published: false }); }
}
beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, "ss-owner", "Grace Church", "church")).tenantId;
  await community("Bible Study", "bible-study", true);
  await community("Prayer Team", "prayer-team", true);
  await community("Draft Group", "draft-group", false);
  await enterCommunity(f.db, "ss-member", "bible-study", { rulesVersion: 1, adult: true });
  await enterCommunity(f.db, "ss-other", "prayer-team", { rulesVersion: 1, adult: true });
});
afterAll(async () => { await f?.close(); });

it("lists only the person's own active memberships in published communities", async () => {
  expect(await joinedCommunities(f.db, "ss-member")).toEqual([{ slug: "bible-study", name: "Bible Study" }]);
  expect(await joinedCommunities(f.db, "ss-other")).toEqual([{ slug: "prayer-team", name: "Prayer Team" }]);
  // The host is an active member of the communities it created; the unpublished one is not listed.
  expect((await joinedCommunities(f.db, "ss-owner")).map((item) => item.slug)).toEqual(["bible-study", "prayer-team"]);
});

it("hands the social test credential to staff only", async () => {
  expect((await shellSettings(f.db, "ss-member")).socialTestCredential).toBeUndefined();
  expect((await shellSettings(f.db, "ss-member", { socialStaff: false })).socialTestCredential).toBeUndefined();
  expect((await shellSettings(f.db, "ss-owner", { socialStaff: true })).socialTestCredential).toBe("harvest-test-credential");
  expect((await shellSettings(f.db, "ss-member")).communities).toEqual([{ slug: "bible-study", name: "Bible Study" }]);
});
