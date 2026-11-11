import { describe, expect, it } from "vitest";
import { discoverEligible, emailHash, emailHint, hashSecret, listingFor, newInviteToken, type ListingSource } from "../../src/lib/community-listing";

const base: ListingSource = { id: "00000000-0000-4000-8000-0000000000c1", tenantId: "00000000-0000-4000-8000-0000000000a1", slug: "grace-study",
  name: "Grace Study", tagline: "Weekly", status: "published", visibility: "listed", pricing: "free",
  allowOpen: true, allowApply: false, allowInvite: true, allowEntitlement: false, discoverOptIn: true };

describe("listingFor", () => {
  it("lists a published, listed, opted-in community of an eligible ministry", () => {
    expect(listingFor(base, "Grace Church", true)).toEqual({ resourceType: "community", resourceId: base.id, tenantId: base.tenantId, slug: "grace-study",
      name: "Grace Study", tagline: "Weekly", hostName: "Grace Church", pricing: "free", admission: ["open", "invite"], searchText: "grace study weekly grace church" });
  });
  it.each([
    ["draft", { status: "draft" }], ["archived", { status: "archived" }], ["unlisted", { visibility: "unlisted" }],
    ["hidden", { visibility: "hidden" }], ["not opted in", { discoverOptIn: false }],
  ] as const)("does not list a %s community", (_label, change) => { expect(listingFor({ ...base, ...change }, "Grace Church", true)).toBeNull(); });
  it("does not list when the ministry is not eligible", () => { expect(listingFor(base, "Grace Church", false)).toBeNull(); });
  it("does not call a community open when people must apply first", () => {
    expect(listingFor({ ...base, allowApply: true }, "Grace Church", true)?.admission).toEqual(["apply", "invite"]);
  });
});

describe("invite helpers", () => {
  it("hashes secrets and normalised emails as sha256 hex", () => {
    expect(hashSecret("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(emailHash("  Jane@Example.TEST ")).toBe(hashSecret("jane@example.test"));
  });
  it("masks an email to its first letter and domain", () => {
    expect(emailHint("jane@example.test")).toBe("j•••@example.test");
    expect(emailHint("J@x.io")).toBe("j•••@x.io");
  });
  it("makes 64-hex unique tokens", () => {
    const a = newInviteToken(), b = newInviteToken();
    expect(a).toMatch(/^[a-f0-9]{64}$/); expect(a).not.toBe(b);
  });
  it("treats every ministry as eligible until subscription billing exists", () => { expect(discoverEligible(base.tenantId)).toBe(true); });
});
