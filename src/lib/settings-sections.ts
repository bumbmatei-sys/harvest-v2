import { BookUser, Building2, Cable, UserRound, UserRoundCog, type LucideIcon } from "lucide-react";
import { can } from "./permissions";
import type { NavFeature } from "./navigation";

/**
 * The Settings pop-up (profile menu), founder-approved structure of 20 Nov: You (Profile, Account) and Ministry (Ministry details, Connections, CRM).
 * A section appears only when it already has a screen: Privacy and data and Billing are not built and are not listed.
 * Presentation only: every route and API behind a section still enforces its own permissions.
 */
export const settingsSectionIds = ["profile", "account", "ministry", "connections", "crm"] as const;
export type SettingsSectionId = typeof settingsSectionIds[number];
export type SettingsGroupId = "you" | "ministry";
export type SettingsSection = { id: SettingsSectionId; group: SettingsGroupId; icon: LucideIcon };
/** What the server tells the shell about the settings screens that exist: communities the person can edit a profile in, and the non-production test credential. */
export type ShellSettings = { communities?: readonly { slug: string; name: string }[]; socialTestCredential?: string };

const all: readonly (SettingsSection & { visible: (viewer: SettingsViewer) => boolean })[] = [
  { id: "profile", group: "you", icon: UserRound, visible: ({ settings }) => settings.communities !== undefined },
  { id: "account", group: "you", icon: UserRoundCog, visible: () => true },
  { id: "ministry", group: "ministry", icon: Building2, visible: ({ staff }) => staff },
  { id: "connections", group: "ministry", icon: Cable, visible: ({ staff, role, features }) => staff && features.includes("social") && can(role ?? "", "social:connect") },
  { id: "crm", group: "ministry", icon: BookUser, visible: ({ staff }) => staff },
];
export type SettingsViewer = { role?: string; /** True when a ministry is open and the viewer is its owner or admin. */ staff: boolean; features: readonly NavFeature[]; settings: ShellSettings };
export const settingsGroups: readonly SettingsGroupId[] = ["you", "ministry"];

export function settingsViewer({ role, hasMinistry, features = [], settings = {} }: { role?: string; hasMinistry: boolean; features?: readonly NavFeature[]; settings?: ShellSettings }): SettingsViewer {
  return { role, staff: hasMinistry && role !== undefined && can(role, "settings:write"), features, settings };
}
/** Sections the viewer can open, in display order. Owners and admins see Ministry; every other role sees only You. */
export function resolveSettingsSections(viewer: SettingsViewer): SettingsSection[] {
  return all.filter((section) => section.visible(viewer)).map(({ id, group, icon }) => ({ id, group, icon }));
}
/** The section a `?settings=` value opens: the named one when the viewer may see it, else the first available, else null (nothing to open). */
export function openSection(value: string | null, sections: readonly SettingsSection[]): SettingsSectionId | null {
  if (value === null) return null;
  return sections.find((section) => section.id === value)?.id ?? sections[0]?.id ?? null;
}
export const settingsParam = "settings";
