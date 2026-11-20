import { describe, expect, it } from "vitest";
import { Building } from "lucide-react";
import { groupsByMode, modeAvailability, navEntries, navModes, resolveMode, resolveModeNavigation, resolveNavigation, sectionLabel, type NavEntry, type NavMode } from "../../src/lib/navigation";
import { audiences } from "../../src/lib/audience";
import before from "./fixtures/navigation-before-modes.json";

const tenantId = "00000000-0000-4000-8000-000000000001";
const root = `/workspaces/${tenantId}`;
const shape = (role?: string) => resolveNavigation({ tenantId, role, pathname: root }).map((group) => [group.id, group.items.map((item) => item.id)]);
const writers = [["crm", ["people", "companies", "pipelines", "tasks", "imports"]], ["workspace", ["campaigns", "followUp", "files"]], ["settings", ["crmFields", "pipelineSettings", "appearance", "ministrySettings"]]];

// The breadcrumb chain AppShell used before the registry (plus the Ministry settings route from PR B), kept as the parity oracle.
function legacySection(pathname: string) {
  return pathname.includes("/campaigns") ? "campaigns" : pathname.includes("/connect/follow-up") ? "followUp" : pathname.includes("/crm/people") || pathname.includes("/contacts") ? "people" : pathname.includes("/crm/companies") ? "companies" : pathname.includes("/files") ? "files" : pathname.includes("/crm/tasks") ? "tasks" : pathname.includes("/crm/imports") ? "imports" : pathname.includes("/crm/settings/pipelines") ? "pipelineSettings" : pathname.includes("/crm/pipelines") || pathname.includes("/crm/deals") ? "pipelines" : pathname.includes("/crm/settings/fields") ? "crmFields" : pathname.endsWith("/appearance") ? "appearance" : pathname.endsWith("/settings") ? "ministrySettings" : null;
}
const id = "00000000-0000-4000-8000-0000000000aa";
const routes = ["", "/appearance", "/campaigns", `/campaigns/${id}`, `/campaigns/${id}/connect`, `/campaigns/${id}/connect/${id}/landing`, `/campaigns/${id}/connect/${id}/present`, `/campaigns/${id}/connect/${id}/preview`, `/campaigns/${id}/connect/forms`, "/contacts", `/contacts/${id}`, "/crm/companies", `/crm/companies/${id}`, `/crm/deals/${id}`, "/crm/imports", `/crm/imports/${id}`, "/crm/people", `/crm/people/${id}`, "/crm/pipelines", `/crm/pipelines/${id}`, "/crm/settings/fields", "/crm/settings/pipelines", "/crm/tasks", "/connect/follow-up", `/connect/follow-up/${id}`, "/files", "/settings"].map((path) => `${root}${path}`);

