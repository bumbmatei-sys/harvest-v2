import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
import { CANARY, depsFor, noNetwork, seedPeople, useTestKeys } from "./social-layer-fixture";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { fakePublisherLease } from "../../src/server/social/publisher-lease";
import { runSocialPublisher } from "../../src/server/social/publisher";
import { linkConnection } from "../../src/server/social/service";
import { changeDraft, readDraft, saveDraft } from "../../src/server/social/drafts";
import { useKeyProvider } from "../../src/server/connect-key-provider";

let database: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let connectionId: string;
let outbound: ReturnType<typeof noNetwork>;
const fake = new FakeProvider({ validSecret: CANARY, accounts: [{ platform: "facebook", accountRef: "cf02-fake", displayName: "Fixture" }] });
const deps = depsFor(fake);

beforeAll(async () => {
  database = await testDatabase({ migrationOwner: true });
  people = await seedPeople(database, "cf02pub");
  useTestKeys();
  outbound = noNetwork();
  connectionId = (await linkConnection(database.db, people.owner, people.tenant, {
    provider: "fake", accountRef: "cf02-fake", credential: CANARY,
  }, deps)).connection.id;
});
afterAll(async () => {
  outbound?.mockRestore();
  useKeyProvider(null);
  await database?.close();
});

async function schedule() {
  const { draft } = await saveDraft(database.db, people.owner, people.tenant,
    { type: "post", content: "CF-02 synthetic delivery", connectionIds: [connectionId] }, deps);
  const change = (input: unknown) => changeDraft(database.db, people.owner, people.tenant, draft.id, input, deps);
  const reviewed = await change({ action: "review", version: draft.version });
  await change({ action: "publishNow", version: reviewed.draft.version, reviewToken: reviewed.review!.token, timezone: "UTC" });
  return draft.id;
}

const scopedWorker = () => fakePublisherLease({
  runtime: "workers", role: "worker", WORKER_HYPERDRIVE: { connectionString: database.workerURL },
}, "test");
const claim = (db: ReturnType<typeof scopedWorker>) => db.query<{ claimed: { postId: string; lockToken: string }[] }>(
  "select public.social_publish_claim($1, $2) as claimed", [1, 300]).then((result) => result.rows[0].claimed);

it("recovers a vanished claim across connections, fences the stale writer, and never republishes the unknown post", async () => {
  const draft = await schedule();
  const first = scopedWorker();
  const second = scopedWorker();
  const [abandoned] = await claim(first);
  expect(abandoned).toBeDefined();
  expect(await claim(second)).toEqual([]);
  const admin = await database.admin.connect();
  try {
    // Age the claim in a disposable fixture. The change to the trigger is
    // confined to this transaction and undone before it becomes visible.
    await admin.query("begin");
    await admin.query("alter table social_posts disable trigger social_post_guard");
    await admin.query("update social_posts set locked_at = now() - interval '301 seconds' where id = $1", [abandoned.postId]);
    await admin.query("alter table social_posts enable trigger social_post_guard");
    await admin.query("commit");
  } catch (error) {
    await admin.query("rollback");
    throw error;
  } finally {
    admin.release();
  }

  expect(await claim(second)).toEqual([]);
  const { rows } = await first.query("select public.social_publish_complete($1,$2,$3,'published','late',null,0) as status",
    [people.tenant, abandoned.postId, abandoned.lockToken]);
  expect(rows).toEqual([{ status: "stale" }]);
  const { draft: stored } = await readDraft(database.db, people.owner, people.tenant, draft, deps);
  expect(stored.destinations[0]).toMatchObject({ status: "unknown", retryable: false });

  const sendCount = fake.calls.filter((call) => call.method === "publishPost").length;
  expect(await runSocialPublisher(second, () => fake)).toMatchObject({ claimed: 0 });
  await schedule();
  const runs = await Promise.all([first, second].map((db) => runSocialPublisher(db, () => fake)));
  expect(runs.reduce((count, run) => count + run.published, 0)).toBe(1);
  expect(fake.calls.filter((call) => call.method === "publishPost")).toHaveLength(sendCount + 1);
  expect(outbound).not.toHaveBeenCalled();
});
