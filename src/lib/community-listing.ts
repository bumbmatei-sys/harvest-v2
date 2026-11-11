import { createHash, randomBytes } from "node:crypto";

// ADR 0013 §7 + PR 3 design. Discover lists a community only when it is published, Listed, opted in by its
// owner and its ministry is eligible. Eligibility = an active Harvest subscription (founder, 11 Nov); billing
// does not exist yet, so every ministry is eligible until it does. Billing replaces discoverEligible's body.
export type ListingSource = { id: string; tenantId: string; slug: string; name: string; tagline: string | null; status: string; visibility: string;
  pricing: string; allowOpen: boolean; allowApply: boolean; allowInvite: boolean; allowEntitlement: boolean; discoverOptIn: boolean };
export type Listing = { resourceType: "community"; resourceId: string; tenantId: string; slug: string; name: string; tagline: string | null;
  hostName: string; pricing: string; admission: string[]; searchText: string };

export function discoverEligible(tenantId: string): boolean { void tenantId; return true; }

export function listingFor(c: ListingSource, hostName: string, eligible: boolean): Listing | null {
  if (!eligible || c.status !== "published" || c.visibility !== "listed" || !c.discoverOptIn) return null;
  // Approval wins when both are on (community_enter), so "open" is listed only without approval.
  const admission = ([["open", c.allowOpen && !c.allowApply], ["apply", c.allowApply], ["invite", c.allowInvite], ["entitlement", c.allowEntitlement]] as const)
    .filter(([, on]) => on).map(([key]) => key);
  return { resourceType: "community", resourceId: c.id, tenantId: c.tenantId, slug: c.slug, name: c.name, tagline: c.tagline, hostName, pricing: c.pricing,
    admission, searchText: [c.name, c.tagline ?? "", hostName].join(" ").toLowerCase().replace(/\s+/g, " ").trim() };
}

export const hashSecret = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const emailHash = (email: string) => hashSecret(email.trim().toLowerCase());
export function emailHint(email: string) {
  const [local, domain] = email.trim().toLowerCase().split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}
export const newInviteToken = () => randomBytes(32).toString("hex");
