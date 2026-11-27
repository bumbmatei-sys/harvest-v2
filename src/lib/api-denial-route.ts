// Return only fixed route segments and parameter placeholders. A request path is never logged.
const apiAreas = ["account", "auth", "catalog", "communities", "connect", "discover", "files", "health", "jobs", "newsletter", "platform", "qa", "webhooks", "workspaces"];
const workspaceAreas = ["ads", "bio", "blog", "campaigns", "catalog", "communities", "companies", "contacts", "crm", "files", "jobs", "members", "newsletter", "office", "ownership-transfer", "rights-requests", "settings", "social"];
const contactActions = ["consents", "companies", "export", "merge", "sources", "tasks"];

export const apiDenialRouteHeader = "x-harvest-api-denial-route";

export function apiDenialRoute(pathname: string) {
  const [, api, area, tenant, section, id, action] = pathname.split("/");
  if (api !== "api") return null;
  if (area === "files" && tenant === "transfer") return "/api/files/transfer";
  if (area !== "workspaces") return apiAreas.includes(area) ? `/api/${area}` : "/api/:route";
  if (!tenant) return "/api/workspaces";
  const root = "/api/workspaces/:tenantId";
  if (!section) return root;
  if (!workspaceAreas.includes(section)) return `${root}/:area`;
  const route = `${root}/${section}`;
  if (section !== "contacts" || !id) return route;
  if (id === "export" || id === "merge") return `${route}/${id}`;
  return `${route}/:contactId${contactActions.includes(action) ? `/${action}` : ""}`;
}
