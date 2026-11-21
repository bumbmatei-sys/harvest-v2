import { afterEach, describe, expect, it, vi } from "vitest";
import { officeGateOpen, officeRouteDeps } from "../../src/server/office-gate";
import { officeEvidence, operationAvailable } from "../../src/server/office-provider/capabilities";
import { OFFICE_CALENDAR_WRITE_ENABLED, OFFICE_INTEGRATION_ENABLED, OFFICE_MAIL_SEND_ENABLED } from "../../src/server/office-provider/connections";
import { type OfficeAccount } from "../../src/server/office-provider/port";
import { liveOfficeDeps } from "../../src/server/office-provider/registry";
import { OFFICE_LIVE_NETWORK, ZernioOfficeAdapter } from "../../src/server/office-provider/zernio-adapter";
import { can } from "../../src/lib/permissions";
import { inspectSocialBoundary } from "../../scripts/source-guards";

vi.mock("server-only", () => ({}));

const credential = { secret: "injected-office-api-key" };
const mail: OfficeAccount = { ref: "personal-account", platform: "google", profileRef: "private-profile", kind: "mail" };
const json = (body: object, status = 200) => Response.json(body, { status });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Office activation boundary", () => {
  it("hard-disables integration and delivery and keeps the HTTP gate synthetic", () => {
    expect([OFFICE_INTEGRATION_ENABLED, OFFICE_MAIL_SEND_ENABLED, OFFICE_CALENDAR_WRITE_ENABLED, OFFICE_LIVE_NETWORK]).toEqual([false, false, false, false]);
    expect(liveOfficeDeps(credential)).toBeNull();
    expect(officeGateOpen({ NODE_ENV: "production", HARVEST_COMMUNITIES: "enabled" })).toBe(false);
    expect(officeGateOpen({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(false);
    expect(officeGateOpen({ NODE_ENV: "development" })).toBe(true);
    const deps = officeRouteDeps();
    expect(deps?.provider.id).toBe("fake");
    expect(deps?.testDelivery).toBeUndefined();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(officeRouteDeps()).toBeNull();
  });

  it("blocks unapproved adapter calls without touching global fetch", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("real network disabled"));
    await expect(new ZernioOfficeAdapter().perform(credential, mail, { action: "threads", input: {} })).rejects.toMatchObject({ code: "DISABLED" });
    expect(fetch).not.toHaveBeenCalled();
    const transport = vi.fn();
    const adapter = new ZernioOfficeAdapter(transport);
    expect(await adapter.perform(credential, { ...mail, kind: "calendar" }, {
      action: "deleteEvent", input: { eventRef: "event" },
    })).toEqual({ state: "disabled" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("guards the live flag, registry, route sender and role capabilities", () => {
    expect(inspectSocialBoundary("src/server/office-provider/zernio-adapter.ts", "export const OFFICE_LIVE_NETWORK = true;")).not.toEqual([]);
    expect(inspectSocialBoundary("src/server/office-provider/registry.ts", "new ZernioOfficeAdapter(fetch)")).not.toEqual([]);
    expect(inspectSocialBoundary("src/app/api/workspaces/[tenantId]/office/route.ts", "runOffice(testDelivery)")).not.toEqual([]);
    for (const flag of ["OFFICE_INTEGRATION_ENABLED", "OFFICE_MAIL_SEND_ENABLED", "OFFICE_CALENDAR_WRITE_ENABLED"]) {
      expect(inspectSocialBoundary("src/server/office-provider/connections.ts", `export const ${flag} = true;`).map(r => r.rule)).toContain(`${flag} must stay literal false`);
    }
    for (const permission of ["office:connect", "office:mail", "office:calendar", "office:files"] as const) {
      expect(["owner", "admin", "member", "viewer"].map(role => can(role, permission))).toEqual([true, true, false, false]);
    }
  });
});

describe("Office provider contract", () => {
  it("distinguishes documented platform features from synthetic and unverified ones", () => {
    for (const platform of ["gmail", "outlook", "imap"] as const) {
      expect(officeEvidence[platform]).toMatchObject({
        threads: "documented", thread: "documented", folders: "documented", drafts: "documented",
        replyMail: "documented", labels: platform === "imap" ? "unverified" : "documented",
      });
    }
    expect(officeEvidence.googleCalendar).toMatchObject({ calendars: "documented", freeBusy: "documented", createEvent: "documented", meet: "documented" });
    expect(officeEvidence.microsoftCalendar).toMatchObject({ calendars: "documented", freeBusy: "documented", deleteEvent: "documented", teams: "documented" });
    expect(officeEvidence.googleDrive).toMatchObject({ files: "documented", file: "documented", preview: "documented", picker: "documented", downloadLink: "unverified" });
    expect(officeEvidence.oneDrive).toMatchObject({ files: "documented", file: "documented", preview: "documented", downloadLink: "unverified" });
    expect(operationAvailable("microsoft", "picker", true)).toBe(false);
    expect(operationAvailable("google", "downloadLink", true)).toBe(true);
    expect(operationAvailable("google", "downloadLink", false)).toBe(false);
    expect(operationAvailable("microsoft", "drives", false)).toBe(false);
  });

  it("verifies the personal OAuth handoff profile and scope without changing provider retention", async () => {
    const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(json({ profile: { _id: mail.profileRef } }))
      .mockResolvedValueOnce(json({ handoff: { id: "handoff", url: "https://connect.example.test/office", expiresAt: "2026-11-21T12:30:00Z" } }))
      .mockResolvedValueOnce(json({ id: "handoff", platform: "google", status: "connected", accounts: [{ id: mail.ref, profileId: "another-profile" }] }))
      .mockResolvedValueOnce(json({ id: "handoff", platform: "google", status: "connected", accounts: [{ id: mail.ref, profileId: mail.profileRef }] }))
      .mockResolvedValueOnce(json({ accountId: mail.ref, platform: "google", status: "warning", permissions: { scopeAreas: { email: "missing" } } }));
    const adapter = new ZernioOfficeAdapter(transport);
    const started = await adapter.startConnect(credential, { attemptId: "local-attempt", kind: "mail", platform: "google" });
    const attempt = { ...started, kind: "mail", platform: "google" } as const;
    expect(JSON.parse(String(transport.mock.calls[0][1].body))).toEqual({ name: "Harvest Office", externalId: "local-attempt" });
    const connect = new URL(transport.mock.calls[1][0]);
    expect(connect.pathname).toBe("/api/v1/connect/google");
    expect(Object.fromEntries(connect.searchParams)).toMatchObject({ scopes: "email", handoff: "true", profileId: mail.profileRef });
    for (const [, init] of transport.mock.calls) expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${credential.secret}`);
    expect(await adapter.finishConnect(credential, attempt)).toEqual({ state: "failed" });
    expect(await adapter.finishConnect(credential, attempt)).toEqual({ state: "connected", accountRef: mail.ref, health: { health: "reconnect_needed", grants: 0 } });
  });

  it("treats empty, stale, unsupported and denied reads distinctly", async () => {
    const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(json({ data: [], pagination: { nextCursor: "more" }, meta: { filteredClientSide: ["folder"] } }))
      .mockResolvedValueOnce(json({ data: [], stale: true }))
      .mockResolvedValueOnce(json({ error: "sensitive upstream text", code: "account_scope_missing" }, 412))
      .mockResolvedValueOnce(json({}));
    const adapter = new ZernioOfficeAdapter(transport);
    expect(await adapter.perform(credential, mail, { action: "threads", input: { search: "test&body", limit: 10 } })).toEqual({
      state: "available", data: { items: [], nextCursor: "more", partial: true },
    });
    const url = new URL(transport.mock.calls[0][0]);
    expect(url.searchParams.get("searchQueryNative")).toBe("test&body");
    expect(url.searchParams.get("accountId")).toBe(mail.ref);
    expect(transport.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
    expect(await adapter.perform(credential, mail, { action: "folders", input: {} })).toEqual({ state: "temporarily_unavailable" });
    await expect(adapter.perform(credential, mail, { action: "folders", input: {} })).rejects.toMatchObject({ message: "RECONNECT_NEEDED" });
    await expect(adapter.perform(credential, mail, { action: "labels", input: {} })).rejects.toMatchObject({ message: "TEMPORARY" });
    const files = { ...mail, kind: "files" as const };
    expect(await adapter.perform(credential, files, { action: "downloadLink", input: { fileRef: "a-file" } })).toEqual({ state: "unavailable" });
    expect(await adapter.perform(credential, { ...files, platform: "microsoft" }, { action: "picker", input: {} })).toEqual({ state: "unavailable" });
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("rejects a thread or file payload scoped to another account and never presents rich mail HTML", async () => {
    const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(json({ data: { id: "thread", accountId: "foreign", messages: [] } }))
      .mockResolvedValueOnce(json({ data: { id: "thread", accountId: mail.ref,
        messages: [{ id: "msg", text: "live plain text", html: "<img src='tracking'>" }] } }))
      .mockResolvedValueOnce(json({ data: { id: "file", accountId: "foreign", provider: "google", name: "file",
        parentId: null, mimeType: "text/plain", kind: "file", size: 1, webUrl: "https://example.test/a", trashed: false } }));
    const adapter = new ZernioOfficeAdapter(transport);
    await expect(adapter.thread(credential, mail, "thread")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const read = await adapter.thread(credential, mail, "thread");
    expect(read.messages[0].body).toBe("live plain text");
    expect(JSON.stringify(read)).not.toContain("tracking");
    await expect(adapter.file(credential, { ...mail, kind: "files" }, "file")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
