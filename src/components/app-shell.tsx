"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, ChevronRight, ChevronsUpDown, Files, LogOut, Palette, UsersRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useHydrated } from "@/hooks/use-hydrated";
import { BrandThemeMenu, ThemeToggle, WorkspaceTheme } from "@/components/theme-controls";
import type { BrandTheme } from "@/lib/theme";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

type Workspace = { tenantId: string; name: string; role: string };
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
function WorkspaceSwitcher({ workspaces, selected, container }: { workspaces: Workspace[]; selected?: Workspace; container: HTMLElement | null }) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  function navigate(href: string) { router.push(href); setOpenMobile(false); }
  return <SidebarMenu><SidebarMenuItem><DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><SidebarMenuButton aria-label="Workspace" tooltip="Workspace" className={menuButton}>
      <Building2 aria-hidden="true" /><span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:sr-only">Workspace</span><ChevronsUpDown aria-hidden="true" className="ml-auto group-data-[collapsible=icon]:hidden" />
    </SidebarMenuButton></DropdownMenuTrigger>
    <DropdownMenuContent container={container} side="bottom" align="start" className="w-60">
      <DropdownMenuLabel>{selected?.name ?? "Workspaces"}</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => navigate("/workspaces")}>Your workspaces</DropdownMenuItem>
      <DropdownMenuSeparator />
      {workspaces.map((item) => <DropdownMenuItem key={item.tenantId} onSelect={() => navigate(`/workspaces/${item.tenantId}/contacts`)}>{item.name}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu></SidebarMenuItem></SidebarMenu>;
}
export function AppShell({ children, workspaces, selected, email, brandTheme = "harvest", defaultOpen = true }: {
  children: React.ReactNode; workspaces: Workspace[]; selected?: string; email: string; brandTheme?: BrandTheme; defaultOpen?: boolean;
}) {
  const pathname = usePathname(), router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [navigationContainer, setNavigationContainer] = useState<HTMLElement | null>(null);
  const workspace = workspaces.find((item) => item.tenantId === selected);
  const section = pathname.includes("/contacts") ? "Contacts" : pathname.includes("/files") ? "Files" : pathname.endsWith("/appearance") ? "Appearance" : "Workspaces";
  async function signOut() {
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) setError("Could not sign out. Try again.");
      else { router.replace("/sign-in"); router.refresh(); }
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <SidebarProvider defaultOpen={defaultOpen} data-hydrated={hydrated} className="h-dvh min-h-0 overflow-hidden bg-shell-canvas has-data-[variant=inset]:bg-shell-canvas" style={{ "--sidebar-width": "276px", "--sidebar-width-icon": "52px" } as React.CSSProperties}>
    <WorkspaceTheme brandTheme={brandTheme} />
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">Skip to content</a>
    <Sidebar variant="inset" collapsible="icon" className="p-[8px]">
      <nav ref={setNavigationContainer} aria-label="Workspace navigation" className="flex h-full min-h-0 flex-col">
        <SidebarHeader className="gap-0 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
          <Link href="/workspaces" className="flex h-[52px] items-center gap-1.5 pl-4 pr-3 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Image src="/brand/harvest-logo.png" width={24} height={24} alt="" className="size-6 shrink-0 object-contain" />
            <span className="font-display text-[17px] font-semibold text-sidebar-accent-foreground group-data-[collapsible=icon]:sr-only">Harvest</span>
          </Link>
        </SidebarHeader>
        <SidebarContent className="gap-0 pt-1">
          <SidebarGroup className="px-[13px] py-0 group-data-[collapsible=icon]:px-0">
            <WorkspaceSwitcher workspaces={workspaces} selected={workspace} container={navigationContainer} />
            <SidebarMenu className="mt-px gap-px"><NavigationLink href="/workspaces" active={!selected} label="Workspaces" icon={<Building2 aria-hidden="true" />} /></SidebarMenu>
          </SidebarGroup>
          {selected && <>
            <NavigationGroup label="People">
              <NavigationLink href={`/workspaces/${selected}/contacts`} active={pathname.includes("/contacts")} label="Contacts" icon={<UsersRound aria-hidden="true" />} />
              <NavigationLink href={`/workspaces/${selected}/files`} active={pathname.includes("/files")} label="Files" icon={<Files aria-hidden="true" />} />
            </NavigationGroup>
            <NavigationGroup label="Settings"><NavigationLink href={`/workspaces/${selected}/appearance`} active={pathname.endsWith("/appearance")} label="Appearance" icon={<Palette aria-hidden="true" />} /></NavigationGroup>
          </>}
        </SidebarContent>
        <SidebarFooter className="gap-1 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
          <div className="flex h-[52px] items-center gap-1 pl-4 pr-3 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
            <div className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:flex-none">
            <DropdownMenu modal={false}><DropdownMenuTrigger asChild>
              <Button variant="ghost" disabled={busy} aria-label="Account menu" className="size-8 shrink-0 p-0">
                <Avatar className="size-8 shrink-0 border border-sidebar-border" aria-hidden="true"><AvatarFallback className="bg-transparent uppercase">{email.slice(0, 1)}</AvatarFallback></Avatar>
              </Button>
            </DropdownMenuTrigger><DropdownMenuContent container={navigationContainer} side="top" align="start" className="w-64 rounded-[12px]">
              <DropdownMenuLabel className="truncate text-xs">{email}</DropdownMenuLabel><DropdownMenuSeparator />
              <BrandThemeMenu /><DropdownMenuSeparator />
              <DropdownMenuItem disabled={busy} onSelect={() => void signOut()}><LogOut aria-hidden="true" />Sign out</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
            <span className="truncate text-[13px] font-medium text-sidebar-accent-foreground group-data-[collapsible=icon]:sr-only">{email.split("@")[0]}</span>
            </div>
            <ThemeToggle />
            <SidebarTrigger className="size-8 shrink-0 text-sidebar-foreground [&_svg]:size-[17px] [&_svg]:stroke-[1.7]" />
          </div>
        </SidebarFooter>
      </nav>
      <SidebarRail />
    </Sidebar>
    <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
      <header data-shell-header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="lg:hidden" />
        <Breadcrumb className="min-w-0"><BreadcrumbList className="flex-nowrap text-[13px]">
          {workspace && <><BreadcrumbItem className="min-w-0"><BreadcrumbLink asChild className="truncate"><Link href={`/workspaces/${selected}/contacts`}>{workspace.name}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /></>}
          <BreadcrumbItem><BreadcrumbPage className="font-medium">{section}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList></Breadcrumb>
      </header>
      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1040px] px-5 py-10 sm:px-8 lg:py-14">
          {error && <Alert variant="destructive" className="mb-6"><AlertDescription>{error}</AlertDescription></Alert>}
          {children}
        </div>
      </main>
    </SidebarInset>
  </SidebarProvider>;
}
