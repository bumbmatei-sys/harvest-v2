import { describe, expect, it } from "vitest";
import { Building } from "lucide-react";
import { contextExit, groupsByMode, modeAvailability, navEntries, navModes, resolveMode, resolveModeNavigation, resolveNavigation, sectionLabel, type NavEntry, type NavMode } from "../../src/lib/navigation";
import { audiences } from "../../src/lib/audience";
import before from "./fixtures/navigation-before-modes.json";

const tenantId = "00000000-0000-4000-8000-000000000001";
const root = `/workspaces/${tenantId}`;
const shape = (role?: string) => resolveNavigation({ tenantId, role, pathname: root }).map((group) => [group.id, group.items.map((item) => item.id)]);
// The Settings group left the sidebar (20 Nov): its entries stay in the registry for routes and breadcrumbs, and the Settings pop-up links to them.
const writers = [["crm", ["people", "companies", "pipelines", "tasks", "crmReports", "imports"]], ["workspace", ["campaigns", "followUp", "files"]]];
// Forms sits directly above Imports (founder, 21 Nov).
const withForms = ["people", "companies", "pipelines", "tasks", "crmReports", "crmForms", "imports"];
const settingsIds = ["socialAccounts", "crmFields", "pipelineSettings", "appearance", "ministrySettings"];

// The breadcrumb chain AppShell used before the registry (plus the Ministry settings route from PR B), kept as the parity oracle.
function legacySection(pathname: string) {
  return pathname.includes("/campaigns") ? "campaigns" : pathname.includes("/connect/follow-up") ? "followUp" : pathname.includes("/crm/people") || pathname.includes("/contacts") ? "people" : pathname.includes("/crm/companies") ? "companies" : pathname.includes("/files") ? "files" : pathname.includes("/crm/tasks") ? "tasks" : pathname.includes("/crm/imports") ? "imports" : pathname.includes("/crm/settings/pipelines") ? "pipelineSettings" : pathname.includes("/crm/pipelines") || pathname.includes("/crm/deals") ? "pipelines" : pathname.includes("/crm/settings/fields") ? "crmFields" : pathname.endsWith("/appearance") ? "appearance" : pathname.endsWith("/settings") ? "ministrySettings" : null;
}
const id = "00000000-0000-4000-8000-0000000000aa";
const routes = ["", "/appearance", "/campaigns", `/campaigns/${id}`, `/campaigns/${id}/connect`, `/campaigns/${id}/connect/${id}/landing`, `/campaigns/${id}/connect/${id}/present`, `/campaigns/${id}/connect/${id}/preview`, `/campaigns/${id}/connect/forms`, "/contacts", `/contacts/${id}`, "/crm/companies", `/crm/companies/${id}`, `/crm/deals/${id}`, "/crm/imports", `/crm/imports/${id}`, "/crm/people", `/crm/people/${id}`, "/crm/pipelines", `/crm/pipelines/${id}`, "/crm/settings/fields", "/crm/settings/pipelines", "/crm/tasks", "/connect/follow-up", `/connect/follow-up/${id}`, "/files", "/settings"].map((path) => `${root}${path}`);

