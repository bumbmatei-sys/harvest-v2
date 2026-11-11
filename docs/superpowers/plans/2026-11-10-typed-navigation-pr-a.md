# Typed Module Navigation (PR A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded sidebar in `AppShell` with one typed module registry and a pure resolver, with exactly the same items, routes, labels, icons, active states and breadcrumb section as today.

**Architecture:** Pure role rules move to a dependency-free `src/lib/permissions.ts` (re-exported by `src/server/permissions.ts`, so every existing import keeps working). `src/lib/navigation.ts` holds the registry and `resolveNavigation` / `sectionLabel`. `AppShell` renders the resolver's groups. The server keeps enforcing every permission; the sidebar is presentation.

**Tech Stack:** Next.js App Router, React 19, TypeScript, next-intl, shadcn Sidebar, lucide-react, Vitest (unit project, node env), Playwright.

Spec: `docs/superpowers/specs/2026-11-10-audience-typed-navigation-design.md` (PR A section). PR B (audience) and PR C (workspace → ministry wording) get their own plans after PR A is reviewed.

## Global Constraints

- No behavior change: every current sidebar item keeps its route, label, icon, order, group and active behavior; the breadcrumb section keeps its labels.
- No migration, no new dependency, no new user-facing string.
- "Imports hidden from viewers" becomes the `crm:import` permission (owner, admin, member), the same set of roles.
- No audience-specific entries ship; audience filtering and label overrides are proven with test fixtures only.
- Copy comes from `messages/en.json` (`ComponentsAppShell`); source guards forbid hard-coded JSX copy and component colors.
- 44px tap targets below `lg`, full-width layout, light/dark tokens unchanged (the shell markup and classes are not restyled).
- No force pushes; no merge or deployment without the founder's explicit approval.

---

### Task 1: Pure permission rules shared by server and client

**Files:**
- Create: `src/lib/permissions.ts`
- Modify: `src/server/permissions.ts` (whole file)
- Test: `tests/unit/permissions.test.ts`

