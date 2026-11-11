import { Building, Church, FileUp, Files, Flag, Kanban, ListChecks, MessagesSquare, Palette, SlidersHorizontal, UsersRound, Workflow, type LucideIcon } from "lucide-react";
import type { Audience } from "./audience";
import { can, type Permission } from "./permissions";

/** Message keys in `ComponentsAppShell` that the sidebar and breadcrumb may show. */
export type NavLabelKey = "communities" | "crm" | "workspace" | "settings" | "people" | "companies" | "pipelines" | "tasks" | "imports" | "campaigns" | "files" | "crmFields" | "pipelineSettings" | "appearance" | "ministrySettings" | "profile";
export type NavGroupId = "crm" | "workspace" | "settings";
export type NavEntry = {
  id: string; group: NavGroupId; label: NavLabelKey; icon: LucideIcon;
  /** Route below `/workspaces/{tenantId}`. */
  path: string;
  /** Sidebar active state; also selects the breadcrumb section. */
  match: (pathname: string) => boolean;
  /** Extra breadcrumb-only matches (legacy routes that do not highlight an item). */
  sectionMatch?: (pathname: string) => boolean;
  /** Omitted: every member sees it. The server still enforces access on every route. */
  permission?: Permission;
  /** Omitted: every audience, including an unspecified one. */
  audiences?: readonly Audience[];
  audienceLabels?: Partial<Record<Audience, NavLabelKey>>;
  /** Shown only when the server reports this feature as enabled (activation flags, ADR 0013 §11). */
  feature?: NavFeature;
};
export type NavFeature = "communities";
export type NavItem = { id: string; label: NavLabelKey; icon: LucideIcon; href: string; active: boolean };
export type NavGroup = { id: NavGroupId; label: NavLabelKey; items: NavItem[] };

const groups: readonly { id: NavGroupId; label: NavLabelKey }[] = [{ id: "crm", label: "crm" }, { id: "workspace", label: "workspace" }, { id: "settings", label: "settings" }];
const has = (part: string) => (pathname: string) => pathname.includes(part);

export const navEntries: readonly NavEntry[] = [
  { id: "people", group: "crm", label: "people", icon: UsersRound, path: "/crm/people", match: has("/crm/people"), sectionMatch: has("/contacts") },
  { id: "companies", group: "crm", label: "companies", icon: Building, path: "/crm/companies", match: has("/crm/companies") },
  { id: "pipelines", group: "crm", label: "pipelines", icon: Kanban, path: "/crm/pipelines", match: (p) => p.includes("/crm/pipelines") || p.includes("/crm/deals") },
  { id: "tasks", group: "crm", label: "tasks", icon: ListChecks, path: "/crm/tasks", match: has("/crm/tasks") },
  // CRM-06: imports run for owners, admins and members; viewers never see a dead link.
  { id: "imports", group: "crm", label: "imports", icon: FileUp, path: "/crm/imports", match: has("/crm/imports"), permission: "crm:import" },
  { id: "campaigns", group: "workspace", label: "campaigns", icon: Flag, path: "/campaigns", match: has("/campaigns") },
  { id: "files", group: "workspace", label: "files", icon: Files, path: "/files", match: has("/files") },
  // ADR 0013: every ministry role lists communities; owners/admins edit (enforced by the API). Hidden until activated.
  { id: "communities", group: "workspace", label: "communities", icon: MessagesSquare, path: "/communities", match: has("/communities"), permission: "communities:read", feature: "communities" },
  { id: "crmFields", group: "settings", label: "crmFields", icon: SlidersHorizontal, path: "/crm/settings/fields", match: has("/crm/settings/fields") },
  { id: "pipelineSettings", group: "settings", label: "pipelineSettings", icon: Workflow, path: "/crm/settings/pipelines", match: has("/crm/settings/pipelines") },
  { id: "appearance", group: "settings", label: "appearance", icon: Palette, path: "/appearance", match: (p) => p.endsWith("/appearance") },
  // Every member can open it; only owners and admins can change the ministry type (enforced by the API).
  { id: "ministrySettings", group: "settings", label: "ministrySettings", icon: Church, path: "/settings", match: (p) => p.endsWith("/settings") },
];

const visibleTo = (entry: NavEntry, role: string | undefined, audience: Audience | null | undefined, features: readonly NavFeature[]) =>
  (!entry.feature || features.includes(entry.feature)) && (!entry.permission || (role !== undefined && can(role, entry.permission))) && (!entry.audiences || (audience != null && entry.audiences.includes(audience)));
const labelFor = (entry: NavEntry, audience: Audience | null | undefined) => (audience && entry.audienceLabels?.[audience]) || entry.label;

/** Sidebar groups for one workspace member. Presentation only: routes enforce their own permissions. */
export function resolveNavigation({ tenantId, role, audience, pathname, features = [] }: { tenantId: string; role?: string; audience?: Audience | null; pathname: string; features?: readonly NavFeature[] }, entries: readonly NavEntry[] = navEntries): NavGroup[] {
  return groups.map((group) => ({
    ...group,
    items: entries.filter((entry) => entry.group === group.id && visibleTo(entry, role, audience, features)).map((entry) => ({
      id: entry.id, label: labelFor(entry, audience), icon: entry.icon, href: `/workspaces/${tenantId}${entry.path}`, active: entry.match(pathname),
    })),
  })).filter((group) => group.items.length > 0);
}

/** Breadcrumb section label key for a path, or null when no registry entry owns it. */
export function sectionLabel(pathname: string, audience?: Audience | null, entries: readonly NavEntry[] = navEntries): NavLabelKey | null {
  const entry = entries.find((item) => item.match(pathname) || item.sectionMatch?.(pathname));
  return entry ? labelFor(entry, audience) : null;
}
