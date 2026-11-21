import { BarChart3, Bot, Building, Calendar, CalendarCheck, CalendarDays, Church, ClipboardList, Compass, FileText, FileUp, Files, Flag, Globe, HandCoins, HeartHandshake, Inbox, Kanban, Link2, ListChecks, Mail, MailOpen, Radio, Sheet, ClipboardCheck, Users, MessageCircleReply, MessagesSquare, Newspaper, Palette, QrCode, ShoppingBag, Landmark, Share2, SlidersHorizontal, UserCog, UsersRound, Workflow, type LucideIcon } from "lucide-react";
import type { Audience } from "./audience";
import { can, type Permission } from "./permissions";

/** Message keys in `ComponentsAppShell` that the sidebar and breadcrumb may show. */
export type NavLabelKey = "communities" | "crm" | "workspace" | "settings" | "people" | "companies" | "pipelines" | "tasks" | "imports" | "campaigns" | "followUp" | "files" | "crmFields" | "pipelineSettings" | "appearance" | "ministrySettings" | "profile"
  | "office" | "forms" | "mail" | "calendar" | "documents" | "spreadsheets" | "giving" | "volunteers" | "livestream" | "churchProfile"
  | "connect" | "qrAndLinks" | "responses" | "events"
  | "publishing" | "community" | "commerce" | "chat" | "composer" | "planner" | "socialAccounts" | "socialAnalytics" | "inbox" | "autoDm" | "articles" | "website" | "linkInBio" | "newsletter" | "discover" | "products" | "assistant"
  | "modeOperations" | "modePublic" | "modeAssistant";
