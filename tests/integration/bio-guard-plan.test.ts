import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import { getBioPage } from "../../src/server/link-in-bio";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let fetchSpy: ReturnType<typeof noNetwork>;
let generic: Pool;

// Regression for 0107: with a cached generic plan, the 0094 bio_guard_photo trigger kept bio_files (no harvest_app grant) in its plan even when
// every photo id was null, so the first read of a ministry's page failed with "permission denied for table bio_files". A pooled connection gets
// there after a few inserts; force_generic_plan reproduces it on the first one.
beforeAll(async () => {
  fetchSpy = noNetwork();
  fixture = await testDatabase({ migrationOwner: true });
  generic = new Pool({ connectionString: fixture.appURL, max: 1, options: "-c plan_cache_mode=force_generic_plan" });
  vi.stubEnv("HARVEST_LINK_IN_BIO_MESSAGES", "synthetic");
}, 180_000);
afterAll(async () => { vi.unstubAllEnvs(); fetchSpy?.mockRestore(); await generic?.end(); await fixture?.close(); });

describe("bio_guard_photo under a generic plan", () => {
  it("creates a ministry's page on its first read, and keeps doing so on one connection", async () => {
    const db = drizzle(generic, { schema }) as unknown as Parameters<typeof getBioPage>[0];
    for (const prefix of ["gp1", "gp2", "gp3", "gp4", "gp5", "gp6", "gp7"]) {
      const people = await seedPeople(fixture, prefix);
      const page = await getBioPage(db, people.owner, people.tenant);
      expect(page.status).toBe("draft");
      expect((await getBioPage(db, people.owner, people.tenant)).id).toBe(page.id);
    }
  });
});
