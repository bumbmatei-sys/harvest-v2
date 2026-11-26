import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { testDatabase } from "../database";
import { qaSeedTarget } from "../../src/server/qa-preview-gate";
import { createTestKeyProvider, useKeyProvider } from "../../src/server/connect-key-provider";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { socialPlatforms } from "../../src/lib/social/platforms";
import { listContacts } from "../../src/server/contacts";
import { withTenant } from "../../src/server/tenancy";
import { QA_SOCIAL_CREDENTIAL, qaPeople, seedQaPreview } from "../../scripts/qa-preview-seed-data";

let f: Awaited<ReturnType<typeof testDatabase>>;
const fake = new FakeProvider({ validSecret: QA_SOCIAL_CREDENTIAL, accounts: socialPlatforms.map((platform) => ({ platform, accountRef: `test-${platform}`, displayName: `Test ${platform}` })) });
const social = { enabled: true, provider: () => fake, now: () => new Date() };
const count = async (table: string) => (await f.admin.query(`select count(*)::int as n from ${table}`)).rows[0].n as number;

beforeAll(async () => {
  vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected_network"));
  useKeyProvider(createTestKeyProvider({ keys: () => ({ "test-1": "45".repeat(32) }), current: "test-1" }));
  f = await testDatabase({ migrationOwner: true });
}, 120_000);
afterAll(async () => { useKeyProvider(null); vi.restoreAllMocks(); vi.unstubAllEnvs(); await f?.close(); });

it("accepts the embedded test database only as a test target", () => {
  expect(qaSeedTarget({ HARVEST_ENV: "test", DATABASE_URL: f.appURL }).stage).toBe("test");
  expect(() => qaSeedTarget({ HARVEST_ENV: "production", DATABASE_URL: f.appURL })).toThrow("QA_SEED_ENV_REFUSED");
  expect(() => qaSeedTarget({ HARVEST_ENV: "staging", DATABASE_URL: f.appURL })).toThrow("QA_SEED_TARGET_REFUSED");
});

it("seeds every area through the services, twice with the same result, with audits and no network", async () => {
  const first = await seedQaPreview(f.db, { social });
  expect(first).toEqual({
    ministries: 3, people: 12, contacts: 18, communities: 2, members: 10, posts: 8, comments: 16, chatMessages: 12, campaigns: 2, tasks: 8, milestones: 2,
    events: 2, fundraisers: 2, pledges: 6, gifts: 4, newsletterLists: 3, subscribers: 12, socialConnections: 1, socialDrafts: 2, social: "seeded",
  });
  const audits = await count("audit_logs");
  expect(await seedQaPreview(f.db, { social })).toEqual(first);
  // A rerun writes nothing new, not even an audit row.
  expect(await count("audit_logs")).toBe(audits);
  expect(await count("users")).toBe(12);
  expect(await count("community_dm_messages")).toBe(2);
  expect((await f.admin.query("select count(*)::int as n from users where email !~ '^[0-9a-f-]{36}@example[.]invalid$'")).rows[0].n).toBe(0);
  expect((await f.admin.query("select count(*)::int as n from contacts where name !~ '^QA Contact '")).rows[0].n).toBe(0);
  expect(JSON.stringify((await f.admin.query("select * from contacts")).rows)).not.toMatch(/@(?!example[.]invalid)[a-z0-9.-]+[.][a-z]{2,}/i);
  // Real flows leave their audit trail: ministries, members, contacts, consent, posts, campaigns, gifts.
  const actions = (await f.admin.query("select distinct action from audit_logs")).rows.map((row) => row.action as string);
  expect(actions).toEqual(expect.arrayContaining(["workspace.create", "member.add", "campaign.draft.create", "campaign.task.create"]));
  expect(fetch).not.toHaveBeenCalled();
  // Without social deps the social step is skipped and reported so.
  expect((await seedQaPreview(f.db)).social).toBe("skipped");
}, 180_000);

it("keeps each fake ministry isolated by row-level security", async () => {
  const { rows } = await f.admin.query("select tenant_id, created_by, name from workspaces order by name");
  expect(rows.map((row) => row.name)).toEqual(["QA Preview Church", "QA Preview Evangelist", "QA Preview Nonprofit"]);
  const [church, evangelist] = rows;
  // The evangelist's owner is not a member of the church: the service refuses and direct SQL in their own tenant sees nothing of the church.
  await expect(listContacts(f.db, evangelist.created_by, church.tenant_id)).rejects.toMatchObject({ status: 403 });
  const leaked = await withTenant(f.db, evangelist.created_by, evangelist.tenant_id, "contacts:read", (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from public.contacts where tenant_id = ${church.tenant_id}::uuid`));
  expect(leaked.rows[0].n).toBe(0);
  const own = await withTenant(f.db, evangelist.created_by, evangelist.tenant_id, "contacts:read", (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from public.contacts`));
  expect(own.rows[0].n).toBe(6);
  // The church viewer reads but cannot write campaigns.
  const viewer = qaPeople[3].id;
  await expect(withTenant(f.db, viewer, church.tenant_id, "campaigns:write", async () => 1)).rejects.toMatchObject({ status: 403 });
});

it("refuses an owner or superuser connection and a database holding a real-looking account", async () => {
  await expect(seedQaPreview(drizzle(f.admin, { schema }))).rejects.toThrow("QA_SEED_ROLE_REFUSED");
  await f.admin.query("insert into users(id,name,email) values ('real-looking','Not synthetic','someone@gmail.com')");
  await expect(seedQaPreview(f.db)).rejects.toThrow("QA_SEED_NON_SYNTHETIC_USERS");
  await f.admin.query("delete from users where id='real-looking'");
});

it("runs as the npm command against the test database and prints only counts", async () => {
  const run = (env: Record<string, string>) => promisify(execFile)("npx", ["tsx", "--import", "./scripts/server-only-node.mjs", "scripts/qa-preview-seed.ts"], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } as unknown as NodeJS.ProcessEnv, timeout: 120_000 });
  const { stdout } = await run({ HARVEST_ENV: "test", DATABASE_URL: f.appURL, HARVEST_CONNECT_TEST_KEY: "45".repeat(32) });
  expect(JSON.parse(stdout)).toMatchObject({ ministries: 3, people: 12, contacts: 18, posts: 8, chatMessages: 12, campaigns: 2, social: "seeded", socialDrafts: 2 });
  expect(stdout).not.toContain("example.invalid");
  await expect(run({ HARVEST_ENV: "production", DATABASE_URL: f.appURL })).rejects.toMatchObject({ stderr: "QA_SEED_ENV_REFUSED\n" });
}, 180_000);