/** Shell modes (three-mode shell spec, 16 Nov 2026). The names are final. */
export type NavMode = "operations" | "public" | "assistant";
export const navModes: readonly NavMode[] = ["operations", "public", "assistant"];
/** `planned` entries are reserved for modules that are not built: never rendered, never linked. */
export type NavStatus = "live" | "planned";
/** The three groups today's single sidebar shows; the other ids belong to the per-mode sidebars of slice 2. */
export type LegacyNavGroupId = "crm" | "workspace" | "settings";
export type NavGroupId = LegacyNavGroupId | "office" | "connect" | "publishing" | "community" | "commerce" | "chat";
export type NavEntry = {
  id: string;
  /** Group inside the entry's mode (per-mode sidebar). */
  group: NavGroupId;
  /** Group in today's single sidebar; defaults to `group` when that is a legacy id. Removed with the old sidebar path. */
  legacyGroup?: LegacyNavGroupId;
  /** Which shell mode owns the entry. Required, so a new module cannot forget it. */
  mode: NavMode;
  /** Omitted: live. */
  status?: NavStatus;
  label: NavLabelKey; icon: LucideIcon;
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
export type NavFeature = "communities" | "events" | "social";
export type NavItem = { id: string; label: NavLabelKey; icon: LucideIcon; href: string; active: boolean };
export type NavGroup = { id: NavGroupId; label: NavLabelKey; icon?: LucideIcon; items: NavItem[] };

const legacyGroups: readonly { id: LegacyNavGroupId; label: NavLabelKey }[] = [{ id: "crm", label: "crm" }, { id: "workspace", label: "workspace" }, { id: "settings", label: "settings" }];
/** Groups of each mode's sidebar, in display order. Settings stays the last group of Operations. */
export const groupsByMode: Record<NavMode, readonly { id: NavGroupId; label: NavLabelKey; icon?: LucideIcon }[]> = {
  operations: [{ id: "crm", label: "crm" }, { id: "connect", label: "connect" }, { id: "office", label: "office" }, { id: "workspace", label: "workspace" }, { id: "settings", label: "settings" }],
  public: [{ id: "publishing", label: "publishing", icon: Share2 }, { id: "community", label: "community" }, { id: "commerce", label: "commerce" }],
  assistant: [{ id: "chat", label: "chat" }],
};
const has = (part: string) => (pathname: string) => pathname.includes(part);
/** Anchored match for reserved routes: `/workspaces/{id}{path}` and anything below it. */
const under = (path: string) => (pathname: string) => new RegExp(`^/workspaces/[^/]+${path}(/|$)`).test(pathname);

export const navEntries: readonly NavEntry[] = [
  { id: "people", group: "crm", mode: "operations", label: "people", icon: UsersRound, path: "/crm/people", match: has("/crm/people"), sectionMatch: has("/contacts") },
  { id: "companies", group: "crm", mode: "operations", label: "companies", icon: Building, path: "/crm/companies", match: has("/crm/companies") },
  { id: "pipelines", group: "crm", mode: "operations", label: "pipelines", icon: Kanban, path: "/crm/pipelines", match: (p) => p.includes("/crm/pipelines") || p.includes("/crm/deals") },
  { id: "tasks", group: "crm", mode: "operations", label: "tasks", icon: ListChecks, path: "/crm/tasks", match: has("/crm/tasks") },
  // CRM-06: imports run for owners, admins and members; viewers never see a dead link.
  { id: "imports", group: "crm", mode: "operations", label: "imports", icon: FileUp, path: "/crm/imports", match: has("/crm/imports"), permission: "crm:import" },
  // Reserved entries (status planned) are never rendered or linked; their module's PR flips the status.
  { id: "connectLinks", group: "connect", mode: "operations", status: "planned", label: "qrAndLinks", icon: QrCode, path: "/connect/links", match: under("/connect/links") },
  { id: "responses", group: "connect", mode: "operations", status: "planned", label: "responses", icon: ClipboardList, path: "/connect/responses", match: under("/connect/responses") },
  { id: "forms", group: "connect", mode: "operations", status: "planned", label: "forms", icon: ClipboardCheck, path: "/connect/forms", match: under("/connect/forms") },
  { id: "mail", group: "office", mode: "operations", status: "planned", label: "mail", icon: MailOpen, path: "/mail", match: under("/mail") },
  { id: "calendar", group: "office", mode: "operations", status: "planned", label: "calendar", icon: Calendar, path: "/calendar", match: under("/calendar") },
  { id: "documents", group: "office", mode: "operations", status: "planned", label: "documents", icon: FileText, path: "/docs", match: under("/docs") },
  { id: "spreadsheets", group: "office", mode: "operations", status: "planned", label: "spreadsheets", icon: Sheet, path: "/sheets", match: under("/sheets") },
  { id: "churchProfile", group: "workspace", mode: "operations", status: "planned", label: "churchProfile", icon: Landmark, path: "/church-profile", match: under("/church-profile") },
  { id: "volunteers", group: "workspace", mode: "operations", status: "planned", label: "volunteers", icon: Users, path: "/volunteers", match: under("/volunteers") },
  { id: "livestream", group: "workspace", mode: "operations", status: "planned", label: "livestream", icon: Radio, path: "/livestream", match: under("/livestream") },
  { id: "giving", group: "workspace", mode: "operations", status: "planned", label: "giving", icon: HandCoins, path: "/giving", match: under("/giving") },
  { id: "campaigns", group: "workspace", mode: "operations", label: "campaigns", icon: Flag, path: "/campaigns", match: has("/campaigns") },
  // HC-13: the follow-up queue. Owners, admins and members open it (a member sees only the cases assigned to them); viewers never see a dead link.
  { id: "followUp", group: "connect", legacyGroup: "workspace", mode: "operations", label: "followUp", icon: HeartHandshake, path: "/connect/follow-up", match: has("/connect/follow-up"), permission: "followup:work" },
  // C14: owners and admins; hidden unless the server reports Events enabled (never in production).
  { id: "events", group: "workspace", mode: "operations", label: "events", icon: CalendarCheck, path: "/events", match: under("/events"), permission: "communities:manage", feature: "events" },
  { id: "files", group: "workspace", mode: "operations", label: "files", icon: Files, path: "/files", match: has("/files") },
  // The Social media group: Planner opens the page whose own tabs are Compose, Calendar and Queue. Inbox, Auto-DM and Analytics stay planned until their screens exist.
  { id: "planner", group: "publishing", mode: "public", label: "planner", icon: CalendarDays, path: "/social/planner", match: (pathname) => under("/social/planner")(pathname) || under("/social/compose")(pathname), permission: "social:schedule", feature: "social" },
  { id: "inbox", group: "publishing", mode: "public", status: "planned", label: "inbox", icon: Inbox, path: "/inbox", match: under("/inbox") },
  { id: "socialAnalytics", group: "publishing", mode: "public", status: "planned", label: "socialAnalytics", icon: BarChart3, path: "/social/analytics", match: under("/social/analytics") },
  { id: "autoDm", group: "publishing", mode: "public", label: "autoDm", icon: MessageCircleReply, path: "/social/auto-dm", match: under("/social/auto-dm"), permission: "social:auto_dm", feature: "social" },
  { id: "articles", group: "publishing", mode: "public", status: "planned", label: "articles", icon: Newspaper, path: "/articles", match: under("/articles") },
  { id: "website", group: "publishing", mode: "public", status: "planned", label: "website", icon: Globe, path: "/website", match: under("/website") },
  { id: "linkInBio", group: "publishing", mode: "public", status: "planned", label: "linkInBio", icon: Link2, path: "/link-in-bio", match: under("/link-in-bio") },
  { id: "newsletter", group: "publishing", mode: "public", status: "planned", label: "newsletter", icon: Mail, path: "/newsletter", match: under("/newsletter") },
  // ADR 0013: every ministry role lists communities; owners/admins edit (enforced by the API). Hidden until activated.
  { id: "communities", group: "community", legacyGroup: "workspace", mode: "public", label: "communities", icon: MessagesSquare, path: "/communities", match: has("/communities"), permission: "communities:read", feature: "communities" },
  { id: "discover", group: "community", mode: "public", status: "planned", label: "discover", icon: Compass, path: "/discover/manage", match: under("/discover/manage") },
  { id: "products", group: "commerce", mode: "public", status: "planned", label: "products", icon: ShoppingBag, path: "/products", match: under("/products") },
  { id: "assistant", group: "chat", mode: "assistant", status: "planned", label: "assistant", icon: Bot, path: "/assistant", match: under("/assistant") },
  // Accounts live in Settings, as in the first Harvest version; the composer links here from its "+" beside Post to.
  { id: "socialAccounts", group: "settings", mode: "operations", label: "socialAccounts", icon: UserCog, path: "/social/accounts", match: under("/social/accounts"), permission: "social:connect", feature: "social" },
  { id: "crmFields", group: "settings", mode: "operations", label: "crmFields", icon: SlidersHorizontal, path: "/crm/settings/fields", match: has("/crm/settings/fields") },
  { id: "pipelineSettings", group: "settings", mode: "operations", label: "pipelineSettings", icon: Workflow, path: "/crm/settings/pipelines", match: has("/crm/settings/pipelines") },
  { id: "appearance", group: "settings", mode: "operations", label: "appearance", icon: Palette, path: "/appearance", match: (p) => p.endsWith("/appearance") },
  // Every member can open it; only owners and admins can change the ministry type (enforced by the API).
  { id: "ministrySettings", group: "settings", mode: "operations", label: "ministrySettings", icon: Church, path: "/settings", match: (p) => p.endsWith("/settings") },
];

const visibleTo = (entry: NavEntry, role: string | undefined, audience: Audience | null | undefined, features: readonly NavFeature[]) =>
  entry.status !== "planned" && (!entry.feature || features.includes(entry.feature)) && (!entry.permission || (role !== undefined && can(role, entry.permission))) && (!entry.audiences || (audience != null && entry.audiences.includes(audience)));
const labelFor = (entry: NavEntry, audience: Audience | null | undefined) => (audience && entry.audienceLabels?.[audience]) || entry.label;
type Viewer = { tenantId: string; role?: string; audience?: Audience | null; features?: readonly NavFeature[] };
const toItem = (entry: NavEntry, { tenantId, audience, pathname }: { tenantId: string; audience?: Audience | null; pathname: string }): NavItem => ({
  id: entry.id, label: labelFor(entry, audience), icon: entry.icon, href: `/workspaces/${tenantId}${entry.path}`, active: entry.match(pathname),
});

/**
 * Sidebar groups for one workspace member: every mode together in today's three groups (what AppShell renders until the switcher ships).
 * Presentation only: routes enforce their own permissions. Planned entries are never returned.
 */
export function resolveNavigation({ tenantId, role, audience, pathname, features = [] }: Viewer & { pathname: string }, entries: readonly NavEntry[] = navEntries): NavGroup[] {
  return legacyGroups.map((group) => ({
    ...group,
    items: entries.filter((entry) => (entry.legacyGroup ?? entry.group) === group.id && visibleTo(entry, role, audience, features)).map((entry) => toItem(entry, { tenantId, audience, pathname })),
  })).filter((group) => group.items.length > 0);
}

export type ModeResolution = {
  mode: NavMode;
  /** True when no entry owns the path (home, profile, unknown), so the mode came from the user's choice or the default. */
  neutral: boolean;
};
/**
 * Mode of the page. The entry that owns the path decides (planned entries included: a reserved route still belongs to its mode);
 * a manual `choice` applies only on neutral pages. Unknown paths fall back to `choice`, then `fallback` (Operations).
 */
export function resolveMode({ pathname, choice, fallback = "operations" }: { pathname: string; choice?: NavMode | null; fallback?: NavMode }, entries: readonly NavEntry[] = navEntries): ModeResolution {
  const entry = entries.find((item) => item.match(pathname) || item.sectionMatch?.(pathname));
  return entry ? { mode: entry.mode, neutral: false } : { mode: choice ?? fallback, neutral: true };
}

/** Which modes have at least one visible (live, permitted, audience-matching) entry; an empty mode is hidden from the switcher. */
export function modeAvailability({ role, audience, features = [] }: Omit<Viewer, "tenantId">, entries: readonly NavEntry[] = navEntries): Record<NavMode, boolean> {
  const available = (mode: NavMode) => entries.some((entry) => entry.mode === mode && visibleTo(entry, role, audience, features));
  return { operations: available("operations"), public: available("public"), assistant: available("assistant") };
}

/** Per-mode sidebar: the groups of `mode` (default: the mode derived from the path, then `choice`). AppShell does not render it yet. */
export function resolveModeNavigation({ tenantId, role, audience, pathname, features = [], mode, choice }: Viewer & { pathname: string; mode?: NavMode; choice?: NavMode | null }, entries: readonly NavEntry[] = navEntries): ModeResolution & { groups: NavGroup[] } {
  const resolved: ModeResolution = mode ? { mode, neutral: false } : resolveMode({ pathname, choice }, entries);
  const groups = groupsByMode[resolved.mode].map((group) => ({
    ...group,
    items: entries.filter((entry) => entry.mode === resolved.mode && entry.group === group.id && visibleTo(entry, role, audience, features)).map((entry) => toItem(entry, { tenantId, audience, pathname })),
  })).filter((group) => group.items.length > 0);
  return { ...resolved, groups };
}

/** Breadcrumb section label key for a path, or null when no live registry entry owns it. */
export function sectionLabel(pathname: string, audience?: Audience | null, entries: readonly NavEntry[] = navEntries): NavLabelKey | null {
  const entry = entries.find((item) => item.status !== "planned" && (item.match(pathname) || item.sectionMatch?.(pathname)));
  return entry ? labelFor(entry, audience) : null;
}
