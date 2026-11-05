import { describe, expect, it } from "vitest";
import { companyInput, companyPatch, contactPatch, linkInput, linkPatch, newContactInput, normalizeDomain, normalizeName, peopleQuery, companyQuery } from "../../src/lib/crm-input";
import { can } from "../../src/server/permissions";

describe("company domain normalization", () => {
  it.each([
    ["example.org", "example.org"], ["https://www.Example.org/about?x=1", "example.org"], ["HTTP://Sub.Example.org:8080", "sub.example.org"],
    ["example.org.", "example.org"], ["example.org:8443/path", "example.org"], ["  www.example.co.uk  ", "example.co.uk"], ["münchen.example", "xn--mnchen-3ya.example"],
  ])("%s -> %s", (input, expected) => expect(normalizeDomain(input)).toBe(expected));
  it("treats blank as no domain and rejects non-domains", () => {
    expect(normalizeDomain("  ")).toBeNull();
    for (const value of ["localhost", "192.168.0.1", "[::1]", "not a domain", "-bad.example", "a".repeat(64) + ".example", "http://", "mailto:x@example.org"]) expect(normalizeDomain(value)).toBeUndefined();
  });
});
describe("name normalization for duplicate suggestions", () => {
  it("trims, collapses whitespace and folds case like the SQL generated column", () => {
    expect(normalizeName("  Ada\t  LOVELACE \n")).toBe("ada lovelace");
  });
});
describe("CRM input schemas", () => {
  it("normalizes company input, defaults omitted domain to null and is strict", () => {
    expect(companyInput.parse({ name: " Trust " })).toEqual({ name: "Trust", domain: null, description: "" });
    expect(companyInput.parse({ name: "Trust", domain: "WWW.Trust.example" }).domain).toBe("trust.example");
    expect(companyInput.safeParse({ name: "Trust", tenantId: "x" }).success).toBe(false);
    expect(companyInput.safeParse({ name: "" }).success).toBe(false);
    expect(companyInput.safeParse({ name: "Trust", domain: "nope" }).success).toBe(false);
  });
  it("requires an optimistic version on every patch and allows clearing identifiers", () => {
    expect(contactPatch.safeParse({ name: "x" }).success).toBe(false);
    expect(companyPatch.safeParse({ name: "x" }).success).toBe(false);
    expect(contactPatch.parse({ email: "", phone: "", version: 2 })).toEqual({ email: "", phone: "", version: 2 });
    expect(contactPatch.parse({ email: "A@Example.test", phone: "+44 (20) 7946-0000", version: 1 })).toMatchObject({ email: "a@example.test", phone: "+442079460000" });
    expect(contactPatch.safeParse({ phone: "12345", version: 1 }).success).toBe(false);
    expect(companyPatch.parse({ domain: "", version: 1 }).domain).toBeNull();
    expect(contactPatch.safeParse({ version: 1, tenantId: "x" }).success).toBe(false);
  });
  it("validates link payloads and new-person company links", () => {
    expect(linkInput.parse({ companyId: "6f1c2c5e-6a1c-4c35-8a0f-3f5fbc6f2c11" })).toMatchObject({ title: "", isPrimary: false });
    expect(linkInput.safeParse({ companyId: "not-a-uuid" }).success).toBe(false);
    expect(linkPatch.safeParse({}).success).toBe(false);
    expect(linkPatch.safeParse({ isPrimary: false }).success).toBe(false);
    expect(newContactInput.safeParse({ name: "x", companyId: "bad" }).success).toBe(false);
  });
  it("rejects unknown sorts and filters instead of ignoring them", () => {
    expect(peopleQuery.parse({})).toMatchObject({ q: "", page: 1, sort: "name" });
    for (const query of [{ sort: "drop table" }, { company: "x" }, { email: "maybe" }, { marketing: "yes" }, { page: "0" }]) expect(peopleQuery.safeParse(query).success).toBe(false);
    expect(companyQuery.safeParse({ people: "some" }).success).toBe(false);
  });
});
describe("CRM permission matrix", () => {
  it.each(["owner", "admin", "member"])("lets %s read and write companies", (role) => { expect(can(role, "companies:read")).toBe(true); expect(can(role, "companies:write")).toBe(true); });
  it("keeps viewers read-only and fails closed for unknown roles", () => {
    expect(can("viewer", "companies:read")).toBe(true); expect(can("viewer", "companies:write")).toBe(false);
    expect(can("guest", "companies:read")).toBe(false);
  });
});
