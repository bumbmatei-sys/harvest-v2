"use client";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Building, Building2, ChevronRight, Files, Kanban, Palette, SlidersHorizontal, UsersRound, Workflow } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useHydrated } from "@/hooks/use-hydrated";
import { ThemeToggle, WorkspaceTheme } from "@/components/theme-controls";
import type { BrandTheme } from "@/lib/theme";
import { WorkspaceSwitcher, type Workspace } from "@/components/workspace-switcher";
import { WorkspaceForm } from "@/components/workspace-form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

const menuButton = "h-[30px] gap-2 rounded-[8px] py-0 pl-2 pr-3 text-[14px] font-normal text-sidebar-foreground data-[active=true]:font-normal [&_svg]:size-[17px] [&_svg]:stroke-[1.7] group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!";
function NavigationLink({ href, label, icon, active }: { href: string; label: string; icon: React.ReactNode; active: boolean }) {
  const { setOpenMobile } = useSidebar();
  return <SidebarMenuItem><SidebarMenuButton asChild isActive={active} tooltip={label} className={menuButton}><Link href={href} aria-current={active ? "page" : undefined} onClick={() => setOpenMobile(false)}>{icon}<span className="group-data-[collapsible=icon]:sr-only">{label}</span></Link></SidebarMenuButton></SidebarMenuItem>;
}
function NavigationGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const { state, isMobile } = useSidebar();
  return <Collapsible defaultOpen className="group/collapsible">
    <SidebarGroup className="mt-6 px-[13px] py-0 group-data-[collapsible=icon]:mt-3 group-data-[collapsible=icon]:px-0">
      <SidebarGroupLabel asChild className="h-6 gap-1 px-2 text-[12px] font-normal text-sidebar-foreground/85 group-data-[collapsible=icon]:hidden">
        <CollapsibleTrigger>{label}<ChevronRight aria-hidden="true" className="size-[11px] transition-transform group-data-[state=open]/collapsible:rotate-90" /></CollapsibleTrigger>
      </SidebarGroupLabel>
      <CollapsibleContent forceMount={state === "collapsed" && !isMobile ? true : undefined}>
        <SidebarGroupContent><SidebarMenu className="gap-px">{children}</SidebarMenu></SidebarGroupContent>
      </CollapsibleContent>
    </SidebarGroup>
  </Collapsible>;
}
export function AppShell({ children, workspaces, selected, email, brandTheme = "harvest", defaultOpen = true }: {
  children: React.ReactNode; workspaces: Workspace[]; selected?: string; email: string; brandTheme?: BrandTheme; defaultOpen?: boolean;
}) {
  const t = useTranslations("ComponentsAppShell");
  const pathname = usePathname(), router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const switcherTrigger = useRef<HTMLButtonElement>(null);
  const mobileSidebarTrigger = useRef<HTMLButtonElement>(null);
  const [navigationContainer, setNavigationContainer] = useState<HTMLElement | null>(null);
  const workspace = workspaces.find((item) => item.tenantId === selected);
  const section = pathname === "/profile" ? t("profile") : pathname.includes("/crm/people") || pathname.includes("/contacts") ? t("people") : pathname.includes("/crm/companies") ? t("companies") : pathname.includes("/files") ? t("files") : pathname.includes("/crm/settings/pipelines") ? t("pipelineSettings") : pathname.includes("/crm/pipelines") || pathname.includes("/crm/deals") ? t("pipelines"): pathname.includes("/crm/settings/fields") ? t("crmFields"): pathname.endsWith("/appearance") ? t("appearance") : t("workspaces");
  async function signOut() {
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) setError(t("couldNotSignOutTryAgain"));
      else { router.replace("/sign-in"); router.refresh(); }
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  return <SidebarProvider defaultOpen={defaultOpen} data-hydrated={hydrated} className="h-dvh min-h-0 overflow-hidden bg-shell-canvas has-data-[variant=inset]:bg-shell-canvas" style={{ "--sidebar-width": "276px", "--sidebar-width-icon": "52px" } as React.CSSProperties}>
    <WorkspaceTheme brandTheme={brandTheme} />
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">{t("skipToContent")}</a>
    <Sidebar variant="inset" collapsible="icon" className="p-[8px]">
      <div ref={setNavigationContainer} role="complementary" aria-label={t("workspaceSidebar")} className="flex h-full min-h-0 flex-col">
        <SidebarHeader className="gap-0 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
          <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" asChild className="h-[52px] rounded-none hover:bg-transparent group-data-[collapsible=icon]:size-auto! group-data-[collapsible=icon]:p-0!"><Link href="/workspaces" className="flex h-[52px] items-center gap-1.5 pl-4 pr-3 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Image src="/brand/harvest-logo.png" width={24} height={24} alt="" className="size-6 shrink-0 object-contain" />
            <span className="text-[17px] font-semibold text-sidebar-accent-foreground group-data-[collapsible=icon]:sr-only">{t("harvest")}</span>
          </Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
        </SidebarHeader>
        <SidebarContent className="gap-0 pt-1"><nav aria-label={t("workspaceNavigation")}>
          <SidebarGroup className="px-[13px] py-0 group-data-[collapsible=icon]:px-0">
            <SidebarMenu className="mt-px gap-px"><NavigationLink href="/workspaces" active={!selected} label={t("workspaces")} icon={<Building2 aria-hidden="true" />} /></SidebarMenu>
          </SidebarGroup>
          {selected && <>
            <NavigationGroup label={t("crm")}>
              <NavigationLink href={`/workspaces/${selected}/crm/people`} active={pathname.includes("/crm/people")} label={t("people")} icon={<UsersRound aria-hidden="true" />} />
              <NavigationLink href={`/workspaces/${selected}/crm/companies`} active={pathname.includes("/crm/companies")} label={t("companies")} icon={<Building aria-hidden="true" />} />
              <NavigationLink href={`/workspaces/${selected}/crm/pipelines`} active={pathname.includes("/crm/pipelines") || pathname.includes("/crm/deals")} label={t("pipelines")} icon={<Kanban aria-hidden="true" />} />
            </NavigationGroup>
            <NavigationGroup label={t("workspace")}>
              <NavigationLink href={`/workspaces/${selected}/files`} active={pathname.includes("/files")} label={t("files")} icon={<Files aria-hidden="true" />} />
            </NavigationGroup>
            <NavigationGroup label={t("settings")}>
              <NavigationLink href={`/workspaces/${selected}/crm/settings/fields`} active={pathname.includes("/crm/settings/fields")} label={t("crmFields")} icon={<SlidersHorizontal aria-hidden="true" />} />
              <NavigationLink href={`/workspaces/${selected}/crm/settings/pipelines`} active={pathname.includes("/crm/settings/pipelines")} label={t("pipelineSettings")} icon={<Workflow aria-hidden="true" />} />
              <NavigationLink href={`/workspaces/${selected}/appearance`} active={pathname.endsWith("/appearance")} label={t("appearance")} icon={<Palette aria-hidden="true" />} />
            </NavigationGroup>
          </>}
        </nav></SidebarContent>
        <SidebarFooter className="gap-2 p-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <WorkspaceSwitcher triggerRef={switcherTrigger} workspaces={workspaces} selected={workspace} email={email} busy={busy} onSignOut={() => void signOut()} onCreateWorkspace={() => setCreateOpen(true)} container={navigationContainer} />
          <div className="flex items-center justify-end gap-1 group-data-[collapsible=icon]:flex-col">
            <ThemeToggle />
            <SidebarTrigger className="size-8 shrink-0 text-sidebar-foreground [&_svg]:size-[17px] [&_svg]:stroke-[1.7]" />
          </div>
        </SidebarFooter>
      </div>
      <SidebarRail />
    </Sidebar>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); (switcherTrigger.current ?? mobileSidebarTrigger.current)?.focus(); }}>
        <DialogHeader><DialogTitle>{t("newWorkspace")}</DialogTitle><DialogDescription>{t("newWorkspaceDescription")}</DialogDescription></DialogHeader>
        <WorkspaceForm onCreated={(tenantId) => { setCreateOpen(false); router.push(`/workspaces/${tenantId}/crm/people`); router.refresh(); }} />
      </DialogContent>
    </Dialog>
    <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
      <header data-shell-header className="flex h-12 shrink-0 items-center gap-2 px-4 lg:px-6">
        <SidebarTrigger ref={mobileSidebarTrigger} className="lg:hidden" />
        <Breadcrumb className="min-w-0"><BreadcrumbList className="flex-nowrap text-[13px]">
          {workspace && <><BreadcrumbItem className="min-w-0"><BreadcrumbLink asChild className="truncate"><Link href={`/workspaces/${selected}/crm/people`}>{workspace.name}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /></>}
          <BreadcrumbItem><BreadcrumbPage className="font-medium">{section}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList></Breadcrumb>
      </header>
      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto">
        {/* Workspace screens use the full width beside the sidebar with compact gutters
            (16px, 24px from lg) that match the breadcrumb. Focused short forms opt into
            their own narrow width; the shell never centres or caps the content column. */}
        <div data-shell-content className="w-full max-w-none px-4 pt-1 pb-8 lg:px-6 lg:pb-10">
          {error && <Alert variant="destructive" className="mb-6"><AlertDescription>{error}</AlertDescription></Alert>}
          {children}
        </div>
      </main>
    </SidebarInset>
  </SidebarProvider>;
}
