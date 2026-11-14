import { vi } from "vitest";
import { createTestKeyProvider, useKeyProvider } from "../../src/server/connect-key-provider";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { FakeProvider } from "../../src/server/social/fake-provider";
import type { SocialDeps } from "../../src/server/social/registry";
import { signBody } from "../../src/server/social/webhook-signature";
import { webhookSecrets } from "../../src/server/social/webhook-secrets";
import type { testDatabase } from "../database";

export const CANARY = "provider-credential-CANARY-5e71c0";
export type Fixture = Awaited<ReturnType<typeof testDatabase>>;
export const useTestKeys = () => useKeyProvider(createTestKeyProvider({ keys: () => ({ "test-1": "44".repeat(32) }), current: "test-1" }));
export function newFake() {
  return new FakeProvider({ validSecret: CANARY, accounts: [
    { accountRef: "acc-ig-1", platform: "instagram", displayName: "grace_church" }, { accountRef: "acc-fb-2", platform: "facebook", displayName: "grace" }, { accountRef: "acc-yt-3", platform: "youtube", displayName: "grace_tv" }] });
}
export const depsFor = (provider: FakeProvider, now = () => new Date()): SocialDeps => ({ enabled: true, provider: () => provider, now });
export async function seedPeople(f: Fixture, prefix: string) {
  const ids = ["owner", "admin", "member", "viewer", "outsider"].map((r) => `${prefix}-${r}`);
  await f.db.insert(users).values(ids.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  const tenant = (await createWorkspace(f.db, ids[0], `${prefix} ministry`)).tenantId;
  await putMember(f.db, ids[0], tenant, `${ids[1]}@example.test`, "admin");
  await putMember(f.db, ids[0], tenant, `${ids[2]}@example.test`, "member");
  await putMember(f.db, ids[0], tenant, `${ids[3]}@example.test`, "viewer");
  const other = (await createWorkspace(f.db, ids[4], `${prefix} other ministry`)).tenantId;
  return { owner: ids[0], admin: ids[1], member: ids[2], viewer: ids[3], outsider: ids[4], tenant, other };
}
/** A signed delivery for the fake provider's wire format, as a Request. */
export function signedRequest(event: Record<string, unknown>, provider = "fake") {
  const raw = JSON.stringify(event), sig = signBody(raw, webhookSecrets()[0]);
  return new Request(`http://localhost/api/integrations/social/webhook/${provider}`, { method: "POST", headers: { "content-type": "application/json", "x-fake-signature": sig }, body: raw });
}
export const event = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, timestamp: new Date().toISOString(), accountRef: "acc-ig-1", platform: "instagram", ...extra });
export const noNetwork = () => vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("NETWORK_USED_IN_TEST"); });
