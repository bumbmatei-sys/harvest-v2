import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bucketOf, deliveryState, draftState, type DeliveryState } from "../../src/lib/social/publishing-status";
import { can } from "../../src/lib/permissions";

describe("publishing status rules", () => {
  it("maps each delivery to one state and holds a blocked post as awaiting approval", () => {
    expect(deliveryState({ status: "scheduled", lastErrorCode: null }, false)).toBe("queued");
    expect(deliveryState({ status: "scheduled", lastErrorCode: null }, true)).toBe("awaiting_approval");
    expect(deliveryState({ status: "publishing", lastErrorCode: null }, true)).toBe("publishing");
    expect(deliveryState({ status: "published", lastErrorCode: null }, false)).toBe("published");
    expect(deliveryState({ status: "failed", lastErrorCode: "PROVIDER_AUTH" }, false)).toBe("failed");
    expect(deliveryState({ status: "failed", lastErrorCode: "PARTIAL_PUBLISH" }, false)).toBe("partial");
    expect(deliveryState({ status: "unknown", lastErrorCode: "UNCONFIRMED" }, false)).toBe("unknown");
    expect(deliveryState({ status: "cancelled", lastErrorCode: null }, false)).toBe("cancelled");
  });
  it("summarises a draft across its accounts", () => {
    const s = (...states: DeliveryState[]) => draftState(states);
    expect(s()).toBe("draft");
    expect(s("queued", "queued")).toBe("queued");
    expect(s("awaiting_approval", "awaiting_approval")).toBe("awaiting_approval");
    expect(s("published", "published")).toBe("published");
    expect(s("published", "cancelled")).toBe("published");
    expect(s("cancelled")).toBe("cancelled");
    expect(s("published", "failed")).toBe("partial");
    expect(s("published", "unknown")).toBe("partial");
    expect(s("failed", "partial")).toBe("partial");
    expect(s("failed", "failed")).toBe("failed");
    expect(s("unknown", "failed")).toBe("unknown");
    expect(s("published", "queued")).toBe("publishing");
    expect(s("publishing", "failed")).toBe("publishing");
  });
  it("sorts drafts into the queue columns", () => {
    expect(bucketOf("draft")).toBe("drafts");
    for (const s of ["queued", "awaiting_approval", "publishing"] as const) expect(bucketOf(s)).toBe("scheduled");
    for (const s of ["published", "failed", "partial", "unknown", "cancelled"] as const) expect(bucketOf(s)).toBe("sent");
  });
});

describe("approval permissions and migration guards", () => {
  it("lets owners and admins submit and decide, and only an owner change the setting", () => {
    for (const role of ["owner", "admin"]) expect(can(role, "social:approvals")).toBe(true);
    for (const role of ["member", "viewer"]) { expect(can(role, "social:approvals")).toBe(false); expect(can(role, "social:approvals_settings")).toBe(false); }
    expect(can("owner", "social:approvals_settings")).toBe(true);
    expect(can("admin", "social:approvals_settings")).toBe(false);
  });
  const sql = readFileSync(join(__dirname, "../../drizzle/0099_social_approvals.sql"), "utf8");
  it("forces row security, fixes the search path on definers and revokes execute", () => {
    for (const t of ["social_approval_settings", "social_approvals", "social_approval_notices"]) expect(sql).toContain(`'${t}'`);
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/TO current_user|TO %I/);
    expect(sql).toContain("current_user <> 'harvest_app'");
    for (const fn of sql.match(/CREATE (?:OR REPLACE )?FUNCTION[\s\S]*?\$\$;/g) ?? []) if (/SECURITY DEFINER/.test(fn)) expect(fn).toContain("SET search_path = pg_catalog, pg_temp");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.social_subject_fingerprint[\s\S]*FROM PUBLIC, harvest_app/);
    expect(sql).not.toMatch(/contacts|contact_id/i);
  });
  it("gates the worker claim and the status move", () => {
    expect(sql).toContain("AND NOT public.social_approval_blocks(p.tenant_id, p.draft_id, p.id)");
    expect(sql).toContain("CREATE TRIGGER social_post_approval_gate");
  });
});