describe("module registry parity", () => {
  it.each(["owner", "admin"])("shows today's sidebar to %s, plus Forms", (role) => { expect(shape(role)).toEqual([["crm", withForms], writers[1]]); });
  it("shows today's sidebar to member (no Forms)", () => { expect(shape("member")).toEqual(writers); });
  it("hides Imports from viewers and from an unknown membership", () => {
    const readers = [["crm", ["people", "companies", "pipelines", "tasks"]], ["workspace", ["campaigns", "files"]]];
    expect(shape("viewer")).toEqual(readers);
    expect(shape(undefined)).toEqual(readers);
  });
  it("keeps every route, label and group label", () => {
    const groups = resolveNavigation({ tenantId, role: "owner", pathname: root });
    expect(groups.map((group) => group.label)).toEqual(["crm", "workspace"]);
    expect(groups.flatMap((group) => group.items.map((item) => [item.label, item.href]))).toEqual([
      ["people", `${root}/crm/people`], ["companies", `${root}/crm/companies`], ["pipelines", `${root}/crm/pipelines`], ["tasks", `${root}/crm/tasks`], ["reports", `${root}/crm/reports`], ["forms", `${root}/crm/forms`], ["imports", `${root}/crm/imports`],
      ["campaigns", `${root}/campaigns`], ["followUp", `${root}/connect/follow-up`], ["files", `${root}/files`],
    ]);
  });
  it.each(routes)("marks at most one item active and keeps the breadcrumb for %s", (pathname) => {
    const active = resolveNavigation({ tenantId, role: "owner", pathname }).flatMap((group) => group.items.filter((item) => item.active).map((item) => item.id));
    expect(active.length).toBeLessThanOrEqual(1);
    expect(sectionLabel(pathname)).toBe(legacySection(pathname));
  });
  it("treats deals as Pipelines and pipeline settings separately", () => {
    const active = (pathname: string) => resolveNavigation({ tenantId, role: "owner", pathname }).flatMap((group) => group.items.filter((item) => item.active).map((item) => item.id));
    expect(active(`${root}/crm/deals/${id}`)).toEqual(["pipelines"]);
    // Pipeline settings is a pop-up destination now: no sidebar row lights up, and the breadcrumb still names it.
    expect(active(`${root}/crm/settings/pipelines`)).toEqual([]);
    expect(sectionLabel(`${root}/crm/settings/pipelines`)).toBe("pipelineSettings");
    expect(active(`${root}/contacts/${id}`)).toEqual([]);
  });
  it("ships no audience-specific entries", () => {
    expect(navEntries.every((entry) => !entry.audiences && !entry.audienceLabels)).toBe(true);
  });
});

describe("audience rules (fixtures)", () => {
  const fixtures: NavEntry[] = [
    { id: "everyone", group: "workspace", mode: "operations", label: "files", icon: Building, path: "/everyone", match: (p) => p.endsWith("/everyone") },
    { id: "churchOnly", group: "workspace", mode: "operations", label: "campaigns", icon: Building, path: "/church", match: (p) => p.endsWith("/church"), audiences: ["church"] },
    { id: "renamed", group: "workspace", mode: "operations", label: "appearance", icon: Building, path: "/renamed", match: (p) => p.endsWith("/renamed"), audienceLabels: { evangelist_missionary: "profile" } },
  ];
  const ids = (audience: Parameters<typeof resolveNavigation>[0]["audience"]) => resolveNavigation({ tenantId, role: "owner", audience, pathname: root }, fixtures).flatMap((group) => group.items.map((item) => item.id));
  it("shows unrestricted entries to an unspecified audience", () => { expect(ids(null)).toEqual(["everyone", "renamed"]); });
  it("shows restricted entries only to their audience", () => {
    expect(ids("church")).toEqual(["everyone", "churchOnly", "renamed"]);
    expect(ids("ministry_nonprofit")).toEqual(["everyone", "renamed"]);
  });
  it("overrides a label for one audience only", () => {
    const label = (audience: Parameters<typeof resolveNavigation>[0]["audience"]) => resolveNavigation({ tenantId, role: "owner", audience, pathname: root }, fixtures).flatMap((group) => group.items).find((item) => item.id === "renamed")?.label;
    expect(label("evangelist_missionary")).toBe("profile");
    expect(label("church")).toBe("appearance");
    expect(sectionLabel(`${root}/renamed`, "evangelist_missionary", fixtures)).toBe("profile");
  });
  it("drops a group with no visible entries", () => {
    expect(resolveNavigation({ tenantId, role: "owner", audience: "ministry_nonprofit", pathname: root }, [fixtures[1]])).toEqual([]);
  });
});

