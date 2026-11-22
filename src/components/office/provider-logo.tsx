import Image from "next/image";
import { driveMarkColors as d, mailMarkColors as c } from "@/lib/theme-registry";
import type { OfficePlatform } from "@/lib/office/mail";

/**
 * Mailbox marks for Office mail, drawn for Harvest from the public geometry of each mark (Gmail: the Simple Icons outline, CC0-1.0, split into the brand
 * colours; Outlook: an envelope page and a lettered tile in the brand blues). They are simplified marks, each subject to its owner's brand guidelines (clear
 * space, no recolouring, no implied endorsement), used only to name the connected mailbox. Colour is never the only signal: the provider name sits beside
 * the mark or in its accessible name (`label`).
 */
export function ProviderLogo({ platform, className = "size-5", label }: { platform: OfficePlatform; className?: string; label?: string }) {
  const aria = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  if (platform === "google") return <svg viewBox="0 0 24 24" className={className} data-provider-logo="gmail" {...aria}>
    <path d="M1.636 21H5.455V11.73L0 7.64v11.727C0 20.27.732 21 1.636 21z" style={{ fill: c.gmail.blue }} />
    <path d="M18.545 21h3.819C23.268 21 24 20.268 24 19.364V7.64l-5.455 4.09z" style={{ fill: c.gmail.green }} />
    <path d="M18.545 4.64v7.09L24 7.64V5.457c0-2.023-2.309-3.178-3.927-1.964z" style={{ fill: c.gmail.yellow }} />
    <path d="M5.455 11.73V4.64L12 9.548l6.545-4.91v7.09L12 16.64z" style={{ fill: c.gmail.red }} />
    <path d="M0 5.457V7.64l5.455 4.09V4.64L3.927 3.493C2.309 2.28 0 3.434 0 5.457z" style={{ fill: c.gmail.darkRed }} />
  </svg>;
  return <svg viewBox="0 0 24 24" className={className} data-provider-logo="outlook" {...aria}>
    <path d="M10 4.5h12a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H10z" style={{ fill: c.outlook.mid }} />
    <path d="M10 6.2 16.5 11 23 6.2v-.7a1 1 0 0 0-1-1H10z" style={{ fill: c.outlook.light }} />
    <path d="M10 19.5h12a1 1 0 0 0 1-1V8.2l-6.5 4.6L10 8.2z" style={{ fill: c.outlook.pale, opacity: 0.55 }} />
    <rect x="1" y="6" width="12" height="12" rx="1.6" style={{ fill: c.outlook.base }} />
    <ellipse cx="7" cy="12" rx="3" ry="3.4" fill="none" style={{ stroke: c.outlook.white, strokeWidth: 1.7 }} />
  </svg>;
}

/**
 * Source marks for the Files screen: the Harvest logo and the two drive marks (Google Drive: three bars in the brand colours; OneDrive: two clouds in the brand
 * blues). Drawn for Harvest and simplified, so each is subject to its owner's brand guidelines (clear space, no recolouring, no implied endorsement) exactly like
 * the mailbox marks above, and used only to name where a file lives. Decorative by default: the source name is always in the accessible name of the row or card
 * that carries the mark (`label` makes the mark itself an image).
 */
export function SourceLogo({ source, className = "size-4", label }: { source: "harvest" | OfficePlatform; className?: string; label?: string }) {
  const aria = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  if (source === "harvest") return <Image src="/brand/harvest-logo.png" width={24} height={24} alt="" className={`${className} object-contain`} data-source-logo="harvest" {...(label ? { role: "img", "aria-label": label } : {})} />;
  if (source === "google") return <svg viewBox="0 0 24 24" className={className} data-source-logo="drive" {...aria}>
    <path d="M8.4 2.5h7.2L23 15.3h-7.4z" style={{ fill: d.drive.yellow }} />
    <path d="M8.4 2.5 1 15.3l3.7 6.2 7.4-12.8z" style={{ fill: d.drive.green }} />
    <path d="M4.7 21.5h14.6l3.7-6.2H8.4z" style={{ fill: d.drive.blue }} />
  </svg>;
  return <svg viewBox="0 0 24 24" className={className} data-source-logo="onedrive" {...aria}>
    <path d="M9.5 7.2a5.6 5.6 0 0 1 9.4 2.6A4.1 4.1 0 0 1 19.4 18H5.2A3.7 3.7 0 0 1 3.9 10.8 5.6 5.6 0 0 1 9.5 7.2z" style={{ fill: d.onedrive.deep }} />
    <path d="M11.6 9.6a4.6 4.6 0 0 1 7.2 2.4h.4a3.2 3.2 0 0 1 0 6.4H8.4A3.9 3.9 0 0 1 7.6 10.7a4.6 4.6 0 0 1 4-1.1z" style={{ fill: d.onedrive.mid }} />
    <path d="M14.5 13.2h4.7a3.2 3.2 0 0 1 0 5.2H8.4a3 3 0 0 1-1.1-5.7 4.5 4.5 0 0 1 7.2.5z" style={{ fill: d.onedrive.light }} />
  </svg>;
}
