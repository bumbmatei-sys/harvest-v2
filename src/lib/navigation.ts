import { BadgeDollarSign, ChartColumn, BookOpen, Bot, Briefcase, Building, Calendar, CalendarCheck, CalendarClock, CalendarDays, ClipboardCheck, ClipboardList, ClipboardPen, Compass, Contact, ContactRound, FileText, FileUp, Files, Flag, Gift, Globe, GraduationCap, Handshake, HandCoins, HeartHandshake, Kanban, LayoutDashboard, LayoutTemplate, Link2, ListChecks, Mail, MailOpen, MailPlus, MessageCircleReply, MessageSquareText, MessagesSquare, Newspaper, Package, Palette, PiggyBank, Podcast, QrCode, Radio, ScanQrCode, Settings, Share2, Sheet, SlidersHorizontal, Sparkles, Target, TicketPercent, UserCheck, UserCog, UserRoundCheck, Users, UsersRound, Wallet, Church, Landmark, ChartLine, ChartNoAxesCombined, Workflow, TextCursorInput, type LucideIcon } from "lucide-react";
import type { Audience } from "./audience";
import { can, type Permission } from "./permissions";

/** Message keys in `ComponentsAppShell` that the sidebar and breadcrumb may show. */
export type NavLabelKey = "communities" | "crm" | "workspace" | "settings" | "people" | "companies" | "pipelines" | "tasks" | "reports" | "imports" | "campaigns" | "followUp" | "files" | "crmFields" | "pipelineSettings" | "appearance" | "ministrySettings" | "profile"
  | "office" | "forms" | "mail" | "calendar" | "documents" | "spreadsheets" | "giving" | "volunteers" | "livestream" | "churchProfile"
  | "connect" | "qrAndLinks" | "responses" | "events"
  | "publishing" | "community" | "commerce" | "chat" | "composer" | "planner" | "socialAccounts" | "socialAnalytics" | "inbox" | "autoDm" | "articles" | "website" | "linkInBio" | "newsletter" | "discover" | "products" | "assistant"
  | "overview" | "donations" | "fundraising" | "pledges" | "donors" | "funds" | "givingPage" | "ads" | "live" | "courses" | "coaching" | "coupons" | "newsletterCampaigns" | "audience" | "signupForms" | "newsletterAnalytics" | "websiteBuilder" | "ministryPage"
  | "modeOperations" | "modePublic" | "modeAssistant";
/** Shell modes (three-mode shell spec, 16 Nov 2026). The names are final. */
export type NavMode = "operations" | "public" | "assistant";
export const navModes: readonly NavMode[] = ["operations", "public", "assistant"];
/** `planned` entries are reserved for modules that are not built: never rendered, never linked. */
export type NavStatus = "live" | "planned";
/** The three groups today's single sidebar shows; the other ids belong to the per-mode sidebars of slice 2. */
export type LegacyNavGroupId = "crm" | "workspace" | "settings";
/** `settings` is not a sidebar group any more: its entries stay in the registry (routes, breadcrumbs, mode) and are reached from the Settings pop-up. */
export type NavGroupId = LegacyNavGroupId | "office" | "connect" | "giving" | "discover" | "publishing" | "newsletter" | "website" | "community" | "commerce" | "chat";
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
  /**
   * Entries whose page replaces the whole sidebar with its own contextual panel (Inbox). The id of the entry the panel's back arrow returns to, so the
   * exit route lives in this registry and never in the page.
   */
  exitTo?: string;
};
export type NavFeature = "communities" | "events" | "social" | "office";
export type NavItem = { id: string; label: NavLabelKey; icon: LucideIcon; href: string; active: boolean };
/** A `pinned` group is rendered without a header, above the other groups (Discover). */
export type NavGroup = { id: NavGroupId; label: NavLabelKey; icon?: LucideIcon; pinned?: boolean; items: NavItem[] };

const legacyGroups: readonly { id: LegacyNavGroupId; label: NavLabelKey }[] = [{ id: "crm", label: "crm" }, { id: "workspace", label: "workspace" }];
/** A pinned group has no header, so no header icon: its single row carries the icon. */
type GroupDef = { id: NavGroupId; label: NavLabelKey; icon?: LucideIcon; pinned?: boolean };
/**
 * Groups of each mode's sidebar, in display order (founder-approved structure of 20 Nov; docs/prd/public-mode-social-discover-navigation.md 2 and 2b).
 * Every group header has its own icon, unique across the registry (a unit test checks headers and rows together). Settings is not a group: it is a pop-up.
 */
