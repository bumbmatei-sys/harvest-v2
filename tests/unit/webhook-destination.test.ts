import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { endpointSecret, isBlockedAddress, parseDestination, resolveDestination, signDelivery } from "../../src/server/webhooks/destination";

describe("CRM webhook destinations (SSRF guard)", () => {
  it("accepts only https on 443 with a public-looking DNS name", () => {
    expect(parseDestination("https://hooks.example.org/crm?x=1")?.hostname).toBe("hooks.example.org");
    expect(parseDestination("https://hooks.example.org:443/crm")).not.toBeNull();
    for (const bad of [
      "http://hooks.example.org/", "https://hooks.example.org:8443/", "https://user:pass@hooks.example.org/", "https://hooks.example.org/#frag",
      "https://127.0.0.1/", "https://[::1]/", "https://2130706433/", "https://0x7f000001/", "https://localhost/", "https://api.localhost/",
      "https://metadata.google.internal/", "https://printer.local/", "https://intranet/", "ftp://hooks.example.org/", "https://hooks.example.org/\nx",
      "https://exa mple.org/", "javascript:alert(1)", "",
    ]) expect(parseDestination(bad), bad).toBeNull();
  });

  it("blocks private, loopback, link-local, metadata, CGNAT, multicast and mapped addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254",
      "64:ff9b::a9fe:a9fe", "2001:db8::1", "ff02::1", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0", "::127.0.0.1", "not-an-ip"]) expect(isBlockedAddress(address), address).toBe(true);
    for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) expect(isBlockedAddress(address), address).toBe(false);
  });

  it("refuses a name if ANY resolved address is private, and pins the checked address", async () => {
    const resolver = (answers: string[]) => async () => answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    expect(await resolveDestination("https://hooks.example.org/x", resolver(["93.184.216.34", "10.0.0.5"]))).toEqual({ ok: false, error: "BLOCKED_DESTINATION" });
    expect(await resolveDestination("https://hooks.example.org/x", resolver(["::ffff:10.0.0.5"]))).toEqual({ ok: false, error: "BLOCKED_DESTINATION" });
    expect(await resolveDestination("https://hooks.example.org/x", resolver([]))).toEqual({ ok: false, error: "BLOCKED_DESTINATION" });
    expect(await resolveDestination("https://hooks.example.org/x", async () => { throw new Error("ENOTFOUND"); })).toEqual({ ok: false, error: "INVALID_DESTINATION" });
    expect(await resolveDestination("http://hooks.example.org/x", resolver(["93.184.216.34"]))).toEqual({ ok: false, error: "INVALID_DESTINATION" });
    const ok = await resolveDestination("https://hooks.example.org/x", resolver(["93.184.216.34"]));
    expect(ok).toMatchObject({ ok: true, address: "93.184.216.34", family: 4 });
  });
});

describe("CRM webhook signing", () => {
  it("derives a per-endpoint secret that changes with rotation, tenant and endpoint", () => {
    const key = "k".repeat(40), tenant = "11111111-1111-4111-8111-111111111111", endpoint = "22222222-2222-4222-8222-222222222222";
    const first = endpointSecret(key, tenant, endpoint, 1);
    expect(first).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(endpointSecret(key, tenant, endpoint, 1)).toBe(first);
    expect(new Set([endpointSecret(key, tenant, endpoint, 2), endpointSecret(key, "33333333-3333-4333-8333-333333333333", endpoint, 1),
      endpointSecret("j".repeat(40), tenant, endpoint, 1)]).has(first)).toBe(false);
  });
  it("signs id.timestamp.body with HMAC-SHA256 so receivers can verify it", () => {
    const body = JSON.stringify({ id: "e1", type: "crm.person.created" });
    expect(signDelivery("whsec_test", "e1", "1700000000", body)).toBe(`v1=${createHmac("sha256", "whsec_test").update(`e1.1700000000.${body}`).digest("hex")}`);
    expect(signDelivery("whsec_test", "e1", "1700000001", body)).not.toBe(signDelivery("whsec_test", "e1", "1700000000", body));
  });
});
