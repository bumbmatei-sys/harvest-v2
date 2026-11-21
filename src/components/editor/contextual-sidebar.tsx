"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { menuButton } from "@/components/shell-styles";

/**
 * The back arrow at the very top of every contextual sidebar (an open editor, the Inbox). One component, so the editors and the Inbox leave the same way:
 * a 44px link with its own accessible name that returns to the normal Harvest sidebar. The unsaved-changes guard intercepts link clicks, so a dirty editor
 * still asks before leaving.
 */
export function ContextualBack({ href, label }: { href: string; label: string }) {
  const t = useTranslations("EditorMode");
  const { setOpenMobile, isMobile } = useSidebar();
  return <SidebarGroup className="px-[13px] pb-0 pt-2 group-data-[collapsible=icon]:px-0" data-contextual-back>
    <SidebarMenu className="gap-px"><SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={isMobile ? undefined : label} className={menuButton}>
        <Link href={href} aria-label={t("backTo", { label })} onClick={() => setOpenMobile(false)}>
          <ArrowLeft aria-hidden="true" /><span className="group-data-[collapsible=icon]:sr-only">{label}</span></Link>
      </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
  </SidebarGroup>;
}

/**
 * The page-owned variant: the frame the shell draws when a page registers a contextual sidebar. The page portals its panel into `slotRef`'s element. In the
 * icon rail only the back arrow shows.
 */
export function ContextualSidebar({ title, back, label, id, slotRef }: { title: string; back: { href: string; label: string }; label: string; id: string; slotRef: (element: HTMLDivElement | null) => void }) {
  return <div id={id} role="group" aria-label={label} data-shell-contextual className="flex min-h-full flex-col">
    <ContextualBack href={back.href} label={back.label} />
    <h2 className="mt-2 truncate px-[21px] text-sm font-semibold text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden" data-contextual-title>{title}</h2>
    <div ref={slotRef} className="min-h-0 flex-1 group-data-[collapsible=icon]:hidden" data-contextual-slot />
  </div>;
}
