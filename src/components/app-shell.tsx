"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Building2, ChevronsUpDown, LogOut, Palette, UsersRound, Wheat } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ThemeControls, WorkspaceTheme } from "@/components/theme-controls";
import type { BrandTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarSeparator, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

type Workspace = { tenantId: string; name: string; role: string };
function NavigationLink({ href, children, active }: { href: string; children: React.ReactNode; active: boolean }) {
  const { setOpenMobile } = useSidebar();
  return <SidebarMenuItem><SidebarMenuButton asChild isActive={active}><Link href={href} aria-current={active ? "page" : undefined} onClick={() => setOpenMobile(false)}>{children}</Link></SidebarMenuButton></SidebarMenuItem>;
}
export function AppShell({ children, workspaces, selected, email, brandTheme = "harvest" }: {
  children: React.ReactNode; workspaces: Workspace[]; selected?: string; email: string; brandTheme?: BrandTheme;
}) {
  const pathname = usePathname(), router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const workspace = workspaces.find((item) => item.tenantId === selected);
  async function signOut() {
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) setError("Could not sign out. Try again.");
      else { router.replace("/sign-in"); router.refresh(); }
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <SidebarProvider style={{ "--sidebar-width": "15rem" } as React.CSSProperties}>
    <WorkspaceTheme brandTheme={brandTheme} />
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">Skip to content</a>
    <Sidebar variant="floating" className="p-2">
      <SidebarHeader className="gap-6 px-4 pt-5 pb-3">
        <Link href="/workspaces" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight"><span className="flex size-8 items-center justify-center rounded-md bg-selected text-foreground"><Wheat className="size-5" aria-hidden="true" /></span>Harvest</Link>
        <Select value={selected ?? "all"} onValueChange={(value) => router.push(value === "all" ? "/workspaces" : `/workspaces/${value}/contacts`)}>
          <SelectTrigger aria-label="Workspace" className="w-full border-sidebar-border bg-transparent text-xs"><SelectValue placeholder="Your workspaces" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Your workspaces</SelectItem>{workspaces.map((item) => <SelectItem key={item.tenantId} value={item.tenantId}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup><SidebarGroupLabel className="text-[11px] uppercase tracking-wider">Workspace</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
          <NavigationLink href="/workspaces" active={!selected}><Building2 aria-hidden="true" /><span>Workspaces</span></NavigationLink>
          {selected && <>
            <NavigationLink href={`/workspaces/${selected}/contacts`} active={pathname.includes("/contacts")}><UsersRound aria-hidden="true" /><span>Contacts</span></NavigationLink>
            <NavigationLink href={`/workspaces/${selected}/appearance`} active={pathname.endsWith("/appearance")}><Palette aria-hidden="true" /><span>Appearance</span></NavigationLink>
          </>}
        </SidebarMenu></SidebarGroupContent></SidebarGroup>
        <div className="mx-3 mt-auto rounded-xl border border-sidebar-border p-4 text-xs leading-relaxed text-muted-foreground"><Wheat className="mb-3 size-5" aria-hidden="true" /><p className="font-medium text-foreground">A place for your people.</p><p className="mt-1">Build meaningful connections, one conversation at a time.</p></div>
      </SidebarContent>
      <SidebarFooter className="gap-3 p-4"><SidebarSeparator className="mx-0" /><div className="flex min-w-0 items-center gap-2.5"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-selected font-medium uppercase">{email.slice(0, 1)}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{email}</p><p className="text-[11px] capitalize text-muted-foreground">{workspace?.role ?? "Your account"}</p></div><ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden="true" /></div><Button variant="ghost" size="sm" disabled={busy} onClick={() => void signOut()} className="justify-start text-xs text-muted-foreground"><LogOut aria-hidden="true" />Sign out</Button></SidebarFooter>
    </Sidebar>
    <SidebarInset className="min-w-0 bg-background">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b px-4 py-3 lg:px-8"><div className="flex min-w-0 items-center gap-2"><SidebarTrigger /><span className="truncate text-xs text-muted-foreground">{workspace?.name ?? "Your account"}</span><ArrowUpRight className="size-3 text-muted-foreground" aria-hidden="true" /></div><ThemeControls /></header>
      <main id="main-content" className="mx-auto w-full max-w-[1040px] flex-1 px-5 py-10 sm:px-8 lg:py-14">
        {error && <Alert variant="destructive" className="mb-6"><AlertDescription>{error}</AlertDescription></Alert>}
        {children}
      </main>
      <footer className="px-5 py-5 text-[11px] text-muted-foreground sm:px-8">Harvest · Room to grow.</footer>
    </SidebarInset>
  </SidebarProvider>;
}
