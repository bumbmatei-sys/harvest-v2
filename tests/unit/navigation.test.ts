import { describe, expect, it } from "vitest";
import { Building } from "lucide-react";
import { navEntries, resolveNavigation, sectionLabel, type NavEntry } from "../../src/lib/navigation";

const tenantId = "00000000-0000-4000-8000-000000000001";
const root = `/workspaces/${tenantId}`;
const shape = (role?: string) => resolveNavigation({ tenantId, role, pathname: root }).map((group) => [group.id, group.items.map((item) => item.id)]);
const writers = [["crm", ["people", "companies", "pipelines", "tasks", "imports"]], ["workspace", ["campaigns", "files"]], ["settings", ["crmFields", "pipelineSettings", "appearance", "ministrySettings"]]];

// The breadcrumb chain AppShell used before the registry (plus the Ministry settings route from PR B), kept as the parity oracle.
function legacySection(pathname: string) {
  return pathname.includes("/campaigns") ? "campaigns" : pathname.includes("/crm/people") || pathname.includes("/contacts") ? "people" : pathname.includes("/crm/companies") ? "companies" : pathname.includes("/files") ? "files" : pathname.includes("/crm/tasks") ? "tasks" : pathname.includes("/crm/imports") ? "imports" : pathname.includes("/crm/settings/pipelines") ? "pipelineSettings" : pathname.includes("/crm/pipelines") || pathname.includes("/crm/deals") ? "pipelines" : pathname.includes("/crm/settings/fields") ? "crmFields" : pathname.endsWith("/appearance") ? "appearance" : pathname.endsWith("/settings") ? "ministrySettings" : null;
}
const id = "00000000-0000-4000-8000-0000000000aa";
const routes = ["", "/appearance", "/campaigns", `/campaigns/${id}`, `/campaigns/${id}/connect`, `/campaigns/${id}/connect/${id}/landing`, `/campaigns/${id}/connect/${id}/present`, `/campaigns/${id}/connect/${id}/preview`, `/campaigns/${id}/connect/forms`, "/contacts", `/contacts/${id}`, "/crm/companies", `/crm/companies/${id}`, `/crm/deals/${id}`, "/crm/imports", `/crm/imports/${id}`, "/crm/people", `/crm/people/${id}`, "/crm/pipelines", `/crm/pipelines/${id}`, "/crm/settings/fields", "/crm/settings/pipelines", "/crm/tasks", "/files", "/settings"].map((path) => `${root}${path}`);

describe("module registry parity", () => {
  it.each(["owner", "admin", "member"])("shows today's sidebar to %s", (role) => { expect(shape(role)).toEqual(writers); });
  it("hides Imports from viewers and from an unknown membership", () => {
    const readers = [["crm", ["people", "companies", "pipelines", "tasks"]], ...writers.slice(1)];
    expect(shape("viewer")).toEqual(readers);
    expect(shape(undefined)).toEqual(readers);
  });
  it("keeps every route, label and group label", () => {
    const groups = resolveNavigation({ tenantId, role: "owner", pathname: root });
    expect(groups.map((group) => group.label)).toEqual(["crm", "workspace", "settings"]);
    expect(groups.flatMap((group) => group.items.map((item) => [item.label, item.href]))).toEqual([
      ["people", `${root}/crm/people`], ["companies", `${root}/crm/companies`], ["pipelines", `${root}/crm/pipelines`], ["tasks", `${root}/crm/tasks`], ["imports", `${root}/crm/imports`],
      ["campaigns", `${root}/campaigns`], ["files", `${root}/files`],
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
    { id: "everyone", group: "workspace", label: "files", icon: Building, path: "/everyone", match: (p) => p.endsWith("/everyone") },
    { id: "churchOnly", group: "workspace", label: "campaigns", icon: Building, path: "/church", match: (p) => p.endsWith("/church"), audiences: ["church"] },
    { id: "renamed", group: "settings", label: "appearance", icon: Building, path: "/renamed", match: (p) => p.endsWith("/renamed"), audienceLabels: { evangelist_missionary: "profile" } },
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
