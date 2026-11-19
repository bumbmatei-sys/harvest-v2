import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { dmFailure, dmName, dmUnreadTotal, mergeDmMessages, sortDmList, type DmConversation, type DmMessage } from "../../src/lib/dm-view";

vi.mock("server-only", () => ({}));
const root = resolve(__dirname, "../..");
const message = (id: string, seq: number, rev: number, body: string | null = "hi"): DmMessage =>
  ({ id, conversationId: "c", authorId: "a", clientId: id, body, seq: String(seq), rev: String(rev), createdAt: "2026-11-19T10:00:00Z", editedAt: null, deletedAt: null });
const conversation = (id: string, at: string | null, unread = 0, muted = false): DmConversation =>
  ({ id, latestRev: "1", lastMessageAt: at, otherId: `u-${id}`, otherName: `Name ${id}`, muted, canSend: true, unread });

describe("what a failed start or send shows", () => {
  it("gives one answer for every refusal that depends on the other person", () => {
    // Not a member, opted out, policy off, blocked either way and the unanswered cap all return not_available or unanswered_limit.
    const refusals = [dmFailure(400, "not_available"), dmFailure(400, "unanswered_limit"), dmFailure(404, "not_found"), dmFailure(403, "forbidden"), dmFailure(403, "muted")];
    expect(new Set(refusals)).toEqual(new Set(["unavailable"]));
  });
  it("keeps the sender's own rate limit, sign-in and connection problems separate", () => {
    expect(dmFailure(429, "rate_limited")).toBe("slow");
    expect(dmFailure(401)).toBe("signIn");
    expect(dmFailure(500)).toBe("retry");
    expect(dmFailure(400, "invalid")).toBe("retry");
    expect(dmFailure(409, "client_id_conflict")).toBe("retry");
  });
});

describe("conversation helpers", () => {
  it("merges by id, keeps the newest revision and orders by position", () => {
    const merged = mergeDmMessages([message("a", 1, 1), message("b", 2, 2)], [message("b", 2, 5, null), message("c", 3, 3), message("a", 1, 0, "stale")]);
    expect(merged.map(item => item.id)).toEqual(["a", "b", "c"]);
    expect(merged[0].body).toBe("hi");
    expect(merged[1].body).toBeNull();
  });
  it("counts unread conversations, not messages, and skips muted ones", () => {
    expect(dmUnreadTotal([conversation("a", null, 3), conversation("b", null, 0), conversation("c", null, 5, true)])).toBe(1);
  });
  it("sorts the newest activity first with a stable tie-break and names a missing person neutrally", () => {
    expect(sortDmList([conversation("b", "2026-11-18T10:00:00Z"), conversation("a", "2026-11-19T10:00:00Z"), conversation("c", null)]).map(item => item.id)).toEqual(["a", "b", "c"]);
    expect(dmName({ otherName: "  " }, "Former member")).toBe("Former member");
    expect(dmName({ otherName: "Ruth" }, "Former member")).toBe("Ruth");
  });
});

describe("private message screens never probe eligibility", () => {
  const files = (dir: string, out: string[] = []) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) files(path, out); else if (/\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  };
  const sources = files(join(root, "src")).filter(file => !file.includes("/api/") && !file.includes("/server/"));
  it("calls the people search only from the new message dialog", () => {
    const users = sources.filter(file => /chat\/dms\/people/.test(readFileSync(file, "utf8"))).map(file => file.slice(root.length + 1));
    expect(users).toEqual(["src/components/communities/chat/dm-new-message-dialog.tsx"]);
  });
  it("never reads the server outcome text into the screen", () => {
    for (const file of ["dm-api.ts", "dm-pane.tsx", "dm-new-message-dialog.tsx", "dm-compose-dialog.tsx"]) {
      const source = readFileSync(join(root, "src/components/communities/chat", file), "utf8");
      expect(source, file).not.toMatch(/result\.(?:error|reason|message)\b.*(?:setError|setFailure)/);
      expect(source, file).not.toMatch(/blockedUserIds|acceptMembers/);
    }
  });
});

describe("production", () => {
  it("serves the messages page as not found before any session or database work", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
    try {
      const page = (await import("../../src/app/communities/[slug]/messages/page")).default;
      await expect(page({ params: Promise.resolve({ slug: "club" }), searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    } finally { vi.unstubAllEnvs(); }
  });
});
