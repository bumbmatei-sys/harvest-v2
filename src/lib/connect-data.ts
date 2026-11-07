import { z } from "zod";

// HC-02 data contract for Harvest Connect pending intake. These are the existing CRM
// consent-ledger purposes a published form version may offer; each is its own opt-in.
// Church referral (recipient-scoped) and any religious-response classification are
// deliberately absent: they need their own reviewed contracts (HC-18 / legal review).
export const connectPurposes = ["account_communications", "outreach_follow_up", "newsletter"] as const;
export type ConnectPurpose = typeof connectPurposes[number];
export const connectPurposeInput = z.enum(connectPurposes);

export const formVersionStatuses = ["draft", "published", "retired"] as const;
export const responseLinkStatuses = ["draft", "published", "disabled", "archived"] as const;
export const responseStatuses = ["pending", "associated", "erased"] as const;
export const responseConsentStatuses = ["granted", "withdrawn"] as const;
// Who recorded an evidence row: the person themself at submission, or staff acting on a request.
export const responseConsentActors = ["subject", "staff"] as const;
export const responseContactKinds = ["email", "phone"] as const;
