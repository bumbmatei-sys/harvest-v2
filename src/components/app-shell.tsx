"use client";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, ChevronRight, ChevronsUpDown, LogOut, Sprout } from "lucide-react";
import { resolveNavigation, sectionLabel } from "@/lib/navigation";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

type Workspace = { tenantId: string; name: string; role: string; audience?: Audience | null };
const menuButton = "min-h-11 lg:min-h-0 lg:h-9 gap-2 rounded-[8px] py-0 pl-2 pr-3 text-sm font-medium text-sidebar-foreground data-[active=true]:font-normal [&_svg]:size-[17px] [&_svg]:stroke-[1.7] group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!";
function NavigationLink({ href, label, icon, active }: { href: string; label: string; icon: React.ReactNode; active: boolean }) {
  const { setOpenMobile, isMobile } = useSidebar();
  return <SidebarMenuItem><SidebarMenuButton asChild isActive={active} tooltip={isMobile ? undefined : label} className={menuButton}><Link href={href} aria-current={active ? "page" : undefined} onClick={() => setOpenMobile(false)}>{icon}<span className="group-data-[collapsible=icon]:sr-only">{label}</span></Link></SidebarMenuButton></SidebarMenuItem>;
}
function NavigationGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const { state, isMobile } = useSidebar();
  if (isMobile) return <SidebarGroup className="mt-6 px-[13px] py-0">
    <SidebarGroupLabel className="h-6 px-2 text-[12px] font-normal text-sidebar-foreground/85">{label}</SidebarGroupLabel>
    <SidebarGroupContent><SidebarMenu className="gap-px">{children}</SidebarMenu></SidebarGroupContent>
  </SidebarGroup>;
  return <Collapsible defaultOpen className="group/collapsible">
    <SidebarGroup className="mt-6 px-[13px] py-0 group-data-[collapsible=icon]:mt-3 group-data-[collapsible=icon]:px-0">
      <SidebarGroupLabel asChild className="h-6 gap-1 px-2 text-[12px] font-normal text-sidebar-foreground/85 group-data-[collapsible=icon]:hidden">
        <CollapsibleTrigger>{label}<ChevronRight aria-hidden="true" className="size-[11px] transition-transform group-data-[state=open]/collapsible:rotate-90" /></CollapsibleTrigger>
      </SidebarGroupLabel>
      <CollapsibleContent forceMount={state === "collapsed" ? true : undefined}>
        <SidebarGroupContent><SidebarMenu className="gap-px">{children}</SidebarMenu></SidebarGroupContent>
      </CollapsibleContent>
    </SidebarGroup>
  </Collapsible>;
}
function WorkspaceSwitcher({ workspaces, selected, container }: { workspaces: Workspace[]; selected?: Workspace; container: HTMLElement | null }) {
  const t = useTranslations("ComponentsAppShell");
  const name = selected?.name ?? t("chooseWorkspace");
  const { setOpenMobile, state, isMobile } = useSidebar();
  // Closing hidden tooltip content on Tab can reset the sheet's focus trap.
  // Mobile already shows the workspace name, so keep its tooltip closed.
  return <SidebarMenu><SidebarMenuItem><DropdownMenu modal={false}>
    <Tooltip open={isMobile ? false : undefined}><TooltipTrigger asChild><DropdownMenuTrigger asChild><SidebarMenuButton aria-label={t("switchWorkspaceValue", { name: name })} className={menuButton}>
      <Avatar className="size-5 shrink-0 rounded-md" aria-hidden="true"><AvatarFallback className="rounded-md bg-sidebar-accent text-[10px] font-semibold"><Sprout className="size-3.5" /></AvatarFallback></Avatar><span data-workspace-name className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:sr-only">{name}</span><ChevronsUpDown aria-hidden="true" className="ml-auto group-data-[collapsible=icon]:hidden" />
    </SidebarMenuButton></DropdownMenuTrigger></TooltipTrigger><TooltipContent container={container} side="right" hidden={state !== "collapsed" || isMobile}>{name}</TooltipContent></Tooltip>
    <DropdownMenuContent container={container} side="bottom" align="start" className="w-60">
      <DropdownMenuLabel>{selected?.name ?? t("workspaces")}</DropdownMenuLabel>
      <DropdownMenuItem asChild><Link href="/workspaces" onClick={() => setOpenMobile(false)}>{t("yourWorkspaces")}</Link></DropdownMenuItem>
      <DropdownMenuSeparator />
      {workspaces.map((item) => <DropdownMenuItem key={item.tenantId} asChild><Link href={`/workspaces/${item.tenantId}/crm/people`} onClick={() => setOpenMobile(false)}>{item.name}</Link></DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu></SidebarMenuItem></SidebarMenu>;
}
export function AppShell({ children, workspaces, selected, email, brandTheme = "harvest", defaultOpen = true }: {
  children: React.ReactNode; workspaces: Workspace[]; selected?: string; email: string; brandTheme?: BrandTheme; defaultOpen?: boolean;
}) {
  const t = useTranslations("ComponentsAppShell");
  const pathname = usePathname(), router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [navigationContainer, setNavigationContainer] = useState<HTMLElement | null>(null);
  const workspace = workspaces.find((item) => item.tenantId === selected);
  const sectionKey = sectionLabel(pathname, workspace?.audience);
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
  return <SidebarProvider defaultOpen={defaultOpen} data-hydrated={hydrated} className="h-dvh min-h-0 overflow-hidden bg-shell-canvas has-data-[variant=inset]:bg-shell-canvas" style={{ "--sidebar-width": "272px", "--sidebar-width-icon": "48px" } as React.CSSProperties}>
    <WorkspaceTheme brandTheme={brandTheme} />
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">{t("skipToContent")}</a>
    <Sidebar variant="floating" collapsible="icon" className="p-[8px]">
      <div ref={setNavigationContainer} role="complementary" aria-label={t("workspaceSidebar")} className="flex h-full min-h-0 flex-col">
        <SidebarHeader className="gap-0 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
          <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" asChild className="h-[52px] rounded-none hover:bg-transparent group-data-[collapsible=icon]:size-auto! group-data-[collapsible=icon]:p-0!"><Link href="/workspaces" className="flex h-[52px] items-center gap-1.5 pl-4 pr-3 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Image src="/brand/harvest-logo.png" width={24} height={24} alt="" className="size-6 shrink-0 object-contain" />
            <span className="text-[17px] font-semibold text-sidebar-accent-foreground group-data-[collapsible=icon]:sr-only">{t("harvest")}</span>
          </Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
        </SidebarHeader>
        <SidebarContent className="gap-0 pt-1"><nav aria-label={t("workspaceNavigation")}>
          <SidebarGroup className="px-[13px] py-0 group-data-[collapsible=icon]:px-0">
            <WorkspaceSwitcher workspaces={workspaces} selected={workspace} container={navigationContainer} />
            <SidebarMenu className="mt-px gap-px"><NavigationLink href="/workspaces" active={!selected} label={t("workspaces")} icon={<Building2 aria-hidden="true" />} /></SidebarMenu>
          </SidebarGroup>
          {selected && resolveNavigation({ tenantId: selected, role: workspace?.role, audience: workspace?.audience, pathname }).map((group) => <NavigationGroup key={group.id} label={t(group.label)}>
            {group.items.map(({ id, href, active, label, icon: Icon }) => <NavigationLink key={id} href={href} active={active} label={t(label)} icon={<Icon aria-hidden="true" />} />)}
          </NavigationGroup>)}
        </nav></SidebarContent>
        <SidebarFooter className="gap-1 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
          <div className="flex h-[52px] items-center gap-1 pl-4 pr-3 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
            <div className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:flex-none">
            <DropdownMenu modal={false}><DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-responsive" disabled={busy} aria-label={t("accountMenu")} className="shrink-0 p-0">
                <Avatar className="size-8 shrink-0 border border-sidebar-border" aria-hidden="true"><AvatarFallback className="bg-transparent uppercase">{email.slice(0, 1)}</AvatarFallback></Avatar>
              </Button>
            </DropdownMenuTrigger><DropdownMenuContent container={navigationContainer} side="top" align="start" className="w-64 rounded-[12px]">
              <DropdownMenuLabel className="truncate text-xs">{email}</DropdownMenuLabel><DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link href="/profile">{t("profile")}</Link></DropdownMenuItem>
              <DropdownMenuSeparator /><BrandThemeMenu /><DropdownMenuSeparator />
              <DropdownMenuItem disabled={busy} onSelect={() => void signOut()}><LogOut aria-hidden="true" />{t("signOut")}</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
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
          {workspace && <><BreadcrumbItem className="min-w-0"><BreadcrumbLink asChild className="truncate"><Link href={`/workspaces/${selected}/crm/people`}>{workspace.name}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /></>}
          <BreadcrumbItem><BreadcrumbPage className="font-medium">{section}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList></Breadcrumb>
        {workspace && <div className="ml-auto flex items-center"><NotificationsMenu tenantId={workspace.tenantId} /></div>}
      </header>
      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto">
        {/* Workspace screens use the full width beside the sidebar with compact gutters
            (16px, 24px from lg) that match the breadcrumb. Focused short forms opt into
            their own narrow width; the shell never centres or caps the content column. */}
        <div data-shell-content className="w-full max-w-none p-4 lg:p-6">
          {error && <Alert variant="destructive" className="mb-6"><AlertDescription>{error}</AlertDescription></Alert>}
          {children}
        </div>
      </main>
    </SidebarInset>
  </SidebarProvider>;
}