**Interfaces:**
- Produces: `src/lib/permissions.ts` exports `roleIds`, `Role`, `Permission`, `can(role: string, permission: Permission): boolean`. `src/server/permissions.ts` re-exports the same bindings and keeps `AccessError`, `requirePermission`.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/permissions.test.ts`:

```ts
import { can as libCan, roleIds as libRoleIds } from "../../src/lib/permissions";
import { roleIds } from "../../src/server/permissions";
describe("shared permission rules", () => {
  it("server and client use the same rule function and roles", () => {
    expect(can).toBe(libCan);
    expect(roleIds).toBe(libRoleIds);
  });
  it("keeps imports for writers only", () => {
    expect(["owner", "admin", "member", "viewer"].map((role) => libCan(role, "crm:import"))).toEqual([true, true, true, false]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/permissions.test.ts`
Expected: FAIL, cannot resolve `../../src/lib/permissions`.

- [ ] **Step 3: Create `src/lib/permissions.ts`** (move the rules verbatim, no imports):

```ts
// Pure role → permission rules. No imports, so server code and client components share one source of truth.
export const roleIds = ["owner", "admin", "member", "viewer"] as const;
export type Role = typeof roleIds[number];
export type Permission = "workspace:read" | "members:write" | "roles:write" | "contacts:read" | "contacts:write" | "settings:write" | "contacts:erase" | "jobs:read" | "jobs:operate" | "companies:read" | "companies:write" | "crm:fields_write" | "opportunities:read" | "opportunities:write" | "crm:pipelines_write" | "tasks:read" | "tasks:write" | "notes:read" | "notes:write"
  // CRM-06: imports and exports run for writers; merging and the sensitive export columns are owner/admin.
  | "campaigns:read" | "campaigns:write" | "crm:import" | "crm:export" | "crm:export_sensitive" | "contacts:merge"
  // CRM-08: outbound webhook endpoints are owner/admin configuration.
  | "webhooks:manage"
  // HC-02: restricted pending Connect responses (metadata, withdrawal, erasure, retention) are owner/admin.
  | "connect:privacy"
  // HC-03: publishing, disabling, rotating and archiving a public QR/short-URL link is owner/admin,
  // like publishing Forms versions and privacy notices. Drafts, preview and export use campaigns:write.
  | "connect:publish" | "contacts:sources_read";
export function can(role: string, permission: Permission): boolean {
  if (permission === "workspace:read" || permission === "contacts:read" || permission === "companies:read" || permission === "opportunities:read" || permission === "tasks:read" || permission === "notes:read" || permission === "campaigns:read") return roleIds.includes(role as Role);
  if (permission === "contacts:write" || permission === "companies:write" || permission === "opportunities:write" || permission === "tasks:write" || permission === "notes:write"
    || permission === "campaigns:write" || permission === "crm:import" || permission === "crm:export") return role === "owner" || role === "admin" || role === "member";
  return role === "owner" || role === "admin";
}
```

- [ ] **Step 4: Replace `src/server/permissions.ts`** with:

```ts
import { message } from "../i18n/messages";
import { can, type Permission } from "../lib/permissions";
export { can, roleIds, type Permission, type Role } from "../lib/permissions";
export class AccessError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 429, message: string, public details?: Record<string, string | number>) { super(message); }
}
export function requirePermission(role: string, permission: Permission) {
  if (!can(role, permission)) throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run --project unit tests/unit/permissions.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors (all existing `@/server/permissions` imports still resolve).

- [ ] **Step 6: Commit**

```bash
git add src/lib/permissions.ts src/server/permissions.ts tests/unit/permissions.test.ts
git commit -m "refactor(auth): share pure role rules between server and client"
```

### Task 2: Typed module registry and resolver

**Files:**
- Create: `src/lib/audience.ts`, `src/lib/navigation.ts`
- Test: `tests/unit/navigation.test.ts`

**Interfaces:**
- Consumes: `can`, `Permission` from `src/lib/permissions.ts` (Task 1).
- Produces:
  - `src/lib/audience.ts`: `audiences` (readonly tuple `"church" | "ministry_nonprofit" | "evangelist_missionary"`), `type Audience`.
  - `src/lib/navigation.ts`: `type NavGroupId = "crm" | "workspace" | "settings"`; `type NavLabelKey` (union of `ComponentsAppShell` keys used); `type NavEntry`; `type NavItem = { id: string; label: NavLabelKey; icon: LucideIcon; href: string; active: boolean }`; `type NavGroup = { id: NavGroupId; label: NavLabelKey; items: NavItem[] }`; `navEntries: readonly NavEntry[]`; `resolveNavigation(input: { tenantId: string; role?: string; audience?: Audience | null; pathname: string }, entries?: readonly NavEntry[]): NavGroup[]`; `sectionLabel(pathname: string, audience?: Audience | null, entries?: readonly NavEntry[]): NavLabelKey | null`.

- [ ] **Step 1: Write the failing tests** — create `tests/unit/navigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Building } from "lucide-react";
import { navEntries, resolveNavigation, sectionLabel, type NavEntry } from "../../src/lib/navigation";

const tenantId = "00000000-0000-4000-8000-000000000001";
const root = `/workspaces/${tenantId}`;
const shape = (role?: string) => resolveNavigation({ tenantId, role, pathname: root }).map((group) => [group.id, group.items.map((item) => item.id)]);
const writers = [["crm", ["people", "companies", "pipelines", "tasks", "imports"]], ["workspace", ["campaigns", "files"]], ["settings", ["crmFields", "pipelineSettings", "appearance"]]];

// The breadcrumb chain AppShell used before the registry, kept here as the parity oracle.
function legacySection(pathname: string) {
  return pathname.includes("/campaigns") ? "campaigns" : pathname.includes("/crm/people") || pathname.includes("/contacts") ? "people" : pathname.includes("/crm/companies") ? "companies" : pathname.includes("/files") ? "files" : pathname.includes("/crm/tasks") ? "tasks" : pathname.includes("/crm/imports") ? "imports" : pathname.includes("/crm/settings/pipelines") ? "pipelineSettings" : pathname.includes("/crm/pipelines") || pathname.includes("/crm/deals") ? "pipelines" : pathname.includes("/crm/settings/fields") ? "crmFields" : pathname.endsWith("/appearance") ? "appearance" : null;
}
const id = "00000000-0000-4000-8000-0000000000aa";
const routes = ["", "/appearance", "/campaigns", `/campaigns/${id}`, `/campaigns/${id}/connect`, `/campaigns/${id}/connect/${id}/landing`, `/campaigns/${id}/connect/${id}/present`, `/campaigns/${id}/connect/${id}/preview`, `/campaigns/${id}/connect/forms`, "/contacts", `/contacts/${id}`, "/crm/companies", `/crm/companies/${id}`, `/crm/deals/${id}`, "/crm/imports", `/crm/imports/${id}`, "/crm/people", `/crm/people/${id}`, "/crm/pipelines", `/crm/pipelines/${id}`, "/crm/settings/fields", "/crm/settings/pipelines", "/crm/tasks", "/files"].map((path) => `${root}${path}`);

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
      ["crmFields", `${root}/crm/settings/fields`], ["pipelineSettings", `${root}/crm/settings/pipelines`], ["appearance", `${root}/appearance`],
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/navigation.test.ts`
Expected: FAIL, cannot resolve `../../src/lib/navigation`.

- [ ] **Step 3: Create `src/lib/audience.ts`**

```ts
// The three Professional V1 audiences. Stored on a workspace in PR B; nullable means unspecified.
export const audiences = ["church", "ministry_nonprofit", "evangelist_missionary"] as const;
export type Audience = typeof audiences[number];
```

- [ ] **Step 4: Create `src/lib/navigation.ts`**

```ts
import { Building, FileUp, Files, Flag, Kanban, ListChecks, Palette, SlidersHorizontal, UsersRound, Workflow, type LucideIcon } from "lucide-react";
import type { Audience } from "./audience";
import { can, type Permission } from "./permissions";

/** Message keys in `ComponentsAppShell` that the sidebar and breadcrumb may show. */
export type NavLabelKey = "crm" | "workspace" | "settings" | "people" | "companies" | "pipelines" | "tasks" | "imports" | "campaigns" | "files" | "crmFields" | "pipelineSettings" | "appearance" | "profile";
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
};
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
  { id: "crmFields", group: "settings", label: "crmFields", icon: SlidersHorizontal, path: "/crm/settings/fields", match: has("/crm/settings/fields") },
  { id: "pipelineSettings", group: "settings", label: "pipelineSettings", icon: Workflow, path: "/crm/settings/pipelines", match: has("/crm/settings/pipelines") },
  { id: "appearance", group: "settings", label: "appearance", icon: Palette, path: "/appearance", match: (p) => p.endsWith("/appearance") },
];

const visibleTo = (entry: NavEntry, role: string | undefined, audience: Audience | null | undefined) =>
  (!entry.permission || (role !== undefined && can(role, entry.permission))) && (!entry.audiences || (audience != null && entry.audiences.includes(audience)));
const labelFor = (entry: NavEntry, audience: Audience | null | undefined) => (audience && entry.audienceLabels?.[audience]) || entry.label;

/** Sidebar groups for one workspace member. Presentation only: routes enforce their own permissions. */
export function resolveNavigation({ tenantId, role, audience, pathname }: { tenantId: string; role?: string; audience?: Audience | null; pathname: string }, entries: readonly NavEntry[] = navEntries): NavGroup[] {
  return groups.map((group) => ({
    ...group,
    items: entries.filter((entry) => entry.group === group.id && visibleTo(entry, role, audience)).map((entry) => ({
      id: entry.id, label: labelFor(entry, audience), icon: entry.icon, href: `/workspaces/${tenantId}${entry.path}`, active: entry.match(pathname),
    })),
  })).filter((group) => group.items.length > 0);
}

/** Breadcrumb section label key for a path, or null when no registry entry owns it. */
export function sectionLabel(pathname: string, audience?: Audience | null, entries: readonly NavEntry[] = navEntries): NavLabelKey | null {
  const entry = entries.find((item) => item.match(pathname) || item.sectionMatch?.(pathname));
  return entry ? labelFor(entry, audience) : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/unit/navigation.test.ts`
Expected: PASS (all parity, route, and fixture tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/audience.ts src/lib/navigation.ts tests/unit/navigation.test.ts
git commit -m "feat(shell): typed module registry with permission- and audience-aware resolver"
```

### Task 3: AppShell renders the registry

**Files:**
- Modify: `src/components/app-shell.tsx` (imports line 7; `section` line 73; navigation groups lines 99-117)

**Interfaces:**
- Consumes: `resolveNavigation`, `sectionLabel` from `src/lib/navigation.ts` (Task 2).

- [ ] **Step 1: Replace the icon import (line 7)** with only the icons the shell still uses itself:

```ts
import { Building2, ChevronRight, ChevronsUpDown, LogOut, Sprout } from "lucide-react";
import { resolveNavigation, sectionLabel } from "@/lib/navigation";
```

- [ ] **Step 2: Replace the `section` chain (line 73)** with:

```ts
  const sectionKey = sectionLabel(pathname);
  const section = pathname === "/profile" ? t("profile") : sectionKey ? t(sectionKey) : t("workspaces");
```

- [ ] **Step 3: Replace the three hard-coded `NavigationGroup` blocks** (from `{selected && <>` through its closing `</>}`) with:

```tsx
          {selected && resolveNavigation({ tenantId: selected, role: workspace?.role, pathname }).map((group) => <NavigationGroup key={group.id} label={t(group.label)}>
            {group.items.map(({ id, href, active, label, icon: Icon }) => <NavigationLink key={id} href={href} active={active} label={t(label)} icon={<Icon aria-hidden="true" />} />)}
          </NavigationGroup>)}
```

- [ ] **Step 4: Run lint, typecheck and unit tests**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: lint and source guards pass (no unused imports, no hard-coded copy), no type errors, all unit tests pass.

- [ ] **Step 5: Run the browser specs that exercise the shell**

Run (with local Postgres and `TEST_DATABASE_URL`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`): `npx playwright test tests/e2e/layout.spec.ts tests/e2e/studio-foundation.spec.ts tests/e2e/crm06.spec.ts tests/e2e/foundation.spec.ts --trace off`
Expected: all pass. `crm06.spec.ts` covers the viewer limits; `layout`/`studio-foundation` cover the sidebar, collapse and mobile sheet.

- [ ] **Step 6: Compare the sidebar visually** — take owner screenshots of `/workspaces/{id}/crm/people` at 1440 and 390 wide, light and dark, before (on `main`) and after; view them and confirm identical items, order, icons and active state.

- [ ] **Step 7: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "refactor(shell): render the sidebar and breadcrumb from the module registry"
```

### Task 4: Records and PR

**Files:**
- Modify: `docs/component-registry.md` (AppShell row; add a Navigation registry row)
- Create: `docs/acceptance/typed-navigation.md`

- [ ] **Step 1: Update `docs/component-registry.md`** — in the `AppShell` row, change "Permission-filtered navigation" to "Navigation rendered from `src/lib/navigation.ts` (permission- and audience-aware)", and add a row after it:

```markdown
| Navigation registry | `src/lib/navigation.ts`: `navEntries`, `resolveNavigation({ tenantId, role, audience, pathname })`, `sectionLabel(pathname, audience)`; consumer: AppShell sidebar and breadcrumb | Items filtered by `can()` (shared `src/lib/permissions.ts`) and optional audiences; per-audience label overrides; groups with no items are omitted; no audience-specific entries ship yet | Harvest |
```

- [ ] **Step 2: Create `docs/acceptance/typed-navigation.md`** recording: goal, parity rule, files changed, exact commands run with results (unit, lint, typecheck, browser specs), screenshots compared, and "no migration, no new strings, no behavior change". Fill each result from the actual runs; do not record a check that was not run.

- [ ] **Step 3: Commit and push (normal push, never force)**

```bash
git add docs/component-registry.md docs/acceptance/typed-navigation.md
git commit -m "docs: record the typed navigation registry"
git push -u origin ccr-6e0472d8-g379wv
```

- [ ] **Step 4: Update draft PR #51** title and description to cover the spec, plan and PR A; run the CircleCI final review on the exact head without the Neon run (no `drizzle/` change); report results. Independent review by a separate fresh session before the founder decides on merge.