describe("three-mode registry (slice 1)", () => {
  const roles = ["owner", "admin", "member", "viewer"];
  const audienceCases = [...audiences, null];
  it("gives every entry a known mode, a group of that mode and a unique id", () => {
    expect(new Set(navEntries.map((entry) => entry.id)).size).toBe(navEntries.length);
    for (const entry of navEntries) {
      expect(navModes).toContain(entry.mode);
      // Settings entries belong to no sidebar group on purpose: the Settings pop-up links to them.
      if (entry.group !== "settings") expect(groupsByMode[entry.mode].map((group) => group.id)).toContain(entry.group);
    }
  });
  it("assigns the founder's modes", () => {
    const mode = (id: string) => navEntries.find((entry) => entry.id === id)?.mode;
    for (const id of ["people", "companies", "pipelines", "tasks", "crmReports", "imports", "crmForms", "campaigns", "followUp", "files", "crmFields", "pipelineSettings", "appearance", "ministrySettings"]) expect(mode(id)).toBe("operations");
    for (const id of ["communities", "planner", "inbox", "autoDm", "articles", "website", "linkInBio", "newsletterAnalytics", "newsletterCampaigns", "newsletterAudience", "newsletterSender", "discover", "products", "courses", "live"]) expect(mode(id)).toBe("public");
    expect(mode("assistant")).toBe("assistant");
    expect(navEntries.filter((entry) => entry.group === "settings").every((entry) => entry.mode === "operations")).toBe(true);
  });
  it("reserves not-yet-built modules as planned, including blog articles", () => {
    const planned = navEntries.filter((entry) => entry.status === "planned").map((entry) => entry.id);
    expect(planned).toEqual(expect.arrayContaining(["articles", "ads", "website", "products", "courses", "coaching", "coupons", "live", "discover", "assistant", "responses", "connectLinks", "forms", "spreadsheets", "givingOverview", "donations", "fundraising", "pledges", "donors", "funds", "givingPage", "volunteers", "livestream", "churchProfile"]));
    expect(navEntries.filter((entry) => entry.status !== "planned").map((entry) => entry.id)).toEqual(["people", "companies", "pipelines", "crmReports", "crmForms", "imports", "mail", "calendar", "tasks", "documents", "campaigns", "followUp", "events", "files", "planner", "inbox", "autoDm", "socialAnalytics", "newsletterAnalytics", "newsletterCampaigns", "newsletterAutomations", "newsletterAudience", "signupForms", "newsletterSender", "linkInBio", "communities", "socialAccounts", "crmFields", "pipelineSettings", "appearance", "ministrySettings"]);
  });
  it("never renders, links or labels a planned entry", () => {
    const plannedIds = new Set(navEntries.filter((entry) => entry.status === "planned").map((entry) => entry.id));
    for (const role of roles) for (const audience of audienceCases) {
      const viewer = { tenantId, role, audience, features: ["communities" as const] };
      const legacy = resolveNavigation({ ...viewer, pathname: root }).flatMap((group) => group.items);
      expect(legacy.some((item) => plannedIds.has(item.id))).toBe(false);
      for (const mode of navModes) expect(resolveModeNavigation({ ...viewer, pathname: root, mode }).groups.flatMap((group) => group.items).some((item) => plannedIds.has(item.id))).toBe(false);
    }
    for (const entry of navEntries.filter((item) => item.status === "planned")) expect(sectionLabel(`${root}${entry.path}`)).toBeNull();
  });
  // Forms (crmForms, owner/admin) and Reports (crmReports) were added after this fixture was taken; it is compared on its own in the module parity tests above.
  const snapshot = (role: string, audience: (typeof audiences)[number] | null, communities: boolean) =>
    resolveNavigation({ tenantId: "t", role, audience, pathname: "/workspaces/t", features: communities ? ["communities"] : [] }).map((group) => [group.id, group.label, group.items.filter((item) => item.id !== "crmForms" && item.id !== "crmReports").map((item) => `${item.id}=${item.label}=${item.href}`)]);
  it.each(roles.flatMap((role) => audienceCases.flatMap((audience) => [false, true].map((communities) => [role, audience, communities] as const))))("keeps the sidebar link set of origin/main for %s, %s, communities %s", (role, audience, communities) => {
    expect(snapshot(role, audience, communities)).toEqual((before as Record<string, unknown>)[`${role}|${audience}|${communities ? "communities" : "base"}`]);
  });
  it("filters per mode by role, audience and feature", () => {
    const ids = (mode: NavMode, extra: Partial<Parameters<typeof resolveModeNavigation>[0]> = {}) => resolveModeNavigation({ tenantId, role: "owner", pathname: root, mode, ...extra }).groups.flatMap((group) => group.items.map((item) => item.id));
    expect(ids("operations")).toEqual(["tasks", "files", "people", "companies", "pipelines", "crmReports", "crmForms", "imports", "followUp", "campaigns"]);
    // Email and Calendar need the Office feature and the owner or admin role; they lead the Office group.
    expect(ids("operations", { features: ["office"] })).toEqual(["mail", "calendar", "tasks", "files", "people", "companies", "pipelines", "crmReports", "crmForms", "imports", "followUp", "campaigns"]);
    for (const role of ["member", "viewer"]) for (const id of ["mail", "calendar"]) expect(ids("operations", { features: ["office"], role })).not.toContain(id);
    expect(ids("operations", { features: ["office"], role: "admin" })).toEqual(expect.arrayContaining(["mail", "calendar"]));
    expect(ids("operations")).not.toContain("calendar");
    expect(ids("operations", { role: "viewer" })).not.toContain("imports");
    expect(ids("operations", { role: "viewer" })).not.toContain("followUp");
    expect(ids("public")).toEqual([]);
    expect(ids("public", { features: ["communities"] })).toEqual(["communities"]);
    expect(ids("public", { features: ["communities"], role: undefined })).toEqual([]);
    expect(ids("assistant")).toEqual([]);
  });
  it("reports an empty mode as unavailable", () => {
    expect(modeAvailability({ role: "owner" })).toEqual({ operations: true, public: false, assistant: false });
    expect(modeAvailability({ role: "owner", features: ["communities"] })).toEqual({ operations: true, public: true, assistant: false });
    expect(modeAvailability({ role: "owner" }, [{ ...navEntries[0], mode: "assistant", status: "live" }])).toEqual({ operations: false, public: false, assistant: true });
    expect(modeAvailability({ role: "owner" }, [{ ...navEntries[0], status: "planned" }]).operations).toBe(false);
  });
  it("derives the mode from the path, including nested and dynamic routes", () => {
    const mode = (path: string, choice?: NavMode | null) => resolveMode({ pathname: `${root}${path}`, choice });
    for (const path of ["/crm/people", `/crm/people/${id}`, `/contacts/${id}`, `/crm/deals/${id}`, "/crm/settings/fields", "/campaigns", `/campaigns/${id}/connect/${id}/landing`, "/connect/follow-up", `/connect/follow-up/${id}`, "/files", "/appearance", "/settings", "/events", "/connect/responses", "/mail", "/calendar", "/connect/forms", "/docs", "/sheets", "/giving", "/volunteers", "/livestream", "/church-profile"]) expect(mode(path)).toEqual({ mode: "operations", neutral: false });
    for (const path of ["/communities", `/communities/${id}/edit`, "/social/planner", "/social/inbox", "/social/auto-dm", "/articles", `/articles/${id}`, "/link-in-bio", "/newsletter/campaigns", `/newsletter/campaigns/${id}`, "/products", "/discover/manage"]) expect(mode(path)).toEqual({ mode: "public", neutral: false });
    expect(mode("/assistant")).toEqual({ mode: "assistant", neutral: false });
    expect(mode(`/assistant/${id}`)).toEqual({ mode: "assistant", neutral: false });
  });
  it("lets no reserved route capture a live path", () => {
    const owner = (pathname: string) => navEntries.find((entry) => entry.match(pathname) || entry.sectionMatch?.(pathname));
    for (const pathname of routes.filter((route) => route !== root)) expect(owner(pathname)?.status).not.toBe("planned");
    expect(owner(`${root}/connect/follow-up/${id}`)?.id).toBe("followUp");
    expect(owner(`${root}/communities/${id}`)?.id).toBe("communities");
  });
  it("applies a manual choice only on neutral pages", () => {
    expect(resolveMode({ pathname: root, choice: "public" })).toEqual({ mode: "public", neutral: true });
    expect(resolveMode({ pathname: "/profile", choice: "assistant" })).toEqual({ mode: "assistant", neutral: true });
    expect(resolveMode({ pathname: "/workspaces", choice: "public" })).toEqual({ mode: "public", neutral: true });
    expect(resolveMode({ pathname: `${root}/crm/people`, choice: "public" })).toEqual({ mode: "operations", neutral: false });
    expect(resolveMode({ pathname: `${root}/communities`, choice: "operations" })).toEqual({ mode: "public", neutral: false });
    expect(resolveModeNavigation({ tenantId, role: "owner", pathname: `${root}/crm/people`, choice: "public" }).mode).toBe("operations");
  });
  it("falls back to Operations for unknown paths and no choice", () => {
    for (const pathname of ["/", "/profile", "/workspaces", root, `${root}/unknown/page`, "/discover", "/account/welcome"]) expect(resolveMode({ pathname })).toEqual({ mode: "operations", neutral: true });
    expect(resolveMode({ pathname: root, choice: null })).toEqual({ mode: "operations", neutral: true });
    expect(resolveMode({ pathname: root, fallback: "public" }).mode).toBe("public");
  });
  it("marks the active item in a per-mode sidebar", () => {
    const result = resolveModeNavigation({ tenantId, role: "owner", pathname: `${root}/crm/deals/${id}` });
    expect(result.mode).toBe("operations");
    expect(result.groups.flatMap((group) => group.items.filter((item) => item.active).map((item) => item.id))).toEqual(["pipelines"]);
  });
});

