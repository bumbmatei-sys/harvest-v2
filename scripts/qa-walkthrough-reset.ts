import type { PoolClient } from "pg";

const actorPattern = "^(owner|member)-[0-9a-f]{32}@qa[.]harvest[.]invalid$";
const lockedTables = ["audit_logs", "communities", "community_memberships", "community_posts", "community_comments",
  "community_reports", "workspace_members", "workspaces"] as const;

/** An owner-only cleanup inside the seed transaction, after the branch and user preflight. */
export async function resetQaWalkthrough(client: PoolClient) {
  // These tables FORCE RLS. The owner-only policies and audit trigger change are visible
  // only in this transaction; the locks also protect the scope checks from concurrent writes.
  await client.query(`lock table ${lockedTables.map(table => "public." + table).join(", ")} in access exclusive mode`);
  for (const table of lockedTables) {
    await client.query(`create policy qa_reset_read on public.${table} for select to current_user using (true)`);
  }

  const { rows: [scope] } = await client.query<{
    users: string[]; tenants: string[]; communities: string[]; unsafe: boolean;
  }>(`
    with actors as (
      select id, substring(email from '[0-9a-f]{32}(?=@)') as run, split_part(email,'-',1) as actor
      from public.users where email ~ $1
    ), ministries as (
      select w.tenant_id, a.run, a.id as owner_id from public.workspaces w
      join actors a on a.id=w.created_by and a.actor='owner'
      where w.name='QA Ministry ' || left(a.run,8) and w.audience='church'
    ), circles as (
      select c.id, c.tenant_id, m.run from public.communities c join ministries m using(tenant_id)
      where c.created_by=m.owner_id and c.name='QA Circle ' || left(m.run,8) and c.slug='qa-' || m.run
    ), scoped_people as (
      select m.tenant_id,a.id from ministries m join actors a using(run)
    )
    select array(select id from actors) as users,
      array(select tenant_id from ministries) as tenants, array(select id from circles) as communities,
      exists(select from actors a join public.workspaces w on w.created_by=a.id
        where not exists(select from ministries m where m.tenant_id=w.tenant_id))
      or exists(select from public.communities c join ministries m using(tenant_id)
        where not exists(select from circles s where s.id=c.id))
      or exists(select from public.workspace_members w
        where (w.tenant_id in (select tenant_id from ministries) or w.user_id in (select id from actors))
        and not exists(select from scoped_people p where p.tenant_id=w.tenant_id and p.id=w.user_id))
      or exists(select from public.community_memberships c
        where (c.tenant_id in (select tenant_id from ministries) or c.user_id in (select id from actors))
        and not exists(select from scoped_people p where p.tenant_id=c.tenant_id and p.id=c.user_id))
      or exists(select from public.community_posts c
        where (c.tenant_id in (select tenant_id from ministries) or c.author_id in (select id from actors))
        and not exists(select from scoped_people p where p.tenant_id=c.tenant_id and p.id=c.author_id))
      or exists(select from public.community_comments c
        where (c.tenant_id in (select tenant_id from ministries) or c.author_id in (select id from actors))
        and not exists(select from scoped_people p where p.tenant_id=c.tenant_id and p.id=c.author_id))
      or exists(select from public.community_reports c
        where (c.tenant_id in (select tenant_id from ministries) or c.reporter_id in (select id from actors))
        and not exists(select from scoped_people p where p.tenant_id=c.tenant_id and p.id=c.reporter_id))
      or exists(select from public.audit_logs l
        where (l.tenant_id in (select tenant_id from ministries) or l.actor_id in (select id from actors))
        and not (l.tenant_id is null and l.action='auth.sign_in')
        and not exists(select from scoped_people p where p.tenant_id=l.tenant_id and p.id=l.actor_id))
      as unsafe`, [actorPattern]);
  if (scope?.unsafe !== false) throw new Error("QA_SEED_WALKTHROUGH_SCOPE");

  if (scope.users.length) {
    // This append-only ledger has an owner-independent trigger. Suspend that trigger
    // only while deleting exact account logins and checked synthetic tenant records.
    await client.query("alter table public.audit_logs disable trigger audit_append_only");
    await client.query("create policy qa_reset_remove on public.audit_logs for delete to current_user using (true)");
    await client.query(`delete from public.audit_logs where tenant_id=any($1::uuid[])
      or (tenant_id is null and action='auth.sign_in' and actor_id=any($2::text[]))`, [scope.tenants, scope.users]);
    await client.query("drop policy qa_reset_remove on public.audit_logs");
    await client.query("alter table public.audit_logs enable trigger audit_append_only");

    for (const tenant of scope.tenants) {
      await client.query("select set_config('app.community_definer_tenant',$1,true)", [tenant]);
      await client.query("delete from public.entitlements where tenant_id=$1 and resource_type='community' and resource_id=any($2::uuid[]) and user_id=any($3::text[])",
        [tenant, scope.communities, scope.users]);
    }
    for (const [table, column, values] of [
      ["community_memberships", "community_id", scope.communities],
      ["communities", "id", scope.communities],
      ["workspace_members", "tenant_id", scope.tenants],
      ["workspaces", "tenant_id", scope.tenants],
    ] as const) {
      await client.query(`create policy qa_reset_remove on public.${table} for delete to current_user using (true)`);
      await client.query(`delete from public.${table} where ${column}=any($1::uuid[])`, [values]);
      await client.query(`drop policy qa_reset_remove on public.${table}`);
    }
    await client.query("delete from public.users where id=any($1::text[]) and email ~ $2", [scope.users, actorPattern]);
  }
  // A run can stop after reserving a code and before creating its account.
  await client.query("delete from public.otp_cooldowns where email ~ $1", [actorPattern]);
  await client.query("delete from public.verifications where identifier ~ $1", [actorPattern.replace("^", "^sign-in-otp-")]);
  for (const table of lockedTables) {
    await client.query(`drop policy qa_reset_read on public.${table}`);
  }
}
