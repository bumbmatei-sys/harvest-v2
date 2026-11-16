import { defineStatusTones } from "./status-tone";

/** Tone of a recorded consent state on CRM lists and records; "none" and "unknown" mean nothing is recorded. */
export const consentTone = defineStatusTones({ granted: "success", withdrawn: "warning", none: "pending", unknown: "pending" });
