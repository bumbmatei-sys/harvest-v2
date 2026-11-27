/** Derived from Shadcn UI Kit item dashboard-shell8 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 2). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Building2, ChevronRight, LogOut, Settings } from "lucide-react";
import { modeAvailability, resolveMode, resolveModeNavigation, resolveNavigation, sectionLabel, type NavFeature, type NavMode } from "@/lib/navigation";
import { availableModes, displayMode, modeForShortcut, modeSnapshot, rememberMode, subscribeMode } from "@/lib/shell-mode";
import { ModeSwitcher, modeLabelKey } from "@/components/mode-switcher";
import { menuButton } from "@/components/shell-styles";
import { EditingSidebar } from "@/components/editor/editing-sidebar";
import { ContextualSidebar } from "@/components/editor/contextual-sidebar";
import { EditorProvider, useContextualPortal, useEditorSidebar } from "@/components/editor/editor-context";
import type { Audience } from "@/lib/audience";
import { authClient } from "@/lib/auth-client";
import { NotificationsMenu } from "@/components/crm/tasks/notifications-menu";
import { useHydrated } from "@/hooks/use-hydrated";
import { BrandThemeMenu, ThemeToggle, WorkspaceTheme } from "@/components/theme-controls";
import type { BrandTheme } from "@/lib/theme";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MinistrySearchDialog, MinistrySwitcher } from "@/components/ministry-switcher";
import { SettingsProvider } from "@/components/settings/settings-host";
import { useSettings } from "@/components/settings/settings-context";
import { ShellHeaderSlot } from "@/components/shell-header-slot";
import type { ShellSettings } from "@/lib/settings-sections";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

type Workspace = { tenantId: string; name: string; role: string; audience?: Audience | null; timeZone?: string; memberCount?: number };
/** Optional header composition: page actions and a page-level search field. Both are empty unless a page supplies them. */
export type AppShellHeaderSlots = { actions?: React.ReactNode; search?: React.ReactNode };
function NavigationLink({ href, label, icon, active }: { href: string; label: string; icon: React.ReactNode; active: boolean }) {
  const { setOpenMobile, isMobile } = useSidebar();
  return <SidebarMenuItem><SidebarMenuButton asChild isActive={active} tooltip={isMobile ? undefined : label} className={menuButton}><Link href={href} aria-current={active ? "page" : undefined} onClick={() => setOpenMobile(false)}>{icon}<span className="group-data-[collapsible=icon]:sr-only">{label}</span></Link></SidebarMenuButton></SidebarMenuItem>;
}
function NavigationGroup({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const { state, isMobile } = useSidebar();
  if (isMobile) return <SidebarGroup className="mt-6 px-[13px] py-0">
    <SidebarGroupLabel className="h-6 gap-1.5 px-2 text-[12px] font-normal text-sidebar-foreground/85">{icon}{label}</SidebarGroupLabel>
    <SidebarGroupContent><SidebarMenu className="gap-px">{children}</SidebarMenu></SidebarGroupContent>
  </SidebarGroup>;
  return <Collapsible defaultOpen className="group/collapsible">
    <SidebarGroup className="mt-6 px-[13px] py-0 group-data-[collapsible=icon]:mt-3 group-data-[collapsible=icon]:px-0">
      <SidebarGroupLabel asChild className="h-6 gap-1 px-2 text-[12px] font-normal text-sidebar-foreground/85 group-data-[collapsible=icon]:hidden">
        <CollapsibleTrigger>{icon}{label}<ChevronRight aria-hidden="true" className="size-[11px] transition-transform group-data-[state=open]/collapsible:rotate-90" /></CollapsibleTrigger>
      </SidebarGroupLabel>
      <CollapsibleContent forceMount={state === "collapsed" ? true : undefined}>
        <SidebarGroupContent><SidebarMenu className="gap-px">{children}</SidebarMenu></SidebarGroupContent>
      </CollapsibleContent>
    </SidebarGroup>
  </Collapsible>;
}
/** The profile-picture menu: ministry switcher first, then profile, appearance and sign out. */
function AccountMenu({ email, workspaces, selected, busy, container, onSignOut }: { email: string; workspaces: Workspace[]; selected?: string; busy: boolean; container: HTMLElement | null; onSignOut: () => void }) {
  const t = useTranslations("ComponentsAppShell");
  const { setOpenMobile } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchPending = useRef(false), settingsPending = useRef(false);
  const settings = useSettings();
  const closeSidebar = () => setOpenMobile(false);
  return <>
    <DropdownMenu modal={false}><DropdownMenuTrigger asChild>
      <Button ref={triggerRef} variant="ghost" size="icon-responsive" disabled={busy} aria-label={t("accountMenu")} className="shrink-0 p-0">
        <Avatar className="size-8 shrink-0 border border-sidebar-border" aria-hidden="true"><AvatarFallback className="bg-transparent uppercase">{email.slice(0, 1)}</AvatarFallback></Avatar>
      </Button>
    </DropdownMenuTrigger><DropdownMenuContent container={container} side="top" align="start" collisionPadding={8} className="w-72 max-w-[calc(100vw-1rem)] rounded-[12px]"
      onCloseAutoFocus={(event) => { if (searchPending.current || settingsPending.current) { searchPending.current = false; settingsPending.current = false; event.preventDefault(); } }}>
      <DropdownMenuLabel className="truncate text-xs">{email}</DropdownMenuLabel><DropdownMenuSeparator />
      <MinistrySwitcher ministries={workspaces} selected={selected} onNavigate={closeSidebar} onOpenSearch={() => { searchPending.current = true; setSearchOpen(true); }} />
      <DropdownMenuSeparator />
      <DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => { settingsPending.current = true; closeSidebar(); settings?.open(undefined, triggerRef.current); }}><Settings aria-hidden="true" />{t("settings")}</DropdownMenuItem>
      <DropdownMenuItem asChild className="min-h-11 lg:min-h-0"><Link href="/profile" onClick={closeSidebar}>{t("profile")}</Link></DropdownMenuItem>
      <DropdownMenuSeparator /><BrandThemeMenu /><DropdownMenuSeparator />
      <DropdownMenuItem className="min-h-11 lg:min-h-0" disabled={busy} onSelect={onSignOut}><LogOut aria-hidden="true" />{t("signOut")}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    <MinistrySearchDialog ministries={workspaces} selected={selected} open={searchOpen} onOpenChange={setSearchOpen} onNavigate={closeSidebar}
      onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }} />
  </>;
}
const modeNavId = "shell-mode-navigation";
/** Per-mode sidebar (shell slice 2, behind a flag): the switcher plus the groups of the shown mode. Choosing a mode never navigates. */
function ModeNavigation({ selected, workspace, pathname, features, announce }: { selected: string; workspace?: Workspace; pathname: string; features: readonly NavFeature[]; announce: (message: string) => void }) {
  const t = useTranslations("ComponentsAppShell");
  const viewer = { role: workspace?.role, audience: workspace?.audience, features };
  const available = useMemo(() => availableModes(modeAvailability({ role: workspace?.role, audience: workspace?.audience, features })), [workspace?.role, workspace?.audience, features]);
  const choice = useSyncExternalStore(subscribeMode, modeSnapshot, () => null);
  const [peek, setPeek] = useState<{ mode: NavMode; pathname: string } | null>(null);
  // A preview ends on every navigation, so Back to the page it was made on does not bring it back.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) { setSeenPath(pathname); setPeek(null); }
  const navRef = useRef<HTMLElement>(null);
  const focusNav = useRef(false);
  // The remembered choice only matters on neutral pages; the server snapshot is null so the first render matches the server.
  const derived = resolveMode({ pathname, choice }).mode;
  const mode = displayMode({ derived, peek, pathname, available });
  const select = useCallback((next: NavMode, fromKeyboard = false) => {
    if (next === mode || !available.includes(next)) return;
    setPeek({ mode: next, pathname }); rememberMode(next);
    focusNav.current = fromKeyboard;
    announce(t("modeAnnouncement", { mode: t(modeLabelKey(next)) }));
  }, [mode, available, pathname, announce, t]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = modeForShortcut({ ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, code: event.code, target: event.target as HTMLElement | null, getModifierState: (key) => event.getModifierState(key) }, document.activeElement as HTMLElement | null);
      if (!target || !available.includes(target)) return;
      event.preventDefault(); select(target, true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [available, select]);
  useEffect(() => {
    if (!focusNav.current) return;
    focusNav.current = false;
    navRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
  }, [mode]);
  const { groups } = resolveModeNavigation({ tenantId: selected, ...viewer, pathname, mode });
  const modeLabel = t(modeLabelKey(mode));
  // An open editor swaps the entry list for the item's own sidebar while the owning mode is shown (mode === derived; previewing another mode shows
  // that mode's entries so the user is never trapped); the logo row and mode switcher stay.
  const editor = useEditorSidebar();
  const editing = editor !== null && mode === derived;
  // A page-owned contextual sidebar (Inbox) replaces the whole sidebar the same way, under the same rule.
  const portal = useContextualPortal();
  const contextual = !editing && portal.spec !== null && mode === derived;
  const swapped = editing || contextual;
  // Focus follows the swap: into the frame's back arrow when it opens, back to the current entry when it closes. Never on first render, so a direct load keeps the page's own focus.
  const wasSwapped = useRef(swapped);
  useEffect(() => {
    if (wasSwapped.current === swapped) return;
    wasSwapped.current = swapped;
    const root = document.querySelector<HTMLElement>(`#${modeNavId}`);
    const target = swapped ? root?.querySelector<HTMLElement>("[data-contextual-back] a") : (root?.querySelector<HTMLElement>('a[aria-current="page"]') ?? root?.querySelector<HTMLElement>("a[href]"));
    target?.focus();
  }, [swapped]);
  const entries = <nav ref={navRef} id={modeNavId} aria-label={t("workspaceNavigationMode", { mode: modeLabel })} data-shell-mode={mode}>
      {mode === "operations" && <SidebarGroup className="px-[13px] py-0 group-data-[collapsible=icon]:px-0">
        <SidebarMenu className="gap-px"><NavigationLink href="/workspaces" active={false} label={t("workspaces")} icon={<Building2 aria-hidden="true" />} /></SidebarMenu>
      </SidebarGroup>}
      {groups.map((group) => group.pinned
        ? <SidebarGroup key={group.id} className="px-[13px] py-0 group-data-[collapsible=icon]:px-0"><SidebarMenu className="gap-px">
          {group.items.map(({ id, href, active, label, icon: Icon }) => <NavigationLink key={id} href={href} active={active} label={t(label)} icon={<Icon aria-hidden="true" />} />)}
        </SidebarMenu></SidebarGroup>
        : <NavigationGroup key={group.id} label={t(group.label)} icon={group.icon ? <group.icon aria-hidden="true" className="size-3.5" /> : undefined}>
          {group.items.map(({ id, href, active, label, icon: Icon }) => <NavigationLink key={id} href={href} active={active} label={t(label)} icon={<Icon aria-hidden="true" />} />)}
        </NavigationGroup>)}
    </nav>;
  return <>
    {/* One compact header row: logo left, mode icons right (a single mode needs no switcher). */}
    {!swapped && <SidebarHeader className="gap-0 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
      <div className="flex h-[52px] items-center justify-between gap-2 pl-4 pr-3 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
        <Link href="/workspaces" className="flex min-h-11 min-w-0 items-center gap-1.5 rounded-md outline-none lg:min-h-0 focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <Image src="/brand/harvest-logo.png" width={24} height={24} alt="" className="size-6 shrink-0 object-contain" />
          <span className="truncate text-[17px] font-semibold text-sidebar-accent-foreground group-data-[collapsible=icon]:sr-only">{t("harvest")}</span>
        </Link>
        {available.length > 1 && <ModeSwitcher modes={available} active={mode} controls={modeNavId} onSelect={(next) => select(next)} />}
      </div>
    </SidebarHeader>}
    <SidebarContent className="gap-0 pt-1">{editing && editor ? <EditingSidebar context={editor} id={modeNavId} />
      : contextual && portal.spec ? <ContextualSidebar id={modeNavId} title={portal.spec.title} back={portal.spec.back} label={portal.spec.label} slotRef={portal.setSlot} /> : entries}</SidebarContent>
  </>;
}
export function AppShell({ children, workspaces, selected, email, brandTheme = "harvest", defaultOpen = true, features = [], header, modeSwitcher = false, settings = {} }: {
  features?: readonly NavFeature[]; header?: AppShellHeaderSlots;
  /** What the Settings pop-up can offer beyond the account: set by pages that know (workspace layout, profile). */
  settings?: ShellSettings;
  /** Shell slice 2 flag: three-mode switcher and per-mode sidebar. Off renders the single sidebar exactly as before. */
  modeSwitcher?: boolean;
  children: React.ReactNode; workspaces: Workspace[]; selected?: string; email: string; brandTheme?: BrandTheme; defaultOpen?: boolean;
}) {
  const t = useTranslations("ComponentsAppShell");
  const pathname = usePathname(), router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const [navigationContainer, setNavigationContainer] = useState<HTMLElement | null>(null);
  const workspace = workspaces.find((item) => item.tenantId === selected);
  const sectionKey = sectionLabel(pathname, workspace?.audience, undefined, { role: workspace?.role, features });
  // The ministry crumb opens the first page this viewer may use (a collaborator may hold no CRM area).
  const homeHref = selected ? resolveNavigation({ tenantId: selected, role: workspace?.role, audience: workspace?.audience, pathname, features })[0]?.items[0]?.href ?? `/workspaces/${selected}` : "/workspaces";
  const section = pathname === "/profile" ? t("profile") : sectionKey ? t(sectionKey) : t("workspaces");
  async function signOut() {
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) setError(t("couldNotSignOutTryAgain"));
      else { router.replace("/sign-in"); router.refresh(); }
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  const shell = <SidebarProvider defaultOpen={defaultOpen} data-hydrated={hydrated} className="h-dvh min-h-0 overflow-hidden bg-shell-canvas pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] has-data-[variant=inset]:bg-shell-canvas" style={{ "--sidebar-width": "272px", "--sidebar-width-icon": "48px" } as React.CSSProperties}>
    <WorkspaceTheme brandTheme={brandTheme} />
    {/* Not role=status: pages own that role for their own feedback, and the announcement is only for mode changes. */}
    {modeSwitcher && <div aria-live="polite" aria-atomic="true" data-mode-announcer className="sr-only">{announcement}</div>}
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">{t("skipToContent")}</a>
    <Sidebar variant="floating" collapsible="icon" className="p-[8px]">
      <div ref={setNavigationContainer} role="complementary" aria-label={t("workspaceSidebar")} className="flex h-full min-h-0 flex-col">
        {!(modeSwitcher && selected) && <SidebarHeader className="gap-0 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
          <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" asChild className="h-[52px] rounded-none hover:bg-transparent group-data-[collapsible=icon]:size-auto! group-data-[collapsible=icon]:p-0!"><Link href="/workspaces" className="flex h-[52px] items-center gap-1.5 pl-4 pr-3 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Image src="/brand/harvest-logo.png" width={24} height={24} alt="" className="size-6 shrink-0 object-contain" />
            <span className="text-[17px] font-semibold text-sidebar-accent-foreground group-data-[collapsible=icon]:sr-only">{t("harvest")}</span>
          </Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
        </SidebarHeader>}
        {modeSwitcher && selected ? <ModeNavigation selected={selected} workspace={workspace} pathname={pathname} features={features} announce={setAnnouncement} />
        : <SidebarContent className="gap-0 pt-1"><nav aria-label={t("workspaceNavigation")}>
          <SidebarGroup className="px-[13px] py-0 group-data-[collapsible=icon]:px-0">
            <SidebarMenu className="gap-px"><NavigationLink href="/workspaces" active={!selected} label={t("workspaces")} icon={<Building2 aria-hidden="true" />} /></SidebarMenu>
          </SidebarGroup>
          {selected && resolveNavigation({ tenantId: selected, role: workspace?.role, audience: workspace?.audience, pathname, features }).map((group) => <NavigationGroup key={group.id} label={t(group.label)} icon={group.icon ? <group.icon aria-hidden="true" className="size-3.5" /> : undefined}>
            {group.items.map(({ id, href, active, label, icon: Icon }) => <NavigationLink key={id} href={href} active={active} label={t(label)} icon={<Icon aria-hidden="true" />} />)}
          </NavigationGroup>)}
        </nav></SidebarContent>}
        <SidebarFooter className="gap-1 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
          <div className="flex h-[52px] items-center gap-1 pl-4 pr-3 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
            <div className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:flex-none">
            <AccountMenu email={email} workspaces={workspaces} selected={selected} busy={busy} container={navigationContainer} onSignOut={() => void signOut()} />
            <span className="truncate text-[13px] font-medium text-sidebar-accent-foreground group-data-[collapsible=icon]:sr-only">{email.split("@")[0]}</span>
            </div>
            <ThemeToggle />
            <SidebarTrigger size="icon-responsive" className="shrink-0 text-sidebar-foreground [&_svg]:size-[17px] [&_svg]:stroke-[1.7]" />
          </div>
        </SidebarFooter>
      </div>
      <SidebarRail />
    </Sidebar>
    <SidebarInset className="min-h-0 min-w-0 overflow-hidden lg:my-2 lg:mr-2 lg:rounded-xl lg:border">
      <header data-shell-header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 lg:px-6">
        <SidebarTrigger size="icon-responsive" className="shrink-0" />
        <Breadcrumb className="min-w-0"><BreadcrumbList className="flex-nowrap text-[13px]">
          {workspace && <><BreadcrumbItem className="min-w-0"><BreadcrumbLink asChild className="truncate"><Link href={homeHref}>{workspace.name}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /></>}
          <BreadcrumbItem><BreadcrumbPage className="font-medium">{section}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList></Breadcrumb>
        <ShellHeaderSlot />
        {(header?.search || header?.actions || workspace) && <div className="ml-auto flex min-w-0 items-center gap-2">
          {header?.search && <div role="search" aria-label={t("pageSearch")} data-shell-header-search className="min-w-0 max-w-64 flex-1">{header.search}</div>}
          {header?.actions && <div role="group" aria-label={t("pageActions")} data-shell-header-actions className="flex shrink-0 items-center gap-2">{header.actions}</div>}
          {workspace && <NotificationsMenu tenantId={workspace.tenantId} />}
        </div>}
      </header>
      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto">
        {/* Workspace screens use the full width beside the sidebar with compact gutters
            (16px, 24px from lg) that match the breadcrumb. Focused short forms opt into
            their own narrow width; the shell never centres or caps the content column. */}
        <div data-shell-content className="w-full max-w-none p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:p-6 lg:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {error && <Alert variant="destructive" className="mb-6"><AlertDescription>{error}</AlertDescription></Alert>}
          {children}
        </div>
      </main>
    </SidebarInset>
  </SidebarProvider>;
  // Editors register their sidebar through this provider only when the shell-modes flag is on; otherwise they render their own step list.
  const withEditor = modeSwitcher && selected ? <EditorProvider>{shell}</EditorProvider> : shell;
  return <SettingsProvider shell={{ email, tenantId: workspace ? selected : undefined, ministryName: workspace?.name, role: workspace?.role, audience: workspace?.audience, timeZone: workspace?.timeZone, features, settings }}>{withEditor}</SettingsProvider>;
}
