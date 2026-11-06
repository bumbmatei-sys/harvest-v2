"use client";

import type { Ref } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, LogOut, Palette, Plus, Settings, Sprout, UserRound } from "lucide-react";
import { BrandThemeMenu } from "@/components/theme-controls";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type Workspace = { tenantId: string; name: string; role: string };

function WorkspaceAvatar({ className }: { className?: string }) {
  return <Avatar aria-hidden="true" className={cn("size-8 shrink-0 rounded-md", className)}>
    <AvatarFallback className="rounded-md bg-sidebar-accent text-sidebar-accent-foreground"><Sprout className="size-4" /></AvatarFallback>
  </Avatar>;
}

export function WorkspaceSwitcher({ workspaces, selected, email, busy, onSignOut, onCreateWorkspace, container, triggerRef }: {
  workspaces: Workspace[];
  selected?: Workspace;
  email: string;
  busy: boolean;
  onSignOut: () => void;
  onCreateWorkspace: () => void;
  container: HTMLElement | null;
  triggerRef: Ref<HTMLButtonElement>;
}) {
  const t = useTranslations("ComponentsAppShell");
  const roles = useTranslations("AppWorkspacesPage.roles");
  const themes = useTranslations("ComponentsThemeControls");
  const { setOpenMobile, state, isMobile } = useSidebar();
  const name = selected?.name ?? t("chooseWorkspace");
  const role = selected && ["owner", "admin", "member", "viewer"].includes(selected.role) ? roles(selected.role) : undefined;
  return <SidebarMenu><SidebarMenuItem><DropdownMenu modal={false}>
    <Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild>
      <SidebarMenuButton ref={triggerRef} size="lg" aria-label={t("switchWorkspaceValue", { name })} className="h-14 gap-3 rounded-md border border-sidebar-border px-3 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!">
        <WorkspaceAvatar />
        <span data-workspace-name className="min-w-0 flex-1 truncate font-medium group-data-[collapsible=icon]:sr-only">{name}</span>
        <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
      </SidebarMenuButton>
    </DropdownMenuTrigger></TooltipTrigger><TooltipContent container={container} side="right" hidden={state !== "collapsed" || isMobile}>{name}</TooltipContent></Tooltip>
    <DropdownMenuContent container={container} side="top" align="start" sideOffset={8} aria-label={t("switchWorkspaceValue", { name })} className="w-72 max-w-[calc(100vw-2rem)] rounded-lg p-2 [&_[data-slot=dropdown-menu-item]]:min-h-11 [&_[data-slot=dropdown-menu-sub-trigger]]:min-h-11">
      {selected && <>
        <DropdownMenuLabel className="flex items-center gap-3 py-3">
          <WorkspaceAvatar className="size-10" />
          <div className="min-w-0"><div className="truncate font-semibold">{selected.name}</div>{role && <div className="text-xs font-normal capitalize text-muted-foreground">{role}</div>}</div>
        </DropdownMenuLabel>
        <DropdownMenuItem asChild><Link href={`/workspaces/${selected.tenantId}/appearance`} onClick={() => setOpenMobile(false)}><Settings aria-hidden="true" />{t("settings")}</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
      </>}
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("workspaces")}</DropdownMenuLabel>
      {workspaces.map((item) => {
        const active = item.tenantId === selected?.tenantId;
        return <DropdownMenuItem key={item.tenantId} asChild className={cn(active && "bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground")}>
          <Link href={`/workspaces/${item.tenantId}/crm/people`} aria-current={active ? "true" : undefined} onClick={() => setOpenMobile(false)}>
            <WorkspaceAvatar className="size-7" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{active && <Check aria-hidden="true" className="ml-auto size-4 text-primary-foreground" />}
          </Link>
        </DropdownMenuItem>;
      })}
      <DropdownMenuItem onSelect={() => { setOpenMobile(false); onCreateWorkspace(); }}><Plus aria-hidden="true" />{t("newWorkspace")}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="flex items-center gap-3 py-3">
        <Avatar aria-hidden="true" className="size-8 shrink-0"><AvatarFallback className="uppercase">{email.slice(0, 1)}</AvatarFallback></Avatar>
        <span className="min-w-0 truncate text-xs font-normal">{email}</span>
      </DropdownMenuLabel>
      <DropdownMenuItem asChild><Link href="/profile" onClick={() => setOpenMobile(false)}><UserRound aria-hidden="true" />{t("profile")}</Link></DropdownMenuItem>
      <DropdownMenuSub><DropdownMenuSubTrigger><Palette aria-hidden="true" />{themes("theme")}</DropdownMenuSubTrigger><DropdownMenuSubContent className="[&_[data-slot=dropdown-menu-radio-item]]:min-h-11"><BrandThemeMenu /></DropdownMenuSubContent></DropdownMenuSub>
      <DropdownMenuItem disabled={busy} onSelect={onSignOut}><LogOut aria-hidden="true" />{t("signOut")}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu></SidebarMenuItem></SidebarMenu>;
}