export const groupsByMode: Record<NavMode, readonly GroupDef[]> = {
  operations: [{ id: "office", label: "office", icon: Briefcase }, { id: "crm", label: "people", icon: Contact }, { id: "connect", label: "connect", icon: QrCode }, { id: "workspace", label: "workspace", icon: Church }, { id: "giving", label: "giving", icon: HandCoins }],
  public: [{ id: "discover", label: "discover", pinned: true }, { id: "publishing", label: "publishing", icon: Share2 }, { id: "newsletter", label: "newsletter", icon: Mail }, { id: "website", label: "website", icon: Globe }, { id: "community", label: "community", icon: Users }, { id: "commerce", label: "commerce", icon: GraduationCap }],
  assistant: [{ id: "chat", label: "chat", icon: Sparkles }],
};
const has = (part: string) => (pathname: string) => pathname.includes(part);
/** Anchored match for reserved routes: `/workspaces/{id}{path}` and anything below it. */
const under = (path: string) => (pathname: string) => new RegExp(`^/workspaces/[^/]+${path}(/|$)`).test(pathname);

export const navEntries: readonly NavEntry[] = [
  // Operations > People (the CRM).
  { id: "people", group: "crm", mode: "operations", label: "people", icon: UsersRound, path: "/crm/people", match: has("/crm/people"), sectionMatch: has("/contacts") },
  { id: "companies", group: "crm", mode: "operations", label: "companies", icon: Building, path: "/crm/companies", match: has("/crm/companies") },
  { id: "pipelines", group: "crm", mode: "operations", label: "pipelines", icon: Kanban, path: "/crm/pipelines", match: (p) => p.includes("/crm/pipelines") || p.includes("/crm/deals") },
  { id: "tasks", group: "crm", mode: "operations", label: "tasks", icon: ListChecks, path: "/crm/tasks", match: has("/crm/tasks") },
  // CRM reports: read-only aggregates; owners and admins see ministry totals, members their own work, viewers never see a dead link.
  { id: "crmReports", group: "crm", mode: "operations", label: "reports", icon: ChartColumn, path: "/crm/reports", match: has("/crm/reports"), permission: "crm:reports" },
  // CRM forms builder: owners and admins build forms that save people to the CRM.
  { id: "crmForms", group: "crm", mode: "operations", label: "forms", icon: TextCursorInput, path: "/crm/forms", match: has("/crm/forms"), permission: "crm:forms_manage" },
  // CRM-06: imports run for owners, admins and members; viewers never see a dead link.
  { id: "imports", group: "crm", mode: "operations", label: "imports", icon: FileUp, path: "/crm/imports", match: has("/crm/imports"), permission: "crm:import" },
  // Operations > Connect. Reserved entries (status planned) are never rendered or linked; their module's PR flips the status.
  { id: "connectLinks", group: "connect", mode: "operations", status: "planned", label: "qrAndLinks", icon: ScanQrCode, path: "/connect/links", match: under("/connect/links") },
  { id: "responses", group: "connect", mode: "operations", status: "planned", label: "responses", icon: ClipboardList, path: "/connect/responses", match: under("/connect/responses") },
  { id: "forms", group: "connect", mode: "operations", status: "planned", label: "forms", icon: ClipboardCheck, path: "/connect/forms", match: under("/connect/forms") },
  // Operations > Office (Files moved here from the Ministry group; its legacy sidebar group stays Ministry).
  // Office Mail: each owner or admin's own mailbox. Hidden unless the server reports the Office screens open (never in production); the page takes over the sidebar (exitTo) like the social Inbox.
  { id: "mail", group: "office", mode: "operations", label: "mail", icon: MailOpen, path: "/mail", match: under("/mail"), permission: "office:mail", feature: "office", exitTo: "files" },
  { id: "calendar", group: "office", mode: "operations", status: "planned", label: "calendar", icon: Calendar, path: "/calendar", match: under("/calendar") },
  { id: "documents", group: "office", mode: "operations", status: "planned", label: "documents", icon: FileText, path: "/docs", match: under("/docs") },
  { id: "spreadsheets", group: "office", mode: "operations", status: "planned", label: "spreadsheets", icon: Sheet, path: "/sheets", match: under("/sheets") },
  // Operations > Ministry.
  { id: "churchProfile", group: "workspace", mode: "operations", status: "planned", label: "ministryPage", icon: Landmark, path: "/church-profile", match: under("/church-profile") },
  { id: "volunteers", group: "workspace", mode: "operations", status: "planned", label: "volunteers", icon: UserCheck, path: "/volunteers", match: under("/volunteers") },
  { id: "livestream", group: "workspace", mode: "operations", status: "planned", label: "livestream", icon: Radio, path: "/livestream", match: under("/livestream") },
  { id: "campaigns", group: "workspace", mode: "operations", label: "campaigns", icon: Flag, path: "/campaigns", match: has("/campaigns") },
  // HC-13: the follow-up queue. Owners, admins and members open it (a member sees only the cases assigned to them); viewers never see a dead link.
  { id: "followUp", group: "connect", legacyGroup: "workspace", mode: "operations", label: "followUp", icon: HeartHandshake, path: "/connect/follow-up", match: has("/connect/follow-up"), permission: "followup:work" },
  // C14: owners and admins; hidden unless the server reports Events enabled (never in production).
  { id: "events", group: "workspace", mode: "operations", label: "events", icon: CalendarCheck, path: "/events", match: under("/events"), permission: "communities:manage", feature: "events" },
  { id: "files", group: "office", legacyGroup: "workspace", mode: "operations", label: "files", icon: Files, path: "/files", match: has("/files") },
  // Operations > Giving (its own group; all planned until the giving screens exist).
  { id: "givingOverview", group: "giving", mode: "operations", status: "planned", label: "overview", icon: LayoutDashboard, path: "/giving", match: under("/giving") },
  { id: "donations", group: "giving", mode: "operations", status: "planned", label: "donations", icon: Gift, path: "/giving/donations", match: under("/giving/donations") },
  { id: "fundraising", group: "giving", mode: "operations", status: "planned", label: "fundraising", icon: PiggyBank, path: "/giving/fundraising", match: under("/giving/fundraising") },
  { id: "pledges", group: "giving", mode: "operations", status: "planned", label: "pledges", icon: Handshake, path: "/giving/pledges", match: under("/giving/pledges") },
  { id: "donors", group: "giving", mode: "operations", status: "planned", label: "donors", icon: UserRoundCheck, path: "/giving/donors", match: under("/giving/donors") },
  { id: "funds", group: "giving", mode: "operations", status: "planned", label: "funds", icon: Wallet, path: "/giving/funds", match: under("/giving/funds") },
  { id: "givingPage", group: "giving", mode: "operations", status: "planned", label: "givingPage", icon: BadgeDollarSign, path: "/giving/page", match: under("/giving/page") },
  // Public > Discover (pinned above the groups) and Social media. Planner opens the page whose own tabs are Compose, Calendar and Queue.
  { id: "discover", group: "discover", mode: "public", status: "planned", label: "discover", icon: Compass, path: "/discover/manage", match: under("/discover/manage") },
  { id: "planner", group: "publishing", mode: "public", label: "planner", icon: CalendarDays, path: "/social/planner", match: (pathname) => under("/social/planner")(pathname) || under("/social/compose")(pathname), permission: "social:schedule", feature: "social" },
  { id: "inbox", group: "publishing", mode: "public", label: "inbox", icon: MessageSquareText, path: "/social/inbox", match: under("/social/inbox"), permission: "social:inbox", feature: "social", exitTo: "planner" },
  { id: "autoDm", group: "publishing", mode: "public", label: "autoDm", icon: MessageCircleReply, path: "/social/auto-dm", match: under("/social/auto-dm"), permission: "social:auto_dm", feature: "social" },
  { id: "ads", group: "publishing", mode: "public", status: "planned", label: "ads", icon: Target, path: "/social/ads", match: under("/social/ads") },
  { id: "socialAnalytics", group: "publishing", mode: "public", label: "socialAnalytics", icon: ChartNoAxesCombined, path: "/social/analytics", match: under("/social/analytics"), permission: "social:analytics", feature: "social" },
  // Public > Newsletter, Website.
  { id: "newsletterCampaigns", group: "newsletter", mode: "public", status: "planned", label: "newsletterCampaigns", icon: MailPlus, path: "/newsletter", match: under("/newsletter") },
  { id: "newsletterAudience", group: "newsletter", mode: "public", status: "planned", label: "audience", icon: ContactRound, path: "/newsletter/audience", match: under("/newsletter/audience") },
  { id: "signupForms", group: "newsletter", mode: "public", status: "planned", label: "signupForms", icon: ClipboardPen, path: "/newsletter/forms", match: under("/newsletter/forms") },
  { id: "newsletterAnalytics", group: "newsletter", mode: "public", status: "planned", label: "newsletterAnalytics", icon: ChartLine, path: "/newsletter/analytics", match: under("/newsletter/analytics") },
  { id: "linkInBio", group: "website", mode: "public", status: "planned", label: "linkInBio", icon: Link2, path: "/link-in-bio", match: under("/link-in-bio") },
  { id: "articles", group: "website", mode: "public", status: "planned", label: "articles", icon: Newspaper, path: "/articles", match: under("/articles") },
  { id: "website", group: "website", mode: "public", status: "planned", label: "websiteBuilder", icon: LayoutTemplate, path: "/website", match: under("/website") },
  // Public > Community. ADR 0013: every ministry role lists communities; owners/admins edit (enforced by the API). Hidden until activated.
  { id: "communities", group: "community", legacyGroup: "workspace", mode: "public", label: "communities", icon: MessagesSquare, path: "/communities", match: has("/communities"), permission: "communities:read", feature: "communities" },
  { id: "live", group: "community", mode: "public", status: "planned", label: "live", icon: Podcast, path: "/live", match: under("/live") },
  // Public > Courses and products (their own group: sold or given outside a community too).
  { id: "courses", group: "commerce", mode: "public", status: "planned", label: "courses", icon: BookOpen, path: "/courses", match: under("/courses") },
  { id: "products", group: "commerce", mode: "public", status: "planned", label: "products", icon: Package, path: "/products", match: under("/products") },
  { id: "coaching", group: "commerce", mode: "public", status: "planned", label: "coaching", icon: CalendarClock, path: "/coaching", match: under("/coaching") },
  { id: "coupons", group: "commerce", mode: "public", status: "planned", label: "coupons", icon: TicketPercent, path: "/coupons", match: under("/coupons") },
  { id: "assistant", group: "chat", mode: "assistant", status: "planned", label: "assistant", icon: Bot, path: "/assistant", match: under("/assistant") },
  // Settings entries are not in the sidebar: the Settings pop-up (profile menu) links to their routes, and they keep their breadcrumb and mode.
  { id: "socialAccounts", group: "settings", mode: "operations", label: "socialAccounts", icon: UserCog, path: "/social/accounts", match: under("/social/accounts"), permission: "social:connect", feature: "social" },
  { id: "crmFields", group: "settings", mode: "operations", label: "crmFields", icon: SlidersHorizontal, path: "/crm/settings/fields", match: has("/crm/settings/fields") },
  { id: "pipelineSettings", group: "settings", mode: "operations", label: "pipelineSettings", icon: Workflow, path: "/crm/settings/pipelines", match: has("/crm/settings/pipelines") },
  { id: "appearance", group: "settings", mode: "operations", label: "appearance", icon: Palette, path: "/appearance", match: (p) => p.endsWith("/appearance") },
  // Every member can open it; only owners and admins can change the ministry type (enforced by the API).
  { id: "ministrySettings", group: "settings", mode: "operations", label: "ministrySettings", icon: Settings, path: "/settings", match: (p) => p.endsWith("/settings") },
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

/** Where a contextual sidebar's back arrow goes: the route and label key of the entry named by `exitTo`, or null when the entry has none. */
export function contextExit(tenantId: string, entryId: string, entries: readonly NavEntry[] = navEntries): { href: string; label: NavLabelKey } | null {
  const target = entries.find((entry) => entry.id === entries.find((item) => item.id === entryId)?.exitTo);
  return target ? { href: `/workspaces/${tenantId}${target.path}`, label: target.label } : null;
}