describe("contextual sidebar exit", () => {
  it("names the Inbox's back target in the registry, never in the page", () => {
    expect(contextExit(tenantId, "inbox")).toEqual({ href: `/workspaces/${tenantId}/social/planner`, label: "planner" });
    expect(contextExit(tenantId, "mail")).toEqual({ href: `/workspaces/${tenantId}/files`, label: "files" });
    expect(contextExit(tenantId, "planner")).toBeNull();
    expect(contextExit(tenantId, "missing")).toBeNull();
  });
});

describe("sidebar icons", () => {
  it("gives every row and every group header its own icon, across the whole registry", () => {
    const seen = new Map<unknown, string>();
    for (const entry of navEntries) {
      expect(seen.get(entry.icon), `${entry.id} reuses the icon of ${seen.get(entry.icon)}`).toBeUndefined();
      seen.set(entry.icon, `row ${entry.id}`);
    }
    for (const mode of navModes) for (const group of groupsByMode[mode]) {
      if (group.pinned) { expect(group.icon, `${mode} ${group.id} is pinned and has no header`).toBeUndefined(); continue; }
      expect(group.icon, `${mode} group ${group.id} needs an icon`).toBeDefined();
      expect(seen.get(group.icon), `${mode} group ${group.id} reuses the icon of ${seen.get(group.icon)}`).toBeUndefined();
      seen.set(group.icon, `group ${group.id}`);
    }
  });
  it("gives the Social media group its own icon", () => {
    expect(groupsByMode.public.find((group) => group.id === "publishing")?.icon).toBeDefined();
  });
});

