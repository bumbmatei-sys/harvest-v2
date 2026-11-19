import { createHash } from "node:crypto";
import type { Pool } from "pg";

const prefix = "QA Seed ";
const seededAt = "2026-01-05T12:00:00Z";
const id = (name: string) => {
  const hex = createHash("sha256").update(`harvest-qa-fixtures-v1:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const fixtures = [
  { ministry: "Church", audience: "church", community: "Reading Circle" },
  { ministry: "Nonprofit", audience: "ministry_nonprofit", community: "Volunteer Circle" },
  { ministry: "Evangelist", audience: "evangelist_missionary" },
];
const people = Array.from({ length: 12 }, (_, i) => {
  const number = String(i + 1).padStart(2, "0");
  return { id: id(`person-${number}`), name: `Test Person ${number}`, email: `person-${number}@qa.harvest.invalid` };
});

/** The CLI validates the branch endpoint before creating a pool. This transaction validates its data before DML. */
export async function seedQaData(pool: Pool, reset: boolean) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const role = (await client.query("select current_user as name")).rows[0]?.name;
    if (typeof role !== "string") throw new Error("QA_SEED_OWNER_REQUIRED");
    // Freeze account writes while checking and seeding. Do not persist a fixture on a mixed-data branch.
    await client.query("LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE");
    const pollution = await client.query(`
      select exists(select from public.users where email !~ '^[^@]+@(qa[.]harvest[.]invalid|example[.]test)$') as found`);
    if (pollution.rows[0]?.found !== false) throw new Error("QA_SEED_NON_SYNTHETIC_USERS");
    for (const person of people) {
      await client.query(`
        insert into public.users (id, name, email, email_verified, created_at, updated_at)
        values ($1, $2, $3, true, $4, $4) on conflict (id) do nothing`, [person.id, person.name, person.email, seededAt]);
      const found = await client.query("select 1 from public.users where id = $1 and email = $2", [person.id, person.email]);
      if (!found.rowCount) throw new Error("QA_SEED_IDENTITY_COLLISION");
    }

    for (const [index, fixture] of fixtures.entries()) {
      const tenant = id(`ministry-${index}`);
      const owner = people[index * 4].id;
      const applicant = people[index * 4 + 1].id;
      const reader = people[index * 4 + 2].id;
      const community = id(`community-${index}`);
      const category = id(`category-${index}`);
      await client.query("SET LOCAL ROLE harvest_app");
      await client.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [tenant, owner]);
      await client.query(`
        insert into public.workspaces (tenant_id,name,audience,created_by,created_at) values ($1,$2,$3,$4,$5)
        on conflict (tenant_id) do nothing`, [tenant, prefix + fixture.ministry, fixture.audience, owner, seededAt]);
      const scope = await client.query("select 1 from public.workspaces where tenant_id = $1 and name like $2 and created_by = $3",
        [tenant, `${prefix}%`, owner]);
      if (!scope.rowCount) throw new Error("QA_SEED_MINISTRY_COLLISION");
      await client.query(`
        insert into public.workspace_members (tenant_id,user_id,role_id,created_at) values ($1,$2,'owner',$3)
        on conflict (tenant_id,user_id) do nothing`, [tenant, owner, seededAt]);
      if (index === 0) {
        await client.query(`
          insert into public.crm_saved_views (tenant_id,id,object_type,name,state,created_by,created_at,updated_at)
          values ($1,$2,'person','QA Seed Contacts','{}',$3,$4,$4) on conflict (tenant_id,id) do nothing`, [tenant, id("contacts-view"), owner, seededAt]);
        for (let n = 1; n <= 4; n++) {
          await client.query(`
            insert into public.contacts (tenant_id,id,name,created_at,updated_at)
            values ($1,$2,$3,$4,$4) on conflict (tenant_id,id) do nothing`,
          [tenant, id(`contact-${n}`), `Test Contact 0${n}`, seededAt]);
        }
      }
      if (fixture.community) {
        await client.query(`
          insert into public.communities (tenant_id,id,slug,name,status,visibility,allow_apply,created_by,created_at,updated_at)
          values ($1,$2,$3,$4,'published','unlisted',true,$5,$6,$6) on conflict (tenant_id,id) do nothing`,
        [tenant, community, `qa-seed-circle-${index + 1}`, prefix + fixture.community, owner, seededAt]);
        const scope = await client.query("select 1 from public.communities where tenant_id = $1 and id = $2 and slug = $3 and name like $4 and created_by = $5",
          [tenant, community, `qa-seed-circle-${index + 1}`, `${prefix}%`, owner]);
        if (!scope.rowCount) throw new Error("QA_SEED_COMMUNITY_COLLISION");
        await client.query(`
          insert into public.community_memberships (tenant_id,community_id,user_id,role,status,joined_at,adult_confirmed_at,created_at,updated_at)
          values ($1,$2,$3,'owner','active',$6,$6,$6,$6),
                 ($1,$2,$4,'member','pending',null,$6,$6,$6),
                 ($1,$2,$5,'member','active',$6,$6,$6,$6)
          on conflict (tenant_id,community_id,user_id) do nothing`, [tenant, community, owner, applicant, reader, seededAt]);
        await client.query(`
          insert into public.entitlements (tenant_id,id,user_id,resource_type,resource_id,source,valid_from,created_at)
          values ($1,$2,$3,'community',$4,'admin_grant',$5,$5) on conflict (tenant_id,id) do nothing`,
        [tenant, id(`grant-${index}`), reader, community, seededAt]);
      }
      await client.query("select set_config('role', $1, true)", [role]);
      if (!fixture.community) continue;

      // The migration owner is still subject to FORCE RLS. Reuse its tenant-scoped policies.
      await client.query("select set_config('app.community_definer_tenant', $1, true)", [tenant]);
      const application = id(`application-${index}`);
      const report = id(`report-${index}`);
      const postIds = Array.from({ length: 10 }, (_, n) => id(`post-${index}-${n}`));
      const commentIds = Array.from({ length: 10 }, (_, n) => id(`reply-${index}-${n}`));
      if (reset) {
        await client.query(`update public.entitlements set revoked_at=now()
          where tenant_id=$1 and resource_type='community' and resource_id=$2 and user_id=$3
            and source='application' and revoked_at is null`, [tenant, community, applicant]);
        await client.query(`update public.community_memberships set status='pending', joined_at=null,
          rules_version_accepted=null, join_answers=null, updated_at=now()
          where tenant_id=$1 and community_id=$2 and user_id=$3 and role='member' and status='active'`, [tenant, community, applicant]);

        await client.query("delete from public.community_reports where tenant_id=$1 and community_id=$2 and id=$3 and reporter_id=$4", [tenant, community, report, reader]);
        await client.query("delete from public.community_applications where tenant_id=$1 and community_id=$2 and id=$3 and user_id=$4", [tenant, community, application, applicant]);
        await client.query("delete from public.community_comments where tenant_id=$1 and community_id=$2 and id=any($3::uuid[]) and author_id=$4", [tenant, community, commentIds, reader]);
        // Restore seeded posts in place to preserve other comments, evidence, and attachments.
        await client.query(`update public.community_posts set removed_at=null,removed_by=null,edited_at=null,
          pinned=false,comments_off=false,likes_off=false,held_at=case when id=$5 then $6::timestamptz end,
          held_reason=case when id=$5 then 'first_post' end
          where tenant_id=$1 and community_id=$2 and id=any($3::uuid[]) and author_id=$4`,
        [tenant, community, postIds, owner, postIds[0], seededAt]);
      }
      await client.query(`
        insert into public.community_applications (tenant_id,community_id,id,user_id,questions_version,rules_version,adult_confirmed_at,created_at,updated_at)
        values ($1,$2,$3,$4,0,0,$5,$5,$5) on conflict do nothing`, [tenant, community, application, applicant, seededAt]);
      await client.query(`
        insert into public.community_categories (tenant_id,community_id,id,name,position,created_at)
        values ($1,$2,$3,'QA Discussion',1,$4) on conflict (id) do nothing`, [tenant, community, category, seededAt]);
      for (let n = 0; n < postIds.length; n++) {
        const body = "This fictional fixture is for testing only.";
        const document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] };
        const title = `Test discussion ${n + 1}`;
        await client.query(`
          insert into public.community_posts (tenant_id,community_id,category_id,id,author_id,title,body,body_text,held_at,held_reason,created_at,updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) on conflict (id) do nothing`,
        [tenant, community, category, postIds[n], owner, title, document, body, n === 0 ? seededAt : null, n === 0 ? "first_post" : null, seededAt]);
        if (reset) {
          await client.query(`update public.community_posts set title=$5,body=$6,body_text=$7,updated_at=$8
            where tenant_id=$1 and community_id=$2 and id=$3 and author_id=$4`, [tenant, community, postIds[n], owner, title, document, body, seededAt]);
        }
        await client.query(`
          insert into public.community_comments (tenant_id,community_id,post_id,id,author_id,body,created_at,updated_at)
          values ($1,$2,$3,$4,$5,'Synthetic reply for QA.',$6,$6) on conflict (id) do nothing`,
        [tenant, community, postIds[n], commentIds[n], reader, seededAt]);
      }
      await client.query(`
        insert into public.community_reports (tenant_id,community_id,id,reporter_id,target_type,target_id,reason,note,created_at)
        values ($1,$2,$3,$4,'post',$5,'other','Synthetic report for QA.',$6) on conflict do nothing`,
      [tenant, community, report, reader, postIds[1], seededAt]);
    }
    await client.query("COMMIT");
    return { ministries: 3, users: 12, communities: 2, posts: 20, replies: 20, applications: 2, reports: 2, heldPosts: 2, contacts: 4, contactViews: 1 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