describe("module registry parity", () => {
  it.each(["owner", "admin", "member"])("shows today's sidebar to %s", (role) => { expect(shape(role)).toEqual(writers); });
  it("hides Imports from viewers and from an unknown membership", () => {
    const readers = [["crm", ["people", "companies", "pipelines", "tasks"]], ["workspace", ["campaigns", "files"]], writers[2]];
    expect(shape("viewer")).toEqual(readers);
    expect(shape(undefined)).toEqual(readers);
  });
  it("keeps every route, label and group label", () => {
    const groups = resolveNavigation({ tenantId, role: "owner", pathname: root });
    expect(groups.map((group) => group.label)).toEqual(["crm", "workspace", "settings"]);
    expect(groups.flatMap((group) => group.items.map((item) => [item.label, item.href]))).toEqual([
      ["people", `${root}/crm/people`], ["companies", `${root}/crm/companies`], ["pipelines", `${root}/crm/pipelines`], ["tasks", `${root}/crm/tasks`], ["imports", `${root}/crm/imports`],
      ["campaigns", `${root}/campaigns`], ["followUp", `${root}/connect/follow-up`], ["files", `${root}/files`],
      ["crmFields", `${root}/crm/settings/fields`], ["pipelineSettings", `${root}/crm/settings/pipelines`], ["appearance", `${root}/appearance`], ["ministrySettings", `${root}/settings`],
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
    expect(active(`${root}/crm/settings/pipelines`)).toEqual(["pipelineSettings"]);
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
    { id: "renamed", group: "settings", mode: "operations", label: "appearance", icon: Building, path: "/renamed", match: (p) => p.endsWith("/renamed"), audienceLabels: { evangelist_missionary: "profile" } },
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
      expect(groupsByMode[entry.mode].map((group) => group.id)).toContain(entry.group);
    }
  });
  it("assigns the founder's modes", () => {
    const mode = (id: string) => navEntries.find((entry) => entry.id === id)?.mode;
    for (const id of ["people", "companies", "pipelines", "tasks", "imports", "campaigns", "followUp", "files", "crmFields", "pipelineSettings", "appearance", "ministrySettings"]) expect(mode(id)).toBe("operations");
    for (const id of ["communities", "composer", "planner", "inbox", "autoDm", "articles", "website", "linkInBio", "newsletter", "discover", "products"]) expect(mode(id)).toBe("public");
    expect(mode("assistant")).toBe("assistant");
    expect(navEntries.filter((entry) => entry.group === "settings").every((entry) => entry.mode === "operations")).toBe(true);
    expect(groupsByMode.operations.at(-1)?.id).toBe("settings");
  });
  it("reserves not-yet-built modules as planned, including blog articles", () => {
    const planned = navEntries.filter((entry) => entry.status === "planned").map((entry) => entry.id);
    expect(planned).toEqual(expect.arrayContaining(["articles", "inbox", "autoDm", "website", "linkInBio", "newsletter", "products", "discover", "assistant", "responses", "connectLinks", "forms", "mail", "calendar", "documents", "spreadsheets", "giving", "volunteers", "livestream", "churchProfile"]));
    expect(navEntries.filter((entry) => entry.status !== "planned").map((entry) => entry.id)).toEqual(["people", "companies", "pipelines", "tasks", "imports", "campaigns", "followUp", "events", "files", "composer", "planner", "socialAccounts", "communities", "crmFields", "pipelineSettings", "appearance", "ministrySettings"]);
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
  const snapshot = (role: string, audience: (typeof audiences)[number] | null, communities: boolean) =>
    resolveNavigation({ tenantId: "t", role, audience, pathname: "/workspaces/t", features: communities ? ["communities"] : [] }).map((group) => [group.id, group.label, group.items.map((item) => `${item.id}=${item.label}=${item.href}`)]);
  it.each(roles.flatMap((role) => audienceCases.flatMap((audience) => [false, true].map((communities) => [role, audience, communities] as const))))("keeps the sidebar link set of origin/main for %s, %s, communities %s", (role, audience, communities) => {
    expect(snapshot(role, audience, communities)).toEqual((before as Record<string, unknown>)[`${role}|${audience}|${communities ? "communities" : "base"}`]);
  });
  it("filters per mode by role, audience and feature", () => {
    const ids = (mode: NavMode, extra: Partial<Parameters<typeof resolveModeNavigation>[0]> = {}) => resolveModeNavigation({ tenantId, role: "owner", pathname: root, mode, ...extra }).groups.flatMap((group) => group.items.map((item) => item.id));
    expect(ids("operations")).toEqual(["people", "companies", "pipelines", "tasks", "imports", "followUp", "campaigns", "files", "crmFields", "pipelineSettings", "appearance", "ministrySettings"]);
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
    for (const path of ["/communities", `/communities/${id}/edit`, "/social/planner", "/inbox/auto-dm", "/articles", `/articles/${id}`, "/link-in-bio", "/newsletter", "/products", "/discover/manage"]) expect(mode(path)).toEqual({ mode: "public", neutral: false });
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
