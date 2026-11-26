import { describe, expect, it, vi } from "vitest";
import { sharedScope } from "../../src/lib/shared-scope";

vi.mock("server-only", () => ({}));
const { holdUntilDone } = await import("../../src/worker/app");
const { isBufferedApiRequest } = await import("../../src/worker/buffered-api");

const streamed = (...chunks: string[]) => new Response(new ReadableStream<Uint8Array>({
  start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); },
}), { status: 200, headers: { "x-test": "1" } });

describe("holdUntilDone", () => {
  it("releases once, after the whole body has been read, and keeps status and headers", async () => {
    const done = vi.fn();
    const response = holdUntilDone(streamed("a", "b", "c"), done);
    expect(done).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-test")).toBe("1");
    expect(await response.text()).toBe("abc");
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("releases when the reader cancels the body", async () => {
    const done = vi.fn();
    const response = holdUntilDone(streamed("a", "b"), done);
    await response.body!.cancel();
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("releases when the body errors", async () => {
    const done = vi.fn();
    const failing = new Response(new ReadableStream({ pull() { throw new Error("boom"); } }));
    await expect(holdUntilDone(failing, done).text()).rejects.toThrow();
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("releases at once for a response without a body", () => {
    const done = vi.fn();
    holdUntilDone(new Response(null, { status: 204 }), done);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("app worker routing", () => {
  it("keeps the explicit buffered API on its entry and sends pages to OpenNext", () => {
    const at = (path: string, method = "GET") => isBufferedApiRequest(new Request(`https://x.invalid${path}`, { method }));
    expect(at("/api/auth/get-session")).toBe(true);
    expect(at("/api/workspaces")).toBe(true);
    expect(at("/api/workspaces/t1/files", "POST")).toBe(true);
    expect(at("/workspaces")).toBe(false);
    expect(at("/sign-in")).toBe(false);
    expect(at("/api/workspaces", "POST")).toBe(false);
  });
});

describe("sharedScope", () => {
  it("returns one instance per name, so separately bundled copies share the request scope", () => {
    expect(sharedScope("cf07-test")).toBe(sharedScope("cf07-test"));
    expect(sharedScope("cf07-test")).not.toBe(sharedScope("cf07-other"));
  });
});
