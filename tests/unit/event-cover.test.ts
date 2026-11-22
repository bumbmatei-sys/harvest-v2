import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmEventCover, coverFileProblem, sha256Hex, uploadEventCover } from "../../src/lib/event-cover";

const endpoint = "/api/workspaces/t/events/e";
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const hooks = () => ({ onPhase: vi.fn(), onProgress: vi.fn() });
afterEach(() => vi.unstubAllGlobals());

describe("cover file checks", () => {
  it("accepts JPG, PNG and WebP of up to 10 MB whose extension matches", () => {
    expect(coverFileProblem({ name: "a.jpg", type: "image/jpeg", size: 1 })).toBeNull();
    expect(coverFileProblem({ name: "a.JPEG", type: "image/jpeg", size: 10 * 1024 * 1024 })).toBeNull();
    expect(coverFileProblem({ name: "a.png", type: "image/png", size: 5 })).toBeNull();
    expect(coverFileProblem({ name: "a.webp", type: "image/webp", size: 5 })).toBeNull();
  });
  it("refuses other types, a mismatched extension, an empty file and one over 10 MB", () => {
    expect(coverFileProblem({ name: "a.gif", type: "image/gif", size: 5 })).toBe("type");
    expect(coverFileProblem({ name: "a.pdf", type: "application/pdf", size: 5 })).toBe("type");
    expect(coverFileProblem({ name: "a.png", type: "image/jpeg", size: 5 })).toBe("type");
    expect(coverFileProblem({ name: "a.png", type: "image/png", size: 0 })).toBe("size");
    expect(coverFileProblem({ name: "a.png", type: "image/png", size: 10 * 1024 * 1024 + 1 })).toBe("size");
  });
  it("hashes to lowercase hex", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("cover upload", () => {
  it("starts nothing for a file the server would refuse", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const h = hooks();
    expect(await uploadEventCover(endpoint, new File(["x"], "a.gif", { type: "image/gif" }), h)).toEqual({ ok: false, problem: "type" });
    expect(fetchMock).not.toHaveBeenCalled(); expect(h.onPhase).not.toHaveBeenCalled();
  });
  it("sends the checksum, name, type and size when asking for a slot, and maps refusals", async () => {
    const calls: [string, RequestInit][] = [];
    const statuses = [400, 409, 500]; vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push([url, init]); return reply(statuses.shift()!); });
    const file = new File(["abc"], "cover.png", { type: "image/png" });
    expect(await uploadEventCover(endpoint, file, hooks())).toEqual({ ok: false, problem: "rejected" });
    expect(await uploadEventCover(endpoint, file, hooks())).toEqual({ ok: false, problem: "stale" });
    expect(await uploadEventCover(endpoint, file, hooks())).toEqual({ ok: false, problem: "failed" });
    expect(calls[0][0]).toBe(`${endpoint}/cover/uploads`);
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ kind: "cover", name: "cover.png", mime: "image/png", size: 3, checksum: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
  });
  it("reports an interrupted request when the network fails while asking for a slot", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("offline"); });
    expect(await uploadEventCover(endpoint, new File(["abc"], "c.webp", { type: "image/webp" }), hooks())).toEqual({ ok: false, problem: "interrupted" });
  });
});

describe("cover verification", () => {
  const confirmed = (status: string) => vi.stubGlobal("fetch", async () => reply(200, { id: "f", status }));
  it("tells ready, still scanning and failed apart", async () => {
    confirmed("ready"); expect(await confirmEventCover(endpoint, "f")).toEqual({ ok: true, state: "ready", fileId: "f" });
    confirmed("uploaded"); expect(await confirmEventCover(endpoint, "f")).toEqual({ ok: true, state: "scanning", fileId: "f" });
    confirmed("quarantined"); expect(await confirmEventCover(endpoint, "f")).toEqual({ ok: false, problem: "scan", fileId: "f" });
  });
  it("keeps the file id when verification cannot be reached, so Try again only repeats verification", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("offline"); });
    expect(await confirmEventCover(endpoint, "f")).toEqual({ ok: false, problem: "interrupted", fileId: "f" });
    vi.stubGlobal("fetch", async () => reply(409));
    expect(await confirmEventCover(endpoint, "f")).toEqual({ ok: false, problem: "failed", fileId: "f" });
  });
});
