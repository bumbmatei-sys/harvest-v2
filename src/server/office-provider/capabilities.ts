import { operationKind, type Operation, type OfficePlatform } from "./port";

export type DocumentedPlatform = "gmail" | "outlook" | "imap" | "googleCalendar" | "microsoftCalendar" | "googleDrive" | "oneDrive";
type Capabilities = Partial<Record<Operation | "sendMail" | "replyMail" | "meet" | "teams", "documented" | "unverified">>;
const mail = {
  threads: "documented", thread: "documented", folders: "documented", labels: "documented",
  drafts: "documented", draft: "documented", createDraft: "documented", updateDraft: "documented", deleteDraft: "documented",
  sendMail: "documented", replyMail: "documented",
} as const;
const calendar = {
  calendars: "documented", events: "documented", event: "documented", freeBusy: "documented", availability: "documented",
  createEvent: "documented", updateEvent: "documented", deleteEvent: "documented",
} as const;
const files = { files: "documented", file: "documented", preview: "documented", downloadLink: "unverified" } as const;
export const officeEvidence = {
  gmail: mail,
  outlook: mail,
  imap: { ...mail, labels: "unverified" },
  googleCalendar: { ...calendar, meet: "documented" },
  microsoftCalendar: { ...calendar, teams: "documented" },
  googleDrive: { ...files, picker: "documented" },
  oneDrive: files,
} satisfies Record<DocumentedPlatform, Capabilities>;

const kinds = {
  google: { mail: "gmail", calendar: "googleCalendar", files: "googleDrive" },
  microsoft: { mail: "outlook", calendar: "microsoftCalendar", files: "oneDrive" },
} as const;

export function operationAvailable(platform: OfficePlatform, action: Operation, synthetic: boolean) {
  if (synthetic && (action === "drives" || action === "downloadLink")) return true;
  const evidence: Capabilities = officeEvidence[kinds[platform][operationKind[action]]];
  return evidence[action] === "documented";
}
