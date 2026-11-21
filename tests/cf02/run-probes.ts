import assert from "node:assert/strict";
import type { IsolationFixture } from "./isolation";

const operations = ["concurrent", "crossTenant", "revoked", "rollback", "readAfterWrite", "roles", "timeoutAbort", "authExpiry"] as const;
type Dispatch = (request: Request) => Promise<Response>;

export async function runProbes(dispatch: Dispatch, base: string, token: string, databaseNames: string[], requireReusedIsolate: boolean) {
  const isolates = new Set<string>();
  async function probe<T>(operation: string, fixture?: IsolationFixture) {
    const response = await dispatch(new Request(new URL(`/${operation}`, base), {
      method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(fixture ?? {}),
      signal: AbortSignal.timeout(30_000),
    }));
    assert.equal(response.status, 200, `CF-02 probe ${operation} returned ${response.status}`);
    const output = await response.json() as { result: T; isolateId: string };
    assert.ok(output.isolateId);
    isolates.add(output.isolateId);
    return output.result;
  }
  assert.deepEqual(await probe<string[]>("databases"), databaseNames);
  const fixture = await probe<IsolationFixture>("seed");
  for (const operation of operations) {
    await probe(operation, fixture);
    console.log(`PASS ${operation}`);
  }

  // Separate incoming requests, not merely multiple client objects in one fetch.
  await Promise.all([
    ...Array.from({ length: 4 }, () => probe("crossTenant", fixture)),
    probe("authExpiry", fixture),
  ]);
  if (requireReusedIsolate) assert.equal(isolates.size, 1, "Local run must exercise one reused isolate");
  console.log(`PASS concurrent requests (observed ${isolates.size} isolate(s))`);
}