describe("approved sidebar structure (20 Nov)", () => {
  const order = (mode: NavMode) => groupsByMode[mode].map((group) => group.id);
  it("orders the Operations groups Office, People, Connect, Ministry, Giving", () => {
    expect(order("operations")).toEqual(["office", "crm", "connect", "workspace", "giving"]);
    expect(groupsByMode.operations.find((group) => group.id === "crm")?.label).toBe("people");
  });
  it("orders the Public groups Discover (pinned), Social media, Newsletter, Website, Community, Courses and products", () => {
    expect(order("public")).toEqual(["discover", "publishing", "newsletter", "website", "community", "commerce"]);
    expect(groupsByMode.public.filter((group) => group.pinned).map((group) => group.id)).toEqual(["discover"]);
  });
  it("lists the planned rows of every group in the approved order", () => {
    const rows = (group: string) => navEntries.filter((entry) => entry.group === group).map((entry) => entry.id);
    expect(rows("office")).toEqual(["mail", "calendar", "tasks", "documents", "spreadsheets", "files"]);
    expect(rows("giving")).toEqual(["givingOverview", "donations", "fundraising", "pledges", "donors", "funds", "givingPage"]);
    expect(rows("publishing")).toEqual(["planner", "inbox", "autoDm", "ads", "socialAnalytics"]);
    expect(rows("newsletter")).toEqual(["newsletterAnalytics", "newsletterCampaigns", "newsletterAutomations", "newsletterAudience", "signupForms", "newsletterSender"]);
    expect(rows("website")).toEqual(["linkInBio", "articles", "website"]);
    expect(rows("community")).toEqual(["communities", "live"]);
    expect(rows("commerce")).toEqual(["courses", "products", "coaching", "coupons"]);
  });
  it("keeps the CRM Campaigns entry off the newsletter routes", () => {
    const campaigns = navEntries.find((entry) => entry.id === "campaigns")!, audience = navEntries.find((entry) => entry.id === "newsletterAudience")!;
    for (const path of ["/workspaces/t/newsletter/analytics", "/workspaces/t/newsletter/campaigns", "/workspaces/t/newsletter/audience", "/workspaces/t/newsletter/audience/list/x"]) expect(campaigns.match(path), path).toBe(false);
    expect(campaigns.match("/workspaces/t/campaigns")).toBe(true);
    for (const path of ["/workspaces/t/newsletter/audience", "/workspaces/t/newsletter/audience/subscribed", "/workspaces/t/newsletter/audience/group/x"]) expect(audience.match(path), path).toBe(true);
    expect(audience).toMatchObject({ group: "newsletter", mode: "public", permission: "newsletter:read", feature: "newsletter" });
  });
  it("makes Analytics the first live Newsletter entry, owner and admin only", () => {
    const analytics = navEntries.find((entry) => entry.id === "newsletterAnalytics")!;
    expect(analytics).toMatchObject({ group: "newsletter", mode: "public", permission: "newsletter:analytics", feature: "newsletter", path: "/newsletter/analytics" });
    expect(analytics.status).not.toBe("planned");
    expect(navEntries.filter((entry) => entry.group === "newsletter")[0].id).toBe("newsletterAnalytics");
    expect(analytics.match("/workspaces/t/newsletter/analytics")).toBe(true);
    expect(analytics.match("/workspaces/t/newsletter/campaigns")).toBe(false);
    const visible = (role: string) => resolveModeNavigation({ tenantId, role, features: ["newsletter" as const], pathname: root, mode: "public" }).groups.flatMap((group) => group.items).some((item) => item.id === "newsletterAnalytics");
    expect(visible("owner")).toBe(true); expect(visible("admin")).toBe(true); expect(visible("member")).toBe(false); expect(visible("viewer")).toBe(false);
    const hidden = resolveModeNavigation({ tenantId, role: "owner", features: [], pathname: root, mode: "public" }).groups.flatMap((group) => group.items);
    expect(hidden.some((item) => item.id === "newsletterAnalytics")).toBe(false);
  });
  it("makes Sign-up forms live between Audience and the end of Newsletter, owner and admin only", () => {
    const forms = navEntries.find((entry) => entry.id === "signupForms")!;
    expect(forms).toMatchObject({ group: "newsletter", mode: "public", permission: "newsletter:manage", feature: "newsletter", path: "/newsletter/forms" });
    expect(forms.status).not.toBe("planned");
    const ids = navEntries.filter((entry) => entry.group === "newsletter").map((entry) => entry.id);
    expect(ids.indexOf("signupForms")).toBe(ids.indexOf("newsletterAudience") + 1);
    for (const path of ["/workspaces/t/newsletter/forms", "/workspaces/t/newsletter/forms/abc"]) expect(forms.match(path), path).toBe(true);
    expect(forms.match("/workspaces/t/newsletter/audience")).toBe(false);
    const campaigns = navEntries.find((entry) => entry.id === "campaigns")!;
    for (const path of ["/workspaces/t/newsletter/forms", "/workspaces/t/newsletter/forms/abc"]) expect(campaigns.match(path), path).toBe(false);
    const visible = (role: string, features: ("newsletter")[]) => resolveModeNavigation({ tenantId, role, features, pathname: root, mode: "public" }).groups.flatMap((group) => group.items).some((item) => item.id === "signupForms");
    expect(visible("owner", ["newsletter"])).toBe(true); expect(visible("admin", ["newsletter"])).toBe(true);
    expect(visible("member", ["newsletter"])).toBe(false); expect(visible("viewer", ["newsletter"])).toBe(false); expect(visible("owner", [])).toBe(false);
  });
  it("adds Sender as the last Newsletter entry for owners and admins only", () => {
    const sender = navEntries.find((entry) => entry.id === "newsletterSender")!, campaigns = navEntries.find((entry) => entry.id === "campaigns")!;
    expect(sender).toMatchObject({ group: "newsletter", mode: "public", permission: "newsletter:delivery", feature: "newsletter", path: "/newsletter/sender" });
    for (const path of ["/workspaces/t/newsletter/sender", "/workspaces/t/newsletter/sender/x"]) { expect(sender.match(path), path).toBe(true); expect(campaigns.match(path), path).toBe(false); }
    const visible = (role: string) => resolveModeNavigation({ tenantId, role, features: ["newsletter" as const], pathname: root, mode: "public" }).groups.flatMap((group) => group.items.map((item) => item.id));
    expect(visible("owner")).toContain("newsletterSender"); expect(visible("admin")).toContain("newsletterSender");
    expect(visible("member")).not.toContain("newsletterSender"); expect(visible("viewer")).not.toContain("newsletterSender");
  });
  it("keeps unbuilt groups out of the sidebar", () => {
    const owner = { tenantId, role: "owner", features: ["communities" as const, "events" as const, "social" as const] };
    expect(resolveModeNavigation({ ...owner, pathname: root, mode: "operations" }).groups.map((group) => group.id)).toEqual(["office", "crm", "connect", "workspace"]);
    expect(resolveModeNavigation({ ...owner, pathname: root, mode: "public" }).groups.map((group) => group.id)).toEqual(["publishing", "community"]);
  });
  it("moves Files into Office in the per-mode sidebar and keeps it in Ministry in the single sidebar", () => {
    const owner = { tenantId, role: "owner", pathname: root };
    expect(resolveModeNavigation({ ...owner, mode: "operations" }).groups.find((group) => group.id === "office")?.items.map((item) => item.id)).toEqual(["tasks", "files"]);
    expect(resolveNavigation(owner).find((group) => group.id === "workspace")?.items.map((item) => item.id)).toContain("files");
    // Tasks moved to Office (24 Nov) in the per-mode sidebar and keeps its CRM slot in the single sidebar.
    expect(resolveNavigation(owner).find((group) => group.id === "crm")?.items.map((item) => item.id)).toContain("tasks");
  });
  it("shows Discover as the pinned first row of Public once it is live", () => {
    const live = navEntries.map((entry) => entry.id === "discover" ? { ...entry, status: undefined } : entry);
    const groups = resolveModeNavigation({ tenantId, role: "owner", pathname: root, mode: "public" }, live).groups;
    expect(groups[0]).toMatchObject({ id: "discover", pinned: true });
    expect(groups[0].items.map((item) => item.id)).toEqual(["discover"]);
  });
  it("has no Settings group in any sidebar, and Social accounts is not an Operations row", () => {
    expect(navModes.flatMap((mode) => order(mode))).not.toContain("settings");
    for (const role of ["owner", "admin", "member", "viewer"]) for (const features of [[], ["social" as const, "communities" as const, "events" as const]]) {
      const viewer = { tenantId, role, features, pathname: root };
      const shown = [...resolveNavigation(viewer).flatMap((group) => group.items), ...navModes.flatMap((mode) => resolveModeNavigation({ ...viewer, mode }).groups.flatMap((group) => group.items))].map((item) => item.id);
      for (const id of settingsIds) expect(shown, `${role} ${id}`).not.toContain(id);
    }
  });
  it("keeps every Settings route reachable: its breadcrumb and mode still resolve", () => {
    for (const path of ["/social/accounts", "/crm/settings/fields", "/crm/settings/pipelines", "/appearance", "/settings"]) {
      expect(sectionLabel(`${root}${path}`, null), path).not.toBeNull();
      expect(resolveMode({ pathname: `${root}${path}` }).neutral, path).toBe(false);
    }
  });
});
