import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, community: string;
beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true, beforeChatMigration: async admin => {
    await admin.query("insert into users(id,name,email) values('chat-upgrade','Upgrade','chat-upgrade@example.test')");
    tenant = (await admin.query("insert into workspaces(name,created_by) values('Upgrade ministry','chat-upgrade') returning tenant_id")).rows[0].tenant_id;
    community = (await admin.query("insert into communities(tenant_id,name,slug) values($1,'Existing','chat-upgrade') returning id", [tenant])).rows[0].id;
    await admin.query("insert into community_memberships(tenant_id,community_id,user_id,role,status) values($1,$2,'chat-upgrade','owner','active')", [tenant, community]);
    for (const [kind, target] of [["reply", "comment"], ["thread_reply", "comment"], ["like", "post"], ["application", "application"], ["warning", "warning"], ["held_decision", "post"], ["appeal_decision", "appeal"], ["host_queue", "community"]]) {
      await admin.query("insert into community_notifications(tenant_id,community_id,recipient_id,kind,target_type,target_id) values($1,$2::uuid,'chat-upgrade',$3,$4,($2::uuid)::text)", [tenant, community, kind, target]);
    }
  } });
}, 90000);
afterAll(async () => { await f?.close(); });
it("upgrades existing communities, keeps old notification rows valid and inserts all new checks", async () => {
  expect((await f.admin.query("select chat_enabled,dm_policy from communities where id=$1", [community])).rows).toEqual([{ chat_enabled: true, dm_policy: "channels_only" }]);
  expect((await f.admin.query("select name from community_channels where community_id=$1", [community])).rows).toEqual([{ name: "General" }]);
  expect((await f.admin.query("select count(*)::int n from community_notifications")).rows[0].n).toBe(8);
  for (const [kind, target] of [["chat_mention", "channel"], ["chat_reply", "message"], ["dm", "dm_conversation"]]) {
    await f.admin.query("insert into community_notifications(tenant_id,community_id,recipient_id,kind,target_type,target_id) values($1,$2::uuid,'chat-upgrade',$3,$4,($2::uuid)::text)", [tenant, community, kind, target]);
  }
  expect((await f.admin.query("select dm_accept_members,chat_state_rev::text from community_memberships where community_id=$1", [community])).rows).toEqual([{ dm_accept_members: true, chat_state_rev: "0" }]);
  expect((await f.admin.query("select count(*)::int n from pg_policies where policyname='chat_backfill'")).rows[0].n).toBe(0);
});
